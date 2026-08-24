import type express from "express";
import type { IncomingMessage, Server } from "node:http";
import type { LookupFunction } from "node:net";
import { WebSocket, WebSocketServer } from "ws";

import { parseIssuePreviewTicketInput } from "@deskcue/protocol";
import type {
  PreviewCandidatesResponse,
  PreviewProxyDiagnosticsSnapshot,
  PreviewTicketResponse
} from "@deskcue/protocol";
import { getRequestAccessDevice, accessDeviceStore } from "#access/accessDevices";
import { daemonConfig } from "#config/daemonConfig";
import { isTrustedLoopbackBrowserRequest } from "#http/hostClient";
import { readProtocolPayload } from "#http/middleware/validators";
import { readAccessTokenFromWebSocketRequest } from "#http/routes/access/accessControl";

import { PreviewCookieJar } from "./egress/previewCookieJar.ts";
import {
  previewEgressMustStripAuthorization,
  readPreviewEgressUrl
} from "./egress/previewEgressTarget.ts";
import type { PreviewEgressResolver } from "./egress/previewEgressTarget.ts";
import { resolvePreviewWebSocketTargetUrls } from "./egress/previewWebSocketTarget.ts";
import { discoverPreviewCandidates, waitForPreviewPort } from "./previewCandidateDiscovery.ts";
import { PREVIEW_PROXY_LIMITS } from "./previewProxyLimits.ts";
import type {
  PreviewConfiguredPortReader,
  PreviewOwner,
  PreviewTargetResolver,
  ResolvedPreviewTarget
} from "./previewTargetResolver.ts";
import { buildPreviewTargetUrl } from "./previewTargetUrl.ts";
import {
  PREVIEW_TICKET_PATH_SEGMENT,
  PREVIEW_TICKET_QUERY_KEY,
  PreviewTicketRegistry
} from "./previewTicketRegistry.ts";
import {
  buildAuthorizedPreviewBasePath,
  buildPreviewBasePath,
  hasExplicitPreviewTicket,
  readPreviewOwner,
  readPreviewTicket,
  setPreviewTicketCookies
} from "./previewTicketTransport.ts";
import {
  readWebSocketProtocols,
  rejectPreviewUpgrade,
  relayPreviewWebSockets
} from "./previewWebSocketRelay.ts";
import { PreviewHttpRelay } from "./relay/previewHttpRelay.ts";
import {
  buildPreviewRequestHeaders,
  createPreviewRootRequestRedirectHandler,
  isDeskCueAuthorization
} from "./relay/previewProxyHeaders.ts";
import { buildPreviewUrl } from "./routing/previewBrowserUrl.ts";
import {
  resolvePreviewHttpEgressTarget,
  resolvePreviewWebSocketEgressTarget
} from "./routing/previewEgressResolver.ts";
import { isDeskCueAccessToken, readPreviewAuthRequired } from "./routing/previewProxyAccess.ts";
import { PreviewProxyAdmission } from "./runtime/previewProxyAdmission.ts";
import { PreviewProxyMetrics } from "./runtime/previewProxyMetrics.ts";
import type { PreviewWebSocketMetricTracker } from "./runtime/previewProxyMetrics.ts";

type PreviewProxyOptions = {
  authRequired?: () => boolean;
  previewProxyPort?: number;
  readConfiguredPort?: PreviewConfiguredPortReader;
  resolveEgressTarget?: PreviewEgressResolver;
  resolveTarget: PreviewTargetResolver;
};

type PreviewWebSocketContext = {
  egress: boolean;
  lookup?: LookupFunction;
  targetUrl: URL;
  viewerKey: string;
};

export class PreviewProxyController {
  private readonly admission = new PreviewProxyAdmission();
  private readonly clientSockets = new Set<WebSocket>();
  private readonly cookieJar = new PreviewCookieJar();
  private readonly httpRelay = new PreviewHttpRelay(this.cookieJar);
  private readonly metrics = new PreviewProxyMetrics();
  private readonly ticketRegistry = new PreviewTicketRegistry();
  private readonly upstreamSockets = new Set<WebSocket>();
  private readonly webSocketServer = new WebSocketServer({
    maxPayload: PREVIEW_PROXY_LIMITS.maxWebSocketMessageBytes,
    noServer: true
  });
  private closed = false;
  private server: Server | null = null;
  private readonly onUpgrade = (request: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
    void this.handleWebSocketUpgrade(request, socket, head);
  };

