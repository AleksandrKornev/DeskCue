import type { LookupFunction } from "node:net";

import { CLOUD_REMOTE_PREVIEW_CAPABILITY } from "@deskcue/protocol/cloud";
import {
  PREVIEW_EGRESS_PATH_SEGMENT,
  PREVIEW_EGRESS_STRIP_AUTH_PATH_SEGMENT,
  previewEgressMustStripAuthorization,
  readPreviewEgressUrl,
  resolvePreviewEgressTarget
} from "#http/routes/system/preview/egress/previewEgressTarget";
import { resolvePreviewWebSocketTargetUrls } from "#http/routes/system/preview/egress/previewWebSocketTarget";
import { buildPreviewLoopbackOrigin } from "#http/routes/system/preview/previewLoopback";
import type {
  PreviewOwner,
  PreviewTargetResolver,
  ResolvedPreviewTarget
} from "#http/routes/system/preview/previewTargetResolver";
import { PREVIEW_TICKET_PATH_SEGMENT } from "#http/routes/system/preview/previewTicketRegistry";

const MAX_HEADER_BYTES = 32 * 1024;
const MAX_HEADER_COUNT = 100;
const MAX_OWNER_ID_BYTES = 512;
const MAX_PATH_BYTES = 8 * 1024;
const SAFE_METHODS = new Set(["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]);
const BLOCKED_REQUEST_HEADERS = new Set([
  "accept-encoding",
  "connection",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-deskcue-token"
]);
const RESERVED_PATH_SEGMENTS = new Set([PREVIEW_TICKET_PATH_SEGMENT]);
const RESERVED_QUERY_KEYS = new Set([
  "access_token",
  "deskcuePreviewTicket",
  "token"
]);

export type CloudPreviewRuntimeConsent = {
  allowRemotePreview: boolean;
  negotiatedCapabilities: readonly string[];
};

export type CloudPreviewTargetResolver = PreviewTargetResolver;

export type CloudPreviewRequestDescriptor = {
  headers: ReadonlyArray<readonly [string, string]>;
  method: string;
  owner: PreviewOwner;
  pathAndQuery: string;
  transport: "http" | "websocket";
  viewerId: string;
};

export type AuthorizedCloudPreviewRequest = {
  headers: ReadonlyArray<readonly [string, string]>;
  method: string;
  owner: PreviewOwner;
  pathAndQuery: string;
  target: ResolvedPreviewTarget;
  targetUrl: URL;
  viewerKey: string;
  egress: boolean;
  lookup?: LookupFunction;
  stripAuthorization: boolean;
};

export class CloudPreviewRequestRejectedError extends Error {
  constructor(readonly code: "invalid_request" | "preview_unavailable") {
    super(code);
    this.name = "CloudPreviewRequestRejectedError";
  }
}

function normalizeViewerId(value: string) {
  if (!/^[a-z2-7]{24}$/u.test(value)) throw new CloudPreviewRequestRejectedError("invalid_request");
  return value;
}

export function sanitizeCloudPreviewRequestHeaders(
  headers: ReadonlyArray<readonly [string, string]>
) {
  if (headers.length > MAX_HEADER_COUNT) throw new CloudPreviewRequestRejectedError("invalid_request");
  const result: Array<readonly [string, string]> = [];
  let bytes = 0;
  for (const [rawName, rawValue] of headers) {
    const name = rawName.toLowerCase();
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]{1,128}$/.test(name) || /[\r\n\0]/.test(rawValue)) {
      throw new CloudPreviewRequestRejectedError("invalid_request");
    }
    bytes += Buffer.byteLength(name) + Buffer.byteLength(rawValue);
    if (bytes > MAX_HEADER_BYTES) throw new CloudPreviewRequestRejectedError("invalid_request");
    if (!BLOCKED_REQUEST_HEADERS.has(name) && !name.startsWith("x-deskcue-")) result.push([name, rawValue]);
  }
  return result;
}

function normalizeOwner(owner: PreviewOwner): PreviewOwner {
  if ((owner.kind !== "session" && owner.kind !== "local-llm") ||
      !owner.id || Buffer.byteLength(owner.id) > MAX_OWNER_ID_BYTES ||
      /[\r\n\0]/.test(owner.id)) {
    throw new CloudPreviewRequestRejectedError("invalid_request");
  }
  return { id: owner.id, kind: owner.kind };
}

