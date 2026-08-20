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
  readPreviewEgressUrl,
  resolvePreviewEgressTarget
} from "./egress/previewEgressTarget.ts";
import type { PreviewEgressResolver } from "./egress/previewEgressTarget.ts";
import { resolvePreviewWebSocketTargetUrls } from "./egress/previewWebSocketTarget.ts";
import { discoverPreviewCandidates, waitForPreviewPort } from "./previewCandidateDiscovery.ts";
import { PreviewHttpRelay } from "./previewHttpRelay.ts";
import {
  buildPreviewRequestHeaders,
  createPreviewRootRequestRedirectHandler,
  isDeskCueAuthorization
} from "./previewProxyHeaders.ts";
import { PREVIEW_PROXY_LIMITS } from "./previewProxyLimits.ts";
import type {
  PreviewConfiguredPortReader,
  PreviewOwner,
  PreviewTargetResolver,
  ResolvedPreviewTarget
} from "./previewTargetResolver.ts";
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

function buildTargetUrl(requestUrl: string, origin: string, basePath?: string) {
  const incoming = new URL(requestUrl || "/", "http://deskcue.local");
  incoming.searchParams.delete(PREVIEW_TICKET_QUERY_KEY);
  incoming.searchParams.delete("access_token");
  incoming.searchParams.delete("token");
  const sourcePath = basePath && incoming.pathname.startsWith(basePath)
    ? incoming.pathname.slice(basePath.length)
    : incoming.pathname;
  const withoutTicketPath = sourcePath.replace(
    new RegExp(`^/?${PREVIEW_TICKET_PATH_SEGMENT}/[^/]+`),
    ""
  );
  const pathname = `/${withoutTicketPath.replace(/^\/+/, "")}`.replace(/\\/g, "/");
  return new URL(`${pathname}${incoming.search}`, origin);
}

function readBrowserFacingProtocol(request: express.Request) {
  const requestHost = request.get("host")?.toLowerCase();
  for (const value of [request.get("origin"), request.get("referer")]) {
    if (!value) continue;
    try {
      const url = new URL(value);
      const trustedOrigin = url.host.toLowerCase() === requestHost ||
        daemonConfig.allowedOrigins.includes(url.origin);
      if (trustedOrigin && (url.protocol === "http:" || url.protocol === "https:")) return url.protocol.slice(0, -1);
    } catch {
      // Fall through to the next browser-facing URL or the direct request.
    }
  }
  return request.secure || request.protocol === "https" ? "https" : "http";
}

function buildPreviewUrl(request: express.Request, basePath: string, previewProxyPort?: number) {
  if (!previewProxyPort) return `${basePath}/`;
  const protocol = readBrowserFacingProtocol(request);
  const origin = new URL(`${protocol}://${request.get("host") ?? "localhost"}`);
  origin.port = String(previewProxyPort);
  origin.pathname = `${basePath}/`;
  origin.search = "";
  origin.hash = "";
  return origin.toString();
}

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
      let finalized = false;
      const finalize = () => {
        if (finalized) return;
        finalized = true;
        metrics.finish(response.writableEnded ? response.statusCode : 499);
        admission.release();
      };
      response.once("finish", finalize);
      response.once("close", finalize);

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
          ? await this.readEgressHttpTarget(requestedEgressUrl)
          : {
            egress: false as const,
            lookup: undefined,
            url: buildTargetUrl(request.url, target.origin)
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
      !this.readAuthRequired() ||
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
    let admissionReleased = false;
    const releaseAdmission = () => {
      if (admissionReleased) return;
      admissionReleased = true;
      admission.release();
    };
    socket.once("close", releaseAdmission);

    let target: ResolvedPreviewTarget | null = null;
    try {
      target = await this.options.resolveTarget(owner);
    } catch {
      // Treat missing/corrupt owner state as unavailable without exposing it.
    }
    if (!target) {
      releaseAdmission();
      rejectPreviewUpgrade(socket, 404, "Preview not active");
      return;
    }

    const basePath = buildPreviewBasePath(owner);
    const requestedEgressUrl = readPreviewEgressUrl(request.url);
    if (requestedEgressUrl && target.networkMode !== "deskcue-host") {
      releaseAdmission();
      rejectPreviewUpgrade(socket, 403, "Host-routed Preview networking is disabled");
      return;
    }

    let connection: PreviewWebSocketContext;
    try {
      if (requestedEgressUrl) {
        const resolved = await this.readEgressWebSocketTarget(requestedEgressUrl);
        connection = {
          egress: true,
          lookup: resolved.lookup,
          targetUrl: resolved.url,
          viewerKey
        };
      } else {
        const targetUrl = buildTargetUrl(request.url ?? "/", target.origin, basePath);
        targetUrl.protocol = "ws:";
        connection = {
          egress: false,
          targetUrl,
          viewerKey
        };
      }
    } catch {
      releaseAdmission();
      rejectPreviewUpgrade(socket, 502, "Preview WebSocket target is unavailable or blocked");
      return;
    }

    try {
      this.webSocketServer.handleUpgrade(request, socket, head, (client) => {
        const metrics = this.metrics.startWebSocket();
        const finish = () => {
          metrics.finish();
          releaseAdmission();
          this.clientSockets.delete(client);
        };
        this.clientSockets.add(client);
        client.once("close", finish);
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
      releaseAdmission();
      rejectPreviewUpgrade(socket, 502, "Preview WebSocket upgrade failed");
    }
  }

  private isWebSocketAuthorized(request: IncomingMessage, owner: PreviewOwner, ticket: string | null) {
    if (!this.readAuthRequired()) return true;
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

  private async readEgressHttpTarget(target: URL) {
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw new Error("Preview HTTP egress target is invalid.");
    }
    const resolved = this.options.resolveEgressTarget
      ? await this.options.resolveEgressTarget(target)
      : await resolvePreviewEgressTarget(target, { allowLoopback: true });
    return { ...resolved, egress: true as const };
  }

  private async readEgressWebSocketTarget(target: URL) {
    if (target.protocol !== "ws:" && target.protocol !== "wss:") {
      throw new Error("Preview WebSocket egress target is invalid.");
    }
    const validationUrl = new URL(target);
    validationUrl.protocol = target.protocol === "wss:" ? "https:" : "http:";
    const resolved = this.options.resolveEgressTarget
      ? await this.options.resolveEgressTarget(validationUrl)
      : await resolvePreviewEgressTarget(validationUrl, { allowLoopback: true });
    const url = new URL(resolved.url);
    url.protocol = target.protocol;
    return { lookup: resolved.lookup, url };
  }

  private readAuthRequired() { return this.options.authRequired?.() ?? daemonConfig.authRequired; }
}

type PreviewWebSocketContext = {
  egress: boolean;
  lookup?: LookupFunction;
  targetUrl: URL;
  viewerKey: string;
};
