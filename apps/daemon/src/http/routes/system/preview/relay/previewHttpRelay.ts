import type express from "express";
import http from "node:http";
import type { ClientRequest, IncomingMessage } from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { Transform } from "node:stream";

import {
  createPreviewJavaScriptBootstrap,
  isPreviewJavaScriptContent,
  isRewritablePreviewContent,
  MAX_REWRITABLE_PREVIEW_JAVASCRIPT_BYTES,
  readRewritablePreviewBody,
  rewritePreviewJavaScriptAssetLiterals,
  rewritePreviewContent
} from "./previewContentRewrite.ts";
import {
  buildPreviewRequestHeaders,
  copyPreviewResponseHeaders,
  isDeskCueAuthorization
} from "./previewProxyHeaders.ts";
import { PreviewCookieJar } from "../egress/previewCookieJar.ts";
import { buildPreviewEgressPath, readPreviewEgressUrl } from "../egress/previewEgressTarget.ts";
import { PREVIEW_PROXY_LIMITS } from "../previewProxyLimits.ts";
import { waitForPreviewSocketConnect } from "../previewSocketConnectDeadline.ts";
import type { PreviewOwner, ResolvedPreviewTarget } from "../previewTargetResolver.ts";
import type { PreviewHttpMetricTracker } from "../runtime/previewProxyMetrics.ts";
import { PreviewRewriteAdmission } from "../runtime/previewRewriteAdmission.ts";

export type PreviewHttpContext = {
  basePath: string;
  egress: boolean;
  localTarget: ResolvedPreviewTarget;
  lookup?: LookupFunction;
  metrics: PreviewHttpMetricTracker;
  owner: PreviewOwner;
  resourceBasePath: string;
  stripAuthorization: boolean;
  targetUrl: URL;
  viewerKey: string;
};

function shouldRewriteApplicationJavaScript(pathname: string) {
  return (
    /^\/_next\/static\/chunks\/(?:app(?:\/|-pages-internals)|main-app(?:\.|\/)|pages\/)/.test(pathname) ||
    /^\/(?:src\/|node_modules\/\.vite\/|@(?:vite|id|fs)\/|@react-refresh(?:\/|$))/.test(pathname)
  );
}

function resolvePreviewDocumentUrl(
  request: express.Request,
  context: PreviewHttpContext
) {
  try {
    const referer = request.headers.referer;

    if (!referer) return context.targetUrl;

    const parsed = new URL(referer);
    const requestUrl = `${parsed.pathname}${parsed.search}`;
    const egressUrl = readPreviewEgressUrl(requestUrl);

    if (egressUrl) return egressUrl;
    if (parsed.pathname === context.resourceBasePath) return new URL(`/${parsed.search}`, context.localTarget.origin);

    if (parsed.pathname.startsWith(`${context.resourceBasePath}/`)) {
      const suffix = parsed.pathname.slice(context.resourceBasePath.length);

      return new URL(`${suffix}${parsed.search}`, context.localTarget.origin);
    }
  } catch {
    // Fall back to the current resource URL when the browser omits or corrupts Referer.
  }

  return context.targetUrl;
}

function isLocalPreviewTarget(target: URL, localTarget: ResolvedPreviewTarget) {
  if (target.origin === localTarget.origin) return true;

  const hostname = target.hostname.replace(/^\[|\]$/g, "");

  return (
    (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") &&
    Number(target.port || (target.protocol === "https:" ? 443 : 80)) === localTarget.port
  );
}

function rewriteRedirect(location: string, context: PreviewHttpContext) {
  try {
    const target = new URL(location, context.targetUrl);

    if (target.protocol !== "http:" && target.protocol !== "https:") return null;

    if (isLocalPreviewTarget(target, context.localTarget)) {
      return `${context.resourceBasePath}${target.pathname}${target.search}${target.hash}`;
    }

    return context.localTarget.networkMode === "deskcue-host"
      ? buildPreviewEgressPath(context.resourceBasePath, target, {
        stripAuthorization: target.origin !== context.targetUrl.origin
      })
      : target.href;
  } catch {
    return null;
  }
}

function createByteLimitTransform(maxBytes: number, onBytes?: (bytes: number) => void) {
  let bytes = 0;

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.byteLength;
      onBytes?.(chunk.byteLength);
      callback(bytes <= maxBytes ? null : new Error("Preview stream byte limit exceeded."), chunk);
    }
  });
}