function normalizeMethod(value: string) {
  const method = value.toUpperCase();
  if (method !== value || !SAFE_METHODS.has(method)) throw new CloudPreviewRequestRejectedError("invalid_request");
  return method;
}

function normalizePathAndQuery(value: string) {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") ||
      value.includes("#") || /[\r\n\0]/.test(value) ||
      Buffer.byteLength(value) > MAX_PATH_BYTES) {
    throw new CloudPreviewRequestRejectedError("invalid_request");
  }
  let url: URL;
  try {
    url = new URL(value, "http://preview.deskcue.invalid");
  } catch {
    throw new CloudPreviewRequestRejectedError("invalid_request");
  }
  if (url.origin !== "http://preview.deskcue.invalid" ||
      url.pathname.split("/").some((segment) => RESERVED_PATH_SEGMENTS.has(segment)) ||
      [...url.searchParams.keys()].some((key) => RESERVED_QUERY_KEYS.has(key))) {
    throw new CloudPreviewRequestRejectedError("invalid_request");
  }
  return `${url.pathname}${url.search}`;
}

function assertLoopbackTarget(target: ResolvedPreviewTarget) {
  if ((target.networkMode !== "device-direct" && target.networkMode !== "deskcue-host") ||
      !Number.isSafeInteger(target.port) || target.port < 1 || target.port > 65_535 ||
      target.origin !== buildPreviewLoopbackOrigin(target.port)) {
    throw new CloudPreviewRequestRejectedError("preview_unavailable");
  }
}

/**
 * Authorizes the transport-neutral part of a Cloud Preview request.
 *
 * The Cloud peer never supplies a host or port. The active owner is resolved
 * through the same local Preview boundary as the standalone daemon, and the
 * result is checked again before a data-plane implementation may use it.
 */
export class CloudPreviewRequestPolicy {
  constructor(private readonly resolveTarget: PreviewTargetResolver) {}

  async authorize(input: CloudPreviewRequestDescriptor): Promise<AuthorizedCloudPreviewRequest> {
    const owner = normalizeOwner(input.owner);
    const viewerKey = normalizeViewerId(input.viewerId);
    const method = normalizeMethod(input.method);
    const pathAndQuery = normalizePathAndQuery(input.pathAndQuery);
    const target = await this.resolveTarget(owner);
    if (!target) throw new CloudPreviewRequestRejectedError("preview_unavailable");
    assertLoopbackTarget(target);

    const requestedEgressUrl = readPreviewEgressUrl(pathAndQuery);
    const containsEgressMarker = pathAndQuery.split(/[/?]/).some((segment) =>
      segment === PREVIEW_EGRESS_PATH_SEGMENT || segment === PREVIEW_EGRESS_STRIP_AUTH_PATH_SEGMENT
    );
    if (containsEgressMarker && !requestedEgressUrl) throw new CloudPreviewRequestRejectedError("invalid_request");
    if (requestedEgressUrl && target.networkMode !== "deskcue-host") {
      throw new CloudPreviewRequestRejectedError("preview_unavailable");
    }
    let targetUrl = new URL(pathAndQuery, target.origin);
    let lookup: LookupFunction | undefined;
    if (requestedEgressUrl) {
      const resolved = await resolvePreviewEgressTarget(requestedEgressUrl, {
        allowLoopback: true
      });
      targetUrl = resolved.url;
      lookup = resolved.lookup;
    }
    if (input.transport === "http" &&
        targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
      throw new CloudPreviewRequestRejectedError("invalid_request");
    }
    if (input.transport === "websocket") targetUrl = resolvePreviewWebSocketTargetUrls(targetUrl).websocketUrl;

    return {
      headers: sanitizeCloudPreviewRequestHeaders(input.headers),
      method,
      owner,
      pathAndQuery,
      target,
      targetUrl,
      viewerKey,
      egress: Boolean(requestedEgressUrl),
      lookup,
      stripAuthorization: previewEgressMustStripAuthorization(pathAndQuery)
    };
  }
}

export function isCloudPreviewRuntimeAllowed(consent: CloudPreviewRuntimeConsent) {
  return consent.allowRemotePreview &&
    consent.negotiatedCapabilities.includes(CLOUD_REMOTE_PREVIEW_CAPABILITY);
}
