import type express from "express";
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";

import { accessDeviceStore } from "#access/accessDevices";
import { ACCESS_TOKEN_COOKIE_NAME } from "#http/routes/access/accessCookies";

import {
  buildPreviewEgressPath,
  previewEgressMustStripAuthorization,
  readPreviewEgressUrl
} from "./egress/previewEgressTarget.ts";
import type { PreviewOwner } from "./previewTargetResolver.ts";
import { isPreviewTicketCookieName } from "./previewTicketRegistry.ts";
import {
  buildPreviewBasePath,
  readPreviewOwnerFromReferer,
  readPreviewTicket,
  readPreviewTicketCandidates
} from "./previewTicketTransport.ts";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);
const REQUEST_SECRET_HEADERS = new Set([
  "proxy-authorization",
  "x-deskcue-token"
]);
const RESPONSE_SECURITY_HEADERS = new Set([
  "content-security-policy",
  "content-security-policy-report-only",
  "x-frame-options"
]);
const MAX_FORWARDED_HEADERS = 100;
const MAX_FORWARDED_HEADER_BYTES = 32 * 1024;

type PreviewRootTicketResolver = {
  resolveOwner(ticket: string | null): PreviewOwner | null;
  validate(ticket: string | null, owner: PreviewOwner): boolean;
};

function resolvePreviewRootRequestOwner(
  request: express.Request,
  tickets: PreviewRootTicketResolver
) {
  const refererOwner = readPreviewOwnerFromReferer(request);
  if (refererOwner) return refererOwner;
  // Opaque sandbox subresources and iframe SPA navigations may omit Referer.
  // Do not apply this fallback to ordinary top-level DeskCue navigation.
  if (
    request.get("sec-fetch-site") !== "cross-site" &&
    request.get("sec-fetch-dest") !== "iframe"
  ) return null;
  for (const ticket of readPreviewTicketCandidates(request.headers.cookie)) {
    const owner = tickets.resolveOwner(ticket);
    if (owner) return owner;
  }
  return null;
}

export function buildPreviewRootRequestRedirect(
  request: express.Request,
  basePath: string
) {
  const referer = request.get("referer");
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      const refererRequestUrl = `${refererUrl.pathname}${refererUrl.search}`;
      const egressDocumentUrl = readPreviewEgressUrl(refererRequestUrl);
      if (egressDocumentUrl) {
        const incoming = new URL(request.originalUrl, "http://deskcue.local");
        const target = new URL(`${incoming.pathname}${incoming.search}`, egressDocumentUrl.origin);
        return buildPreviewEgressPath(basePath, target, {
          stripAuthorization: previewEgressMustStripAuthorization(refererRequestUrl)
        });
      }
    } catch {
      // Fall back to the validated owner-scoped local Preview route.
    }
  }
  return `${basePath}${request.originalUrl}`;
}

export function createPreviewRootRequestRedirectHandler(
  tickets: PreviewRootTicketResolver
): express.RequestHandler {
  return (request, response, next) => {
    if (request.path.startsWith("/api/preview/") || request.path.startsWith("/ws")) {
      next();
      return;
    }
    const owner = resolvePreviewRootRequestOwner(request, tickets);
    if (!owner) {
      next();
      return;
    }
    const ticket = readPreviewTicket(request.originalUrl, request.headers.cookie, owner);
    if (!tickets.validate(ticket, owner)) {
      next();
      return;
    }
    if (request.headers.origin === "null") {
      response.setHeader("access-control-allow-origin", "null");
      response.setHeader("access-control-allow-credentials", "true");
    }
    response.redirect(307, buildPreviewRootRequestRedirect(request, buildPreviewBasePath(owner)));
  };
}

export function isDeskCueAuthorization(value: string | undefined) {
  if (!value?.startsWith("Bearer ")) return false;
  const token = value.slice("Bearer ".length).trim();
  return Boolean(token && accessDeviceStore.authenticateToken(token));
}

function rewritePreviewLinkHeader(
  value: string | string[],
  basePath: string
) {
  const rewrite = (entry: string) => entry.replace(
    /<\/(?!\/|api\/)([^>]*)>/g,
    `<${basePath}/$1>`
  );
  return Array.isArray(value) ? value.map(rewrite) : rewrite(value);
}

function readExistingSetCookies(value: number | string | string[] | undefined) {
  if (Array.isArray(value)) return value;
  return typeof value === "string" ? [value] : [];
}

export function rewritePreviewCookies(
  values: string[] | undefined,
  basePath: string,
  options: { preservePath?: boolean } = {}
) {
  const cookiePath = basePath || "/";
  return (values ?? [])
    .filter((value) => {
      const name = value.slice(0, value.indexOf("=")).trim();
      return name !== ACCESS_TOKEN_COOKIE_NAME && !isPreviewTicketCookieName(name);
    })
    .map((value) => {
      const withoutDomain = value.replace(/;\s*Domain=[^;]*/gi, "");
      if (options.preservePath) {
        const path = /;\s*Path=([^;]*)/i.exec(withoutDomain)?.[1]?.trim();
        if (path?.startsWith("/")) return withoutDomain;
        const withoutInvalidPath = withoutDomain.replace(/;\s*Path=[^;]*/i, "");
        return `${withoutInvalidPath}; Path=/`;
      }
      return /;\s*Path=/i.test(withoutDomain)
        ? withoutDomain.replace(/;\s*Path=[^;]*/i, `; Path=${cookiePath}`)
        : `${withoutDomain}; Path=${cookiePath}`;
    });
}

