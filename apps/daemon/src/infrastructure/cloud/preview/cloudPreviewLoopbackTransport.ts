import { once } from "node:events";
import http from "node:http";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import https from "node:https";
import WebSocket from "ws";
import type { RawData } from "ws";

import {
  CLOUD_PREVIEW_CHUNK_BYTES,
  CLOUD_PREVIEW_HTTP_MAX_RESPONSE_BYTES,
  CLOUD_PREVIEW_WS_MAX_MESSAGE_BYTES
} from "@deskcue/protocol/cloud";
import type { CloudPreviewHeader } from "@deskcue/protocol/cloud";
import { PreviewCookieJar } from "#http/routes/system/preview/egress/previewCookieJar";
import { buildPreviewEgressPath } from "#http/routes/system/preview/egress/previewEgressTarget";
import { resolvePreviewWebSocketTargetUrls } from "#http/routes/system/preview/egress/previewWebSocketTarget";
import {
  createPreviewJavaScriptBootstrap,
  isPreviewJavaScriptContent,
  isRewritablePreviewContent,
  MAX_REWRITABLE_PREVIEW_JAVASCRIPT_BYTES,
  readRewritablePreviewBody,
  rewritePreviewContent,
  rewritePreviewJavaScriptAssetLiterals
} from "#http/routes/system/preview/previewContentRewrite";
import {
  buildPreviewRequestHeaders,
  copyPreviewResponseHeaders,
  isDeskCueAuthorization
} from "#http/routes/system/preview/previewProxyHeaders";
import { PREVIEW_PROXY_LIMITS } from "#http/routes/system/preview/previewProxyLimits";
import { waitForPreviewSocketConnect } from "#http/routes/system/preview/previewSocketConnectDeadline";

import type { AuthorizedCloudPreviewRequest } from "./cloudPreviewRequestPolicy.ts";
import type {
  CloudPreviewHttpResult,
  CloudPreviewWebSocketEvents,
  CloudPreviewWebSocketSession
} from "./cloudPreviewStreamBridge.ts";

const MAX_LOCAL_WS_BUFFERED_BYTES = 4 * 1024 * 1024;

function collectResponseHeaders(
  input: IncomingHttpHeaders,
  options: {
    contentRewritten: boolean;
    exposeCookies: boolean;
    preserveCookiePaths?: boolean;
    preserveSecurityHeaders?: boolean;
    requestOrigin: string | undefined;
    upstreamOrigin: string;
  }
) {
  const values = new Map<string, number | string | string[]>();
  copyPreviewResponseHeaders(input, {
    getHeader: (name) => values.get(name),
    setHeader(name, value) {
      const storedValue = typeof value === "number" || typeof value === "string"
        ? value
        : Array.from(value);
      values.set(name, storedValue);
    }
  }, {
    basePath: "",
    contentRewritten: options.contentRewritten,
    exposeCookies: options.exposeCookies,
    preserveCookiePaths: options.preserveCookiePaths,
    preserveSecurityHeaders: options.preserveSecurityHeaders,
    requestOrigin: options.requestOrigin,
    resourceBasePath: "",
    upstreamOrigin: options.upstreamOrigin
  });
  const headers: CloudPreviewHeader[] = [];
  for (const [name, rawValue] of values) {
    for (const value of Array.isArray(rawValue) ? rawValue : [rawValue]) {
      headers.push([name, String(value)]);
    }
  }
  return headers;
}