  constructor(private readonly options: PreviewProxyOptions) {}

  installProxyRoutes(app: express.Express) {
    app.use("/api/preview/sessions/:ownerId", this.createHttpHandler("session"));
    app.use("/api/preview/local-llm/:ownerId", this.createHttpHandler("local-llm"));
    app.use(createPreviewRootRequestRedirectHandler(this.ticketRegistry));
  }

  installTicketRoute(app: express.Express) {
    app.get("/api/preview/diagnostics", (_request, response) => {
      response.json(this.readDiagnostics());
    });

    app.get("/api/preview/candidates", async (request, response, next) => {
      try {
        const owner = readProtocolPayload(() => parseIssuePreviewTicketInput({
          kind: request.query.kind,
          ownerId: request.query.ownerId
        }));
        const result: PreviewCandidatesResponse = {
          candidates: await discoverPreviewCandidates({
            configuredPort: await this.options.readConfiguredPort?.({
              id: owner.ownerId,
              kind: owner.kind
            }) ?? null,
            excludedPort: daemonConfig.daemonPort
          })
        };

        response.json(result);
      } catch (error) {
        next(error);
      }
    });

    app.post("/api/preview/tickets", async (request, response, next) => {
      try {
        const owner = readProtocolPayload(() => parseIssuePreviewTicketInput(request.body));
        const target = await this.options.resolveTarget({ id: owner.ownerId, kind: owner.kind });

        if (!target) {
          response.status(409).json({ error: "Enable preview before opening it." });
          return;
        }

        if (!await waitForPreviewPort(target.port)) {
          response.status(409).json({ error: "The local preview server is unavailable." });
          return;
        }

        const viewerKey = getRequestAccessDevice(request)?.id ?? "local-preview";
        const previewOwner = { id: owner.ownerId, kind: owner.kind } satisfies PreviewOwner;
        const issued = this.ticketRegistry.issueOrRenew(
          previewOwner,
          viewerKey,
          readPreviewTicket(request.url, request.headers.cookie, previewOwner)
        );
        const basePath = buildPreviewBasePath(previewOwner);

        setPreviewTicketCookies(request, response, previewOwner, issued.ticket);
        const result: PreviewTicketResponse = {
          credentialRevision: issued.credentialRevision,
          expiresAt: new Date(issued.expiresAtMs).toISOString(),
          previewUrl: buildPreviewUrl(request, basePath, this.options.previewProxyPort)
        };

        response.status(201).json(result);
      } catch (error) {
        next(error);
      }
    });
  }

  attach(server: Server) {
    if (this.server) throw new Error("Preview proxy is already attached.");

    this.server = server;
    this.closed = false;
    server.on("upgrade", this.onUpgrade);
  }

  async close() {
    if (this.closed) return;

    this.closed = true;
    this.admission.close();
    if (this.server) this.server.off("upgrade", this.onUpgrade);
    this.server = null;
    this.ticketRegistry.clear();
    this.cookieJar.clear();
    this.httpRelay.close();
    for (const socket of [...this.clientSockets, ...this.upstreamSockets]) socket.terminate();
    await new Promise<void>((resolve) => this.webSocketServer.close(() => resolve()));
  }

  readDiagnostics(): PreviewProxyDiagnosticsSnapshot { return this.metrics.readSnapshot(this.admission.readSnapshot()); }