function readContentLength(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return null;

  const parsed = Number(value);

  return Number.isSafeInteger(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

export class PreviewHttpRelay {
  private readonly activeRequests = new Set<ClientRequest>();
  private readonly rewriteAdmission = new PreviewRewriteAdmission();

  constructor(private readonly cookieJar: PreviewCookieJar) {}

  close() {
    this.rewriteAdmission.close();
    for (const request of this.activeRequests) request.destroy();
  }

  async proxy(
    request: express.Request,
    response: express.Response,
    context: PreviewHttpContext
  ) {
    const contentLength = readContentLength(request.headers["content-length"]);

    if (contentLength !== null && contentLength > PREVIEW_PROXY_LIMITS.maxRequestBytes) {
      response.status(413).json({ error: "Preview request body is too large." });
      return;
    }

    const cookie = context.egress
      ? this.cookieJar.read(context.owner, context.viewerKey, context.targetUrl)
      : undefined;
    const transport = context.targetUrl.protocol === "https:" ? https : http;
    const upstreamRequest = transport.request(context.targetUrl, {
      headers: buildPreviewRequestHeaders(request.headers, context.targetUrl, {
        cookie,
        forwardAuthorization:
          !context.stripAuthorization &&
          !isDeskCueAuthorization(request.headers.authorization)
      }),
      lookup: context.lookup,
      maxHeaderSize: 32 * 1024,
      method: request.method,
      timeout: PREVIEW_PROXY_LIMITS.idleTimeoutMs
    });

    this.activeRequests.add(upstreamRequest);
    const requestLifecycle = {
      release: () => this.activeRequests.delete(upstreamRequest)
    };

    upstreamRequest.once("close", requestLifecycle.release);

    upstreamRequest.once("timeout", () => upstreamRequest.destroy(new Error("Preview upstream timed out.")));

    upstreamRequest.once("error", () => {
      if (!response.headersSent) {
        response.status(502).json({ error: "The local preview server is unavailable." });
      } else {
        response.destroy();
      }
    });

    request.once("aborted", () => upstreamRequest.destroy());

    const connectDeadline = setTimeout(
      () => upstreamRequest.destroy(new Error("Preview upstream connection timed out.")),
      PREVIEW_PROXY_LIMITS.connectTimeoutMs
    );

    connectDeadline.unref?.();
    upstreamRequest.once("socket", (socket) => {
      const stopWaiting = waitForPreviewSocketConnect(socket, () => clearTimeout(connectDeadline));

      upstreamRequest.once("close", stopWaiting);
    });

    upstreamRequest.once("close", () => clearTimeout(connectDeadline));

    upstreamRequest.once("response", (upstreamResponse) => {
      void this.forwardResponse(request, response, upstreamResponse, context).catch(() => {
        upstreamResponse.destroy();
        if (!response.headersSent) {
          response.status(502).json({ error: "The preview response could not be processed." });
        } else if (!response.writableEnded) {
          response.destroy();
        }
      });
    });

    if (request.readableEnded) {
      upstreamRequest.end();
      return;
    }

    const limiter = createByteLimitTransform(
      PREVIEW_PROXY_LIMITS.maxRequestBytes,
      context.metrics.addRequestBytes
    );

    limiter.once("error", () => {
      upstreamRequest.destroy();
      if (!response.headersSent) response.status(413).json({ error: "Preview request body is too large." });
    });

    request.pipe(limiter).pipe(upstreamRequest);
  }

  private async forwardResponse(
    request: express.Request,
    response: express.Response,
    upstreamResponse: IncomingMessage,
    context: PreviewHttpContext
  ) {
    const contentLength = readContentLength(upstreamResponse.headers["content-length"]);

    if (contentLength !== null && contentLength > PREVIEW_PROXY_LIMITS.maxResponseBytes) {
      upstreamResponse.destroy();
      response.status(502).json({ error: "Preview response is too large." });
      return;
    }

    const location = upstreamResponse.headers.location;

    if (location) {
      const rewritten = rewriteRedirect(location, context);

      if (!rewritten) {
        upstreamResponse.destroy();
        response.status(502).json({ error: "Preview server attempted a blocked external redirect." });
        return;
      }

      upstreamResponse.headers.location = rewritten;
    }

    const contentType = upstreamResponse.headers["content-type"];
    const javascript = isPreviewJavaScriptContent(contentType);
    const rewriteApplicationJavaScript =
      javascript && shouldRewriteApplicationJavaScript(context.targetUrl.pathname);
    if (
      rewriteApplicationJavaScript &&
      contentLength !== null &&
      contentLength > MAX_REWRITABLE_PREVIEW_JAVASCRIPT_BYTES
    ) {
      upstreamResponse.destroy();
      response.status(502).json({ error: "Preview JavaScript is too large to rewrite safely." });
      return;
    }

    const contentRewritten = isRewritablePreviewContent(contentType) || javascript;

    if (context.egress) {
      this.cookieJar.store(
        context.owner,
        context.viewerKey,
        context.targetUrl,
        upstreamResponse.headers["set-cookie"]
      );
    }

    const rewriteLifecycle = {
      lease: null as { release: () => void } | null,
      release() {
        rewriteLifecycle.lease?.release();
        rewriteLifecycle.lease = null;
      }
    };

    if (rewriteApplicationJavaScript) {
      const controller = new AbortController();
      const abort = controller.abort.bind(controller);

      request.once("aborted", abort);

      response.once("close", abort);
      const admission = await this.rewriteAdmission.acquire(controller.signal);

      request.off("aborted", abort);

      response.off("close", abort);
      if (!admission.accepted) {
        upstreamResponse.destroy();
        if (admission.reason !== "aborted" && !response.destroyed) {
          response.status(503).json({ error: "Preview JavaScript rewrite capacity is busy." });
        }

        return;
      }

      rewriteLifecycle.lease = admission;
      response.once("finish", rewriteLifecycle.release);
      response.once("close", rewriteLifecycle.release);
    }

    response.status(upstreamResponse.statusCode ?? 502);
    copyPreviewResponseHeaders(upstreamResponse.headers, response, {
      basePath: context.basePath,
      contentRewritten,
      exposeCookies: !context.egress,
      requestOrigin: request.headers.origin,
      resourceBasePath: context.resourceBasePath,
      upstreamOrigin: context.targetUrl.origin
    });
    if (contentType?.toLowerCase().includes("text/html")) {
      // Preview root-relative assets depend on the full same-origin document
      // URL. Upstream `no-referrer`/`origin` policies would erase the egress
      // route, so enforce a narrow policy that never leaks it cross-origin.
      response.setHeader("referrer-policy", "same-origin");
      response.setHeader(
        "content-security-policy",
        "sandbox allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-same-origin allow-scripts"
      );

      response.setHeader(
        "permissions-policy",
        "camera=(), geolocation=(), microphone=(), payment=(), usb=()"
      );
    }

    if (contentRewritten && contentType) {
      if (javascript) {
        const bootstrap = Buffer.from(createPreviewJavaScriptBootstrap(
          context.resourceBasePath,
          {
            localOrigin: context.localTarget.origin,
            networkMode: context.localTarget.networkMode,
            upstreamUrl: resolvePreviewDocumentUrl(request, context)
          }
        ));

        if (rewriteApplicationJavaScript) {
          const cancelRewrite = upstreamResponse.destroy.bind(upstreamResponse);

          response.once("close", cancelRewrite);

          try {
            const javascriptBody = rewritePreviewJavaScriptAssetLiterals(
              await readRewritablePreviewBody(
                upstreamResponse,
                MAX_REWRITABLE_PREVIEW_JAVASCRIPT_BYTES
              ),
              context.resourceBasePath
            );
            const rewritten = Buffer.concat([bootstrap, javascriptBody]);

            context.metrics.addResponseBytes(rewritten.byteLength);

            response.end(rewritten, () => {
              response.off("close", cancelRewrite);
              response.off("close", rewriteLifecycle.release);
              response.off("finish", rewriteLifecycle.release);
              rewriteLifecycle.release();
            });
          } catch {
            response.off("close", cancelRewrite);
            response.off("close", rewriteLifecycle.release);
            response.off("finish", rewriteLifecycle.release);
            rewriteLifecycle.release();
            if (!response.headersSent) {
              response.status(502).json({ error: "Preview JavaScript is too large to rewrite safely." });
            } else {
              response.destroy();
            }
          }

          return;
        }

        const limiter = createByteLimitTransform(
          Math.max(0, PREVIEW_PROXY_LIMITS.maxResponseBytes - bootstrap.byteLength),
          context.metrics.addResponseBytes
        );

        limiter.once("error", () => response.destroy());
        context.metrics.addResponseBytes(bootstrap.byteLength);
        response.write(bootstrap);
        upstreamResponse.pipe(limiter).pipe(response);
        return;
      }

      try {
        const rewritten = rewritePreviewContent(
          await readRewritablePreviewBody(upstreamResponse),
          contentType,
          context.resourceBasePath,
          {
            localOrigin: context.localTarget.origin,
            networkMode: context.localTarget.networkMode,
            upstreamUrl: context.targetUrl
          }
        );

        context.metrics.addResponseBytes(rewritten.byteLength);
        response.end(rewritten);
      } catch {
        if (!response.headersSent) response.status(502).json({ error: "Preview document is too large." });
        else response.destroy();
      }

      return;
    }

    const limiter = createByteLimitTransform(
      PREVIEW_PROXY_LIMITS.maxResponseBytes,
      context.metrics.addResponseBytes
    );

    limiter.once("error", () => response.destroy());
    upstreamResponse.pipe(limiter).pipe(response);
  }
}

// HTTP request/response forwarding belongs with the relay pipeline.