function isLocalPreviewTarget(target: URL, localTarget: AuthorizedCloudPreviewRequest["target"]) {
  if (target.origin === localTarget.origin) return true;
  const hostname = target.hostname.replace(/^\[|\]$/gu, "");
  return (
    (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") &&
    Number(target.port || (target.protocol === "https:" ? 443 : 80)) === localTarget.port
  );
}

function rewriteRedirect(location: string, request: AuthorizedCloudPreviewRequest) {
  try {
    const target = new URL(location, request.targetUrl);
    if (target.protocol !== "http:" && target.protocol !== "https:") return null;
    if (isLocalPreviewTarget(target, request.target)) return `${target.pathname}${target.search}${target.hash}`;
    if (request.target.networkMode === "device-direct") return target.href;
    return buildPreviewEgressPath("", target, {
      stripAuthorization: target.origin !== request.targetUrl.origin
    });
  } catch {
    return null;
  }
}

function resolveCloudPreviewDocumentUrl(
  referer: string | undefined,
  request: AuthorizedCloudPreviewRequest
) {
  if (!referer) return request.targetUrl;
  try {
    const parsed = new URL(referer);
    return new URL(`${parsed.pathname}${parsed.search}`, request.target.origin);
  } catch {
    return request.targetUrl;
  }
}

async function* boundedBody(response: IncomingMessage, signal: AbortSignal) {
  let total = 0;
  try {
    for await (const rawChunk of response) {
      signal.throwIfAborted();
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      total += chunk.byteLength;
      if (total > CLOUD_PREVIEW_HTTP_MAX_RESPONSE_BYTES) throw new Error("preview_response_too_large");
      for (let offset = 0; offset < chunk.byteLength; offset += CLOUD_PREVIEW_CHUNK_BYTES) {
        yield chunk.subarray(offset, offset + CLOUD_PREVIEW_CHUNK_BYTES);
      }
    }
  } finally {
    if (!response.complete) response.destroy();
  }
}

async function pumpRequestBody(
  request: import("node:http").ClientRequest,
  body: AsyncIterable<Buffer>,
  signal: AbortSignal
) {
  for await (const chunk of body) {
    signal.throwIfAborted();
    if (!request.write(chunk)) await once(request, "drain");
  }
  request.end();
}

function bufferResult(status: number, headers: CloudPreviewHeader[], body: Buffer): CloudPreviewHttpResult {
  return {
    body: (async function* () { if (body.byteLength > 0) yield body; })(),
    cancel() {},
    contentLength: body.byteLength,
    headers,
    status
  };
}

function emptyResult(status: number, headers: CloudPreviewHeader[]): CloudPreviewHttpResult {
  return bufferResult(status, headers, Buffer.alloc(0));
}

function toIncomingHeaders(headers: ReadonlyArray<readonly [string, string]>) {
  return Object.fromEntries(headers) as IncomingHttpHeaders;
}

function readDeclaredResponseLength(value: string | undefined) {
  if (value === undefined || !/^\d+$/u.test(value)) return null;
  const length = Number(value);
  return Number.isSafeInteger(length) ? length : null;
}

function toBuffer(data: RawData) {
  if (Buffer.isBuffer(data)) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function abortError() {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

/**
 * Cloud transport adapter over the same Preview proxy services used by the
 * local HTTP controller. Host selection remains entirely owner-backed: Cloud
 * can route only the active local target or a locally-authorized egress route.
 */
export class CloudPreviewProxyTransport {
  private readonly cookieJar = new PreviewCookieJar();

  close() {
    this.cookieJar.clear();
  }

  executeHttp(
    request: AuthorizedCloudPreviewRequest & {
      body: AsyncIterable<Buffer>;
      contentLength: number | null;
      signal: AbortSignal;
    }
  ): Promise<CloudPreviewHttpResult> {
    request.signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const inputHeaders = toIncomingHeaders(request.headers);
      const transport = request.targetUrl.protocol === "https:" ? https : http;
      const cookie = request.egress
        ? this.cookieJar.read(request.owner, request.viewerKey, request.targetUrl)
        : undefined;
      const upstream = transport.request(request.targetUrl, {
        headers: buildPreviewRequestHeaders(inputHeaders, request.targetUrl, {
          cookie,
          forwardAuthorization:
            !request.stripAuthorization && !isDeskCueAuthorization(inputHeaders.authorization)
        }),
        lookup: request.lookup,
        maxHeaderSize: 32 * 1024,
        method: request.method,
        timeout: PREVIEW_PROXY_LIMITS.idleTimeoutMs
      });
      let settled = false;
      const abort = () => upstream.destroy(abortError());
      const cleanup = () => request.signal.removeEventListener("abort", abort);
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      request.signal.addEventListener("abort", abort, { once: true });
      upstream.once("timeout", () => upstream.destroy(new Error("preview_upstream_idle_timeout")));
      upstream.once("error", fail);
      const connectDeadline = setTimeout(
        () => upstream.destroy(new Error("preview_upstream_connect_timeout")),
        PREVIEW_PROXY_LIMITS.connectTimeoutMs
      );
      connectDeadline.unref?.();
      upstream.once("socket", (socket) => {
        const stopWaiting = waitForPreviewSocketConnect(socket, () => clearTimeout(connectDeadline));
        upstream.once("close", stopWaiting);
      });
      upstream.once("close", () => clearTimeout(connectDeadline));
      upstream.once("response", (response) => {
        if (settled) {
          response.destroy();
          return;
        }
        settled = true;
        cleanup();
        void this.createHttpResult(request, inputHeaders, response).then(resolve, reject);
      });
      void pumpRequestBody(upstream, request.body, request.signal).catch((error: Error) => {
        if (!upstream.destroyed) upstream.destroy(error);
      });
    });
  }

  openWebSocket(
    request: AuthorizedCloudPreviewRequest & { protocols: string[]; signal: AbortSignal },
    events: CloudPreviewWebSocketEvents
  ): Promise<CloudPreviewWebSocketSession> {
    request.signal.throwIfAborted();
    const { httpUrl, websocketUrl } = resolvePreviewWebSocketTargetUrls(request.targetUrl);
    const inputHeaders = toIncomingHeaders(request.headers);
    const cookie = request.egress
      ? this.cookieJar.read(request.owner, request.viewerKey, httpUrl)
      : undefined;
    const socket = new WebSocket(websocketUrl, request.protocols, {
      followRedirects: false,
      headers: buildPreviewRequestHeaders(inputHeaders, httpUrl, {
        cookie,
        forwardAuthorization:
          !request.stripAuthorization && !isDeskCueAuthorization(inputHeaders.authorization)
      }),
      handshakeTimeout: PREVIEW_PROXY_LIMITS.connectTimeoutMs,
      lookup: request.lookup,
      maxPayload: CLOUD_PREVIEW_WS_MAX_MESSAGE_BYTES,
      origin: httpUrl.origin,
      perMessageDeflate: false
    });

    return new Promise((resolve, reject) => {
      let settled = false;
      let responseHeaders: CloudPreviewHeader[] = [];
      const abort = () => {
        socket.terminate();
        if (!settled) reject(abortError());
      };
      request.signal.addEventListener("abort", abort, { once: true });
      socket.once("upgrade", (response) => {
        if (request.egress) {
          this.cookieJar.store(
            request.owner,
            request.viewerKey,
            httpUrl,
            response.headers["set-cookie"]
          );
        }
        responseHeaders = collectResponseHeaders(response.headers, {
          contentRewritten: false,
          exposeCookies: !request.egress,
          preserveCookiePaths: true,
          preserveSecurityHeaders: true,
          requestOrigin: inputHeaders.origin,
          upstreamOrigin: httpUrl.origin
        });
      });
      socket.once("open", () => {
        if (request.signal.aborted) {
          abort();
          return;
        }
        settled = true;
        resolve({
          close(code, reason) {
            if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
              socket.close(code, reason);
            }
          },
          headers: responseHeaders,
          protocol: socket.protocol || null,
          send(messageBody, binary) {
            if (socket.readyState !== WebSocket.OPEN ||
                socket.bufferedAmount + messageBody.byteLength > MAX_LOCAL_WS_BUFFERED_BYTES) {
              socket.close(1013, "preview_backpressure");
              return;
            }
            socket.send(messageBody, { binary }, (error) => {
              if (error && socket.readyState === WebSocket.OPEN) socket.close(1011, "preview_send_failed");
            });
          }
        });
      });
      socket.on("message", (data, binary) => {
        if (settled) events.onMessage(toBuffer(data), binary);
      });
      socket.once("close", (code, reason) => {
        request.signal.removeEventListener("abort", abort);
        if (!settled) {
          reject(new Error("preview_websocket_closed_before_open"));
          return;
        }
        events.onClose(code, reason.toString());
      });
      socket.once("error", (error) => {
        if (!settled) reject(error);
      });
      socket.once("unexpected-response", (_request, response) => {
        response.resume();
        if (!settled) reject(new Error("preview_websocket_upgrade_rejected"));
        socket.terminate();
      });
    });
  }

  private async createHttpResult(
    request: AuthorizedCloudPreviewRequest & { signal: AbortSignal },
    inputHeaders: IncomingHttpHeaders,
    response: IncomingMessage
  ): Promise<CloudPreviewHttpResult> {
    const declaredLength = readDeclaredResponseLength(response.headers["content-length"]);
    if (declaredLength !== null && declaredLength > CLOUD_PREVIEW_HTTP_MAX_RESPONSE_BYTES) {
      response.destroy();
      throw new Error("preview_response_too_large");
    }
    if (request.egress) {
      this.cookieJar.store(
        request.owner,
        request.viewerKey,
        request.targetUrl,
        response.headers["set-cookie"]
      );
    }
    const location = response.headers.location;
    if (location) {
      const rewritten = rewriteRedirect(location, request);
      if (!rewritten) {
        response.destroy();
        throw new Error("preview_external_origin_rejected");
      }
      response.headers.location = rewritten;
    }

    const contentType = response.headers["content-type"];
    const javascript = isPreviewJavaScriptContent(contentType);
    const rewriteNextJavaScript = javascript &&
      /^\/_next\/static\/chunks\/(?:app(?:\/|-pages-internals)|main-app(?:\.|\/)|pages\/)/u
        .test(request.targetUrl.pathname);
    const rewrittenContent = isRewritablePreviewContent(contentType) || javascript;
    const headers = collectResponseHeaders(response.headers, {
      contentRewritten: rewrittenContent,
      exposeCookies: !request.egress,
      preserveCookiePaths: true,
      preserveSecurityHeaders: true,
      requestOrigin: inputHeaders.origin,
      upstreamOrigin: request.targetUrl.origin
    });
    if (request.method === "HEAD" || !response.readable) {
      response.resume();
      return emptyResult(response.statusCode ?? 502, headers);
    }

    if (rewrittenContent && contentType) {
      const maxBytes = javascript
        ? MAX_REWRITABLE_PREVIEW_JAVASCRIPT_BYTES
        : undefined;
      const source = await readRewritablePreviewBody(response, maxBytes);
      let body: Buffer;
      if (javascript) {
        const bootstrap = Buffer.from(createPreviewJavaScriptBootstrap("", {
          localOrigin: request.target.origin,
          networkMode: request.target.networkMode,
          upstreamUrl: resolveCloudPreviewDocumentUrl(inputHeaders.referer, request)
        }));
        body = Buffer.concat([
          bootstrap,
          rewriteNextJavaScript
            ? rewritePreviewJavaScriptAssetLiterals(source, "")
            : source
        ]);
      } else {
        body = rewritePreviewContent(source, contentType, "", {
          localOrigin: request.target.origin,
          networkMode: request.target.networkMode,
          upstreamUrl: request.targetUrl
        });
      }
      if (body.byteLength > CLOUD_PREVIEW_HTTP_MAX_RESPONSE_BYTES) throw new Error("preview_response_too_large");
      return bufferResult(response.statusCode ?? 502, headers, body);
    }

    return {
      body: boundedBody(response, request.signal),
      cancel: () => { response.destroy(abortError()); },
      contentLength: declaredLength,
      headers,
      status: response.statusCode ?? 502
    };
  }
}

// Compatibility exports keep focused callers small while production uses one
// long-lived transport instance so viewer-scoped egress cookies survive streams.
export function executeCloudPreviewLoopbackHttp(
  request: AuthorizedCloudPreviewRequest & { body: Buffer; signal: AbortSignal }
) {
  return new CloudPreviewProxyTransport().executeHttp({
    ...request,
    body: (async function* () { if (request.body.byteLength > 0) yield request.body; })(),
    contentLength: request.body.byteLength
  });
}

export function openCloudPreviewLoopbackWebSocket(
  request: AuthorizedCloudPreviewRequest & { protocols: string[]; signal: AbortSignal },
  events: CloudPreviewWebSocketEvents
) {
  return new CloudPreviewProxyTransport().openWebSocket(request, events);
}