function stripDeskCueCookies(value: string | undefined) {
  if (!value) return null;
  const kept = value.split(";").map((part) => part.trim()).filter((part) => {
    const name = part.slice(0, part.indexOf("=")).trim();
    return name && name !== ACCESS_TOKEN_COOKIE_NAME && !isPreviewTicketCookieName(name);
  });
  return kept.length > 0 ? kept.join("; ") : null;
}

function readConnectionHeaderNames(value: string | string[] | undefined) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return new Set(values.flatMap((entry) => entry.split(",")).map((name) => name.trim().toLowerCase()));
}

export function buildPreviewRequestHeaders(
  input: IncomingHttpHeaders,
  target: URL,
  options: {
    cookie?: string | null;
    forwardAuthorization?: boolean;
  } = {}
): OutgoingHttpHeaders {
  const connectionHeaders = readConnectionHeaderNames(input.connection);
  const output: OutgoingHttpHeaders = {
    "accept-encoding": "identity",
    host: target.host
  };

  let count = 0;
  let bytes = 0;
  for (const [rawName, rawValue] of Object.entries(input)) {
    const name = rawName.toLowerCase();
    if (
      rawValue === undefined ||
      name === "host" ||
      name === "cookie" ||
      name === "origin" ||
      name === "referer" ||
      name === "accept-encoding" ||
      (name === "authorization" && !options.forwardAuthorization) ||
      name.startsWith("sec-fetch-") ||
      name.startsWith("sec-websocket-") ||
      HOP_BY_HOP_HEADERS.has(name) ||
      connectionHeaders.has(name) ||
      REQUEST_SECRET_HEADERS.has(name)
    ) {
      continue;
    }

    const valueBytes = Buffer.byteLength(Array.isArray(rawValue) ? rawValue.join(",") : rawValue);
    if (count >= MAX_FORWARDED_HEADERS || bytes + name.length + valueBytes > MAX_FORWARDED_HEADER_BYTES) {
      continue;
    }
    output[name] = rawValue;
    count += 1;
    bytes += name.length + valueBytes;
  }

  const cookie = options.cookie === undefined
    ? stripDeskCueCookies(input.cookie)
    : options.cookie;
  if (cookie) output.cookie = cookie;
  if (input.origin && input.origin !== "null") output.origin = target.origin;
  if (input.referer) output.referer = target.href;
  return output;
}

export function copyPreviewResponseHeaders(
  input: IncomingHttpHeaders,
  output: {
    getHeader(name: string): number | string | string[] | undefined;
    setHeader(name: string, value: number | string | readonly string[]): unknown;
  },
  options: {
    basePath: string;
    contentRewritten: boolean;
    exposeCookies?: boolean;
    requestOrigin: string | undefined;
    resourceBasePath?: string;
    upstreamOrigin?: string;
    preserveSecurityHeaders?: boolean;
    preserveCookiePaths?: boolean;
  }
) {
  const connectionHeaders = readConnectionHeaderNames(input.connection);
  let count = 0;
  let bytes = 0;

  for (const [rawName, rawValue] of Object.entries(input)) {
    const name = rawName.toLowerCase();
    if (
      rawValue === undefined ||
      name === "set-cookie" ||
      (options.contentRewritten && name === "content-length") ||
      HOP_BY_HOP_HEADERS.has(name) ||
      connectionHeaders.has(name) ||
      name.startsWith("x-deskcue-") ||
      (options.preserveSecurityHeaders && name === "origin-agent-cluster") ||
      (!options.preserveSecurityHeaders && RESPONSE_SECURITY_HEADERS.has(name))
    ) {
      continue;
    }

    const valueBytes = Buffer.byteLength(Array.isArray(rawValue) ? rawValue.join(",") : rawValue);
    if (count >= MAX_FORWARDED_HEADERS || bytes + name.length + valueBytes > MAX_FORWARDED_HEADER_BYTES) {
      continue;
    }
    const forwardedValue = name === "link"
      ? rewritePreviewLinkHeader(rawValue, options.resourceBasePath ?? options.basePath)
      : name === "access-control-allow-origin" && options.requestOrigin &&
          rawValue === options.upstreamOrigin
        ? options.requestOrigin
        : rawValue;
    output.setHeader(name, forwardedValue);
    count += 1;
    bytes += name.length + valueBytes;
  }

  const cookies = options.exposeCookies === false
    ? []
    : rewritePreviewCookies(input["set-cookie"], options.basePath, {
      preservePath: options.preserveCookiePaths
    });
  if (cookies.length > 0) {
    output.setHeader("set-cookie", [
      ...readExistingSetCookies(output.getHeader("set-cookie")),
      ...cookies
    ]);
  }
  if (options.requestOrigin === "null") {
    output.setHeader("access-control-allow-origin", "null");
    output.setHeader("access-control-allow-credentials", "true");
  }
}