  private createHttpHandler(kind: PreviewOwner["kind"]): express.RequestHandler {
    return async (request, response) => {
      const rawOwnerId = request.params.ownerId;
      const owner = {
        id: Array.isArray(rawOwnerId) ? rawOwnerId[0] ?? "" : rawOwnerId,
        kind
      } satisfies PreviewOwner;
      const basePath = buildPreviewBasePath(owner);
      const ticket = readPreviewTicket(request.url, request.headers.cookie, owner);
      const ticketIsValid = this.ticketRegistry.validate(ticket, owner);

      if (!this.isHttpAuthorized(request, owner, ticket)) {
        response.status(401).json({ error: "A valid DeskCue preview ticket is required." });
        return;
      }

      const viewerKey = this.ticketRegistry.readViewerKey(ticket, owner) ??
        getRequestAccessDevice(request)?.id ??
        "local-preview";
      const admission = this.admission.tryAcquire("http", owner, viewerKey);

      if (!admission.accepted) {
        this.metrics.recordAdmissionRejection("http", admission.reason);
        response.status(503).json({ error: "Preview proxy is busy. Try again shortly." });
        return;
      }

      const metrics = this.metrics.startHttp();
      const requestLifecycle = {
        finalized: false,
        finalize() {
          if (requestLifecycle.finalized) return;

          requestLifecycle.finalized = true;
          metrics.finish(response.writableEnded ? response.statusCode : 499);
          admission.release();
        }
      };

      response.once("finish", requestLifecycle.finalize);
      response.once("close", requestLifecycle.finalize);

      let target: ResolvedPreviewTarget | null;
      try {
        target = await this.options.resolveTarget(owner);
      } catch {
        target = null;
      }

      if (!target) {
        response.status(404).json({ error: "Preview is not active for this chat." });
        return;
      }

      if (ticket && ticketIsValid && hasExplicitPreviewTicket(request.url)) {
        setPreviewTicketCookies(request, response, owner, ticket);
      }

      const requestedEgressUrl = readPreviewEgressUrl(request.url);

      if (requestedEgressUrl && target.networkMode !== "deskcue-host") {
        response.status(403).json({ error: "Host-routed Preview networking is disabled." });
        return;
      }

      try {
        const upstream = requestedEgressUrl
          ? await resolvePreviewHttpEgressTarget(requestedEgressUrl, this.options.resolveEgressTarget)
          : {
            egress: false as const,
            lookup: undefined,
            url: buildPreviewTargetUrl(request.url, target.origin, {
              isDeskCueAccessToken,
              ticketPathSegment: PREVIEW_TICKET_PATH_SEGMENT,
              ticketQueryKey: PREVIEW_TICKET_QUERY_KEY
            })
          };
        await this.httpRelay.proxy(request, response, {
          basePath,
          localTarget: target,
          lookup: upstream.lookup,
          metrics,
          owner,
          resourceBasePath: ticket && ticketIsValid
            ? buildAuthorizedPreviewBasePath(basePath, ticket)
            : basePath,
          targetUrl: upstream.url,
          viewerKey,
          egress: upstream.egress,
          stripAuthorization: previewEgressMustStripAuthorization(request.url)
        });
      } catch {
        if (!response.headersSent) {
          response.status(502).json({ error: "Preview upstream target is unavailable or blocked." });
        }
      }
    };
  }

  private isHttpAuthorized(request: express.Request, owner: PreviewOwner, ticket: string | null) {
    return (
      !readPreviewAuthRequired(this.options.authRequired) ||
      Boolean(getRequestAccessDevice(request)) ||
      isTrustedLoopbackBrowserRequest(request) ||
      this.ticketRegistry.validate(ticket, owner)
    );
  }

