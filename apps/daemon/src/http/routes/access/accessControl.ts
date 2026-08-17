import type { CorsOptions } from "cors";
import type express from "express";
import type { IncomingMessage } from "node:http";

import { DEFAULT_WEB_PORT } from "@deskcue/protocol";
import { accessDeviceStore, setRequestAccessDevice } from "#access/accessDevices";
import { daemonConfig } from "#config/daemonConfig";

import { readAccessTokenCookie } from "./accessCookies.ts";
import { isAuthorizedCloudInternalRequest } from "./cloudInternalRequestAuth.ts";
import { isTrustedLoopbackBrowserRequest } from "../../hostClient.ts";
import { isLocalInterfaceHost } from "../../networkHosts.ts";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
export const ACCESS_TOKEN_OPTIONAL_ROUTES = new Set([
  "GET /api/health",
  "GET /api/access/link",
  "GET /api/access/link/:pairCode/status",
  "GET /api/assets/ticket/:ticket",
  "POST /api/access/pair",
  "POST /api/access/recover"
]);

function defaultPortForProtocol(protocol: string) {
  if (protocol === "https:") {
    return "443";
  }

  if (protocol === "http:") {
    return "80";
  }

  return "";
}

function isBrowserFacingDeskCuePort(url: URL) {
  const port = url.port || defaultPortForProtocol(url.protocol);
  return port === String(daemonConfig.daemonPort) || port === String(DEFAULT_WEB_PORT);
}

export function isAllowedOrigin(
  origin: string | undefined,
  allowedOrigins = daemonConfig.allowedOrigins,
  authRequired = daemonConfig.authRequired
) {
  if (!authRequired) {
    return true;
  }

  if (!origin) {
    return true;
  }

  if (allowedOrigins.includes(origin)) {
    return true;
  }

  try {
    const url = new URL(origin);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.origin !== origin
    ) {
      return false;
    }
    if (LOOPBACK_HOSTS.has(url.hostname)) {
      return isBrowserFacingDeskCuePort(url);
    }

    return isLocalInterfaceHost(url.hostname) && isBrowserFacingDeskCuePort(url);
  } catch {
    return false;
  }
}

export function createCorsOptions(): CorsOptions {
  return {
    credentials: true,
    origin(origin, callback) {
      callback(null, isAllowedOrigin(origin, daemonConfig.allowedOrigins, daemonConfig.authRequired));
    }
  };
}

function isAccessTokenOptionalRoute(request: express.Request) {
  const routeKey = `${request.method} ${request.path}`;
  if (ACCESS_TOKEN_OPTIONAL_ROUTES.has(routeKey)) {
    return true;
  }

  // Preview resources authenticate with a short-lived, owner-scoped ticket.
  // The issuance endpoint remains protected by the normal device access check.
  if (/^\/api\/preview\/(sessions|local-llm)\/[^/]+(?:\/|$)/.test(request.path)) {
    return true;
  }

  return (
    request.method === "GET" &&
    (
      /^\/api\/access\/link\/[^/]+\/status$/.test(request.path) ||
      /^\/api\/assets\/ticket\/[^/]+$/.test(request.path)
    )
  );
}

function isPublicWebAppRoute(request: express.Request) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }

  return !request.path.startsWith("/api") && !request.path.startsWith("/ws");
}

export function readRequestToken(request: express.Request) {
  const cookieToken = readAccessTokenCookie(request);
  if (cookieToken) {
    return cookieToken;
  }

  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  const headerToken = request.headers["x-deskcue-token"];
  if (typeof headerToken === "string") {
    return headerToken.trim();
  }

  return null;
}

export function createDeviceAccessTokenMiddleware(readAuthRequired: () => boolean) {
  return (
    request: express.Request,
    response: express.Response,
    next: express.NextFunction
  ) => {
    const token = readRequestToken(request);
    const device = accessDeviceStore.authenticateToken(token, request);
    setRequestAccessDevice(request, device);

    if (isAuthorizedCloudInternalRequest(request)) {
      next();
      return;
    }

    if (!readAuthRequired()) {
      next();
      return;
    }

    if (isPublicWebAppRoute(request)) {
      next();
      return;
    }

    if (
      request.method === "OPTIONS" ||
      isAccessTokenOptionalRoute(request)
    ) {
      next();
      return;
    }

    if (isTrustedLoopbackBrowserRequest(request)) {
      next();
      return;
    }

    if (device) {
      next();
      return;
    }

    response.status(401).json({
      error: "DeskCue access token is required."
    });
  };
}

export const requireAccessToken = createDeviceAccessTokenMiddleware(
  () => daemonConfig.authRequired
);

export function createDynamicAccessTokenMiddleware(
  readAccessToken: () => string | null,
  readAuthRequired: () => boolean
) {
  return (
    request: express.Request,
    response: express.Response,
    next: express.NextFunction
  ) => {
    if (isAuthorizedCloudInternalRequest(request)) {
      next();
      return;
    }

    if (!readAuthRequired()) {
      next();
      return;
    }

    const accessToken = readAccessToken();
    if (
      !accessToken ||
      request.method === "OPTIONS" ||
      isPublicWebAppRoute(request) ||
      isAccessTokenOptionalRoute(request)
    ) {
      next();
      return;
    }

    if (isTrustedLoopbackBrowserRequest(request)) {
      next();
      return;
    }

    if (readRequestToken(request) === accessToken) {
      next();
      return;
    }

    response.status(401).json({
      error: "DeskCue access token is required."
    });
  };
}

export function createAccessTokenMiddleware(accessToken: string | null, authRequired = true) {
  return createDynamicAccessTokenMiddleware(() => accessToken, () => authRequired);
}

export function readAccessTokenFromWebSocketUrl(requestUrl: string | undefined) {
  if (!requestUrl) {
    return null;
  }

  try {
    const url = new URL(requestUrl, "http://127.0.0.1");
    return url.searchParams.get("token") ?? url.searchParams.get("access_token");
  } catch {
    return null;
  }
}

export function readAccessTokenFromWebSocketRequest(request: IncomingMessage) {
  return readAccessTokenCookie(request) ?? readAccessTokenFromWebSocketUrl(request.url);
}