  private async handleWebSocketUpgrade(
    request: IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer
  ) {
    const owner = readPreviewOwner(request.url);

    if (!owner) return;

    const ticket = readPreviewTicket(request.url ?? "/", request.headers.cookie, owner);

    if (!this.isWebSocketAuthorized(request, owner, ticket)) {
      rejectPreviewUpgrade(socket, 401, "Unauthorized");
      return;
    }

    const viewerKey = this.readWebSocketViewerKey(request, owner, ticket);
    const admission = this.admission.tryAcquire("websocket", owner, viewerKey);

    if (!admission.accepted) {
      this.metrics.recordAdmissionRejection("websocket", admission.reason);
      rejectPreviewUpgrade(socket, 503, "Preview WebSocket limit reached");
      return;
    }

    const admissionLifecycle = {
      released: false,
      release() {
        if (admissionLifecycle.released) return;

        admissionLifecycle.released = true;
        admission.release();
      }
    };

    socket.once("close", admissionLifecycle.release);

    let target: ResolvedPreviewTarget | null = null;
    try {
      target = await this.options.resolveTarget(owner);
    } catch {
      // Treat missing/corrupt owner state as unavailable without exposing it.
    }

    if (!target) {
      admissionLifecycle.release();
      rejectPreviewUpgrade(socket, 404, "Preview not active");
      return;
    }

    const basePath = buildPreviewBasePath(owner);
    const requestedEgressUrl = readPreviewEgressUrl(request.url);

    if (requestedEgressUrl && target.networkMode !== "deskcue-host") {
      admissionLifecycle.release();
      rejectPreviewUpgrade(socket, 403, "Host-routed Preview networking is disabled");
      return;
    }

    let connection: PreviewWebSocketContext;
    try {
      if (requestedEgressUrl) {
        const resolved = await resolvePreviewWebSocketEgressTarget(requestedEgressUrl, this.options.resolveEgressTarget);

        connection = {
          egress: true,
          lookup: resolved.lookup,
          targetUrl: resolved.url,
          viewerKey
        };
      } else {
        const targetUrl = buildPreviewTargetUrl(request.url ?? "/", target.origin, {
          basePath,
          isDeskCueAccessToken,
          ticketPathSegment: PREVIEW_TICKET_PATH_SEGMENT,
          ticketQueryKey: PREVIEW_TICKET_QUERY_KEY
        });

        targetUrl.protocol = "ws:";
        connection = {
          egress: false,
          targetUrl,
          viewerKey
        };
      }
    } catch {
      admissionLifecycle.release();
      rejectPreviewUpgrade(socket, 502, "Preview WebSocket target is unavailable or blocked");
      return;
    }

    try {
      this.webSocketServer.handleUpgrade(request, socket, head, (client) => {
        const metrics = this.metrics.startWebSocket();
        const clientLifecycle = {
          finish: () => {
            metrics.finish();
            admissionLifecycle.release();
            this.clientSockets.delete(client);
          }
        };

        this.clientSockets.add(client);
        client.once("close", clientLifecycle.finish);
        if (this.closed) {
          client.close(1012, "Preview proxy is shutting down");
          return;
        }

        try {
          this.connectUpstreamWebSocket(
            client,
            request,
            owner,
            target,
            connection,
            metrics
          );
        } catch {
          metrics.recordError();
          client.close(1011, "Local preview WebSocket unavailable");
        }
      });
    } catch {
      admissionLifecycle.release();
      rejectPreviewUpgrade(socket, 502, "Preview WebSocket upgrade failed");
    }
  }

  private isWebSocketAuthorized(request: IncomingMessage, owner: PreviewOwner, ticket: string | null) {
    if (!readPreviewAuthRequired(this.options.authRequired)) return true;
    if (this.ticketRegistry.validate(ticket, owner)) return true;

    const device = accessDeviceStore.authenticateToken(readAccessTokenFromWebSocketRequest(request));

    return Boolean(device) || isTrustedLoopbackBrowserRequest(request);
  }

  private connectUpstreamWebSocket(
    client: WebSocket,
    request: IncomingMessage,
    owner: PreviewOwner,
    target: ResolvedPreviewTarget,
    context: PreviewWebSocketContext,
    metrics: PreviewWebSocketMetricTracker
  ) {
    const protocols = readWebSocketProtocols(request.headers["sec-websocket-protocol"]);
    const { httpUrl, websocketUrl } = resolvePreviewWebSocketTargetUrls(context.targetUrl);
    const upstream = new WebSocket(websocketUrl, protocols, {
      handshakeTimeout: PREVIEW_PROXY_LIMITS.connectTimeoutMs,
      headers: buildPreviewRequestHeaders(request.headers, httpUrl, {
        cookie: context.egress
          ? this.cookieJar.read(owner, context.viewerKey, httpUrl)
          : undefined,
        forwardAuthorization:
          !previewEgressMustStripAuthorization(request.url) &&
          !isDeskCueAuthorization(request.headers.authorization)
      }),
      lookup: context.lookup,
      maxPayload: PREVIEW_PROXY_LIMITS.maxWebSocketMessageBytes,
      origin: context.egress ? httpUrl.origin : target.origin
    });

    this.upstreamSockets.add(upstream);
    upstream.once("close", () => this.upstreamSockets.delete(upstream));
    relayPreviewWebSockets(client, upstream, metrics);

    client.once("error", () => {
      metrics.recordError();
      upstream.terminate();
    });
    upstream.once("error", () => {
      metrics.recordError();
      client.close(1011, "Local preview WebSocket unavailable");
    });
  }

  private readWebSocketViewerKey(
    request: IncomingMessage,
    owner: PreviewOwner,
    ticket: string | null
  ) {
    const ticketViewer = this.ticketRegistry.readViewerKey(ticket, owner);

    if (ticketViewer) return ticketViewer;

    return accessDeviceStore.authenticateToken(readAccessTokenFromWebSocketRequest(request))?.id ??
      "local-preview";
  }

}
