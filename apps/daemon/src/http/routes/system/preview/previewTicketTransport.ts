import type express from "express";

import type { PreviewOwner } from "./previewTargetResolver.ts";
import {
  buildPreviewOwnerTicketCookieName,
  buildPreviewOwnerTicketKey,
  PREVIEW_TICKET_COOKIE_NAME,
  PREVIEW_TICKET_COOKIE_PREFIX,
  PREVIEW_TICKET_PATH_SEGMENT,
  PREVIEW_TICKET_QUERY_KEY,
  PREVIEW_TICKET_TTL_MS
} from "./previewTicketRegistry.ts";

const PREVIEW_TICKET_BUNDLE_VERSION = 1;
const MAX_ROOT_TICKET_ENTRIES = 8;
const MAX_ROOT_TICKET_COOKIE_BYTES = 2 * 1024;
const MAX_ROOT_TICKET_CANDIDATES = 16;

type PreviewTicketBundleEntry = [ownerKey: string, ticket: string, expiresAtMs: number];

export function buildPreviewBasePath(owner: PreviewOwner) {
  const group = owner.kind === "session" ? "sessions" : "local-llm";
  return `/api/preview/${group}/${encodeURIComponent(owner.id)}`;
}

export function buildAuthorizedPreviewBasePath(basePath: string, ticket: string) {
  return `${basePath}/${PREVIEW_TICKET_PATH_SEGMENT}/${encodeURIComponent(ticket)}`;
}

export function readPreviewOwner(requestUrl: string | undefined): PreviewOwner | null {
  if (!requestUrl) return null;
  const match = /^\/api\/preview\/(sessions|local-llm)\/([^/?]+)(?:\/|\?|$)/.exec(requestUrl);
  if (!match) return null;
  try {
    return {
      id: decodeURIComponent(match[2]),
      kind: match[1] === "sessions" ? "session" : "local-llm"
    };
  } catch {
    return null;
  }
}

export function readPreviewOwnerFromReferer(request: express.Request) {
  const referer = request.get("referer");
  if (!referer) return null;
  try {
    const url = new URL(referer);
    const forwardedHost = request.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
    const requestHosts = [request.get("host"), forwardedHost]
      .filter((host): host is string => Boolean(host))
      .map((host) => host.toLowerCase());
    if (!requestHosts.includes(url.host.toLowerCase())) return null;
    return readPreviewOwner(url.pathname);
  } catch {
    return null;
  }
}

export function hasExplicitPreviewTicket(requestUrl: string) {
  const parsedUrl = new URL(requestUrl || "/", "http://deskcue.local");
  return (
    parsedUrl.searchParams.has(PREVIEW_TICKET_QUERY_KEY) ||
    new RegExp(`(?:^|/)${PREVIEW_TICKET_PATH_SEGMENT}/[^/?]+`).test(parsedUrl.pathname)
  );
}

function readTicketBundle(value: string | undefined, nowMs = Date.now()) {
  if (!value || value.length > MAX_ROOT_TICKET_COOKIE_BYTES) return [];
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!Array.isArray(parsed) || parsed[0] !== PREVIEW_TICKET_BUNDLE_VERSION || !Array.isArray(parsed[1])) {
      return [];
    }
    return parsed[1].flatMap((entry): PreviewTicketBundleEntry[] => {
      if (
        !Array.isArray(entry) ||
        entry.length !== 3 ||
        typeof entry[0] !== "string" ||
        !/^[A-Za-z0-9_-]{16}$/.test(entry[0]) ||
        typeof entry[1] !== "string" ||
        !/^[A-Za-z0-9_-]{32,128}$/.test(entry[1]) ||
        typeof entry[2] !== "number" ||
        !Number.isSafeInteger(entry[2]) ||
        entry[2] <= nowMs
      ) {
        return [];
      }
      return [[entry[0], entry[1], entry[2]]];
    }).slice(0, MAX_ROOT_TICKET_ENTRIES);
  } catch {
    return [];
  }
}

function readBundledTicket(value: string | undefined, owner: PreviewOwner) {
  const ownerKey = buildPreviewOwnerTicketKey(owner);
  return readTicketBundle(value).find(([key]) => key === ownerKey)?.[1] ?? null;
}

function encodeTicketBundle(entries: PreviewTicketBundleEntry[]) {
  return Buffer.from(JSON.stringify([PREVIEW_TICKET_BUNDLE_VERSION, entries]), "utf8")
    .toString("base64url");
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function readCookies(header: string | undefined) {
  const result = new Map<string, string>();
  for (const part of header?.split(";") ?? []) {
    const [name, ...rawValue] = part.trim().split("=");
    if (!name) continue;
    const value = safeDecode(rawValue.join("="));
    if (value !== null) result.set(name, value);
  }
  return result;
}

export function readPreviewTicket(
  requestUrl: string,
  cookieHeader: string | undefined,
  owner?: PreviewOwner
) {
  const parsedUrl = new URL(requestUrl || "/", "http://deskcue.local");
  const queryTicket = parsedUrl.searchParams.get(PREVIEW_TICKET_QUERY_KEY);
  if (queryTicket) return queryTicket;
  const pathTicket = new RegExp(`(?:^|/)${PREVIEW_TICKET_PATH_SEGMENT}/([^/?]+)`)
    .exec(parsedUrl.pathname)?.[1];
  if (pathTicket) return safeDecode(pathTicket);

  const cookies = readCookies(cookieHeader);
  if (owner) {
    const bundledTicket = readBundledTicket(cookies.get(PREVIEW_TICKET_COOKIE_NAME), owner);
    if (bundledTicket) return bundledTicket;
    const ownerTicket = cookies.get(buildPreviewOwnerTicketCookieName(owner));
    if (ownerTicket) return ownerTicket;
  }
  const legacyTicket = cookies.get(PREVIEW_TICKET_COOKIE_NAME);
  return legacyTicket && /^[A-Za-z0-9_-]{32,128}$/.test(legacyTicket)
    ? legacyTicket
    : null;
}

export function readPreviewTicketCandidates(cookieHeader: string | undefined) {
  const cookies = readCookies(cookieHeader);
  const candidates = readTicketBundle(cookies.get(PREVIEW_TICKET_COOKIE_NAME))
    .map(([, ticket]) => ticket);
  for (const [name, value] of cookies) {
    if (
      candidates.length >= MAX_ROOT_TICKET_CANDIDATES ||
      !name.startsWith(PREVIEW_TICKET_COOKIE_PREFIX) ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(value)
    ) {
      continue;
    }
    candidates.push(value);
  }
  const legacy = cookies.get(PREVIEW_TICKET_COOKIE_NAME);
  if (
    candidates.length < MAX_ROOT_TICKET_CANDIDATES &&
    legacy &&
    /^[A-Za-z0-9_-]{32,128}$/.test(legacy)
  ) {
    candidates.push(legacy);
  }
  return [...new Set(candidates)].slice(0, MAX_ROOT_TICKET_CANDIDATES);
}

function buildTicketBundle(
  cookieHeader: string | undefined,
  owner: PreviewOwner,
  ticket: string,
  nowMs = Date.now()
) {
  const ownerKey = buildPreviewOwnerTicketKey(owner);
  const current = readTicketBundle(readCookies(cookieHeader).get(PREVIEW_TICKET_COOKIE_NAME), nowMs)
    .filter(([key]) => key !== ownerKey);
  const issuedEntry: PreviewTicketBundleEntry = [
    ownerKey,
    ticket,
    nowMs + PREVIEW_TICKET_TTL_MS
  ];
  const entries: PreviewTicketBundleEntry[] = [
    issuedEntry,
    ...current
  ].slice(0, MAX_ROOT_TICKET_ENTRIES);

  while (entries.length > 1) {
    const encoded = encodeTicketBundle(entries);
    if (Buffer.byteLength(encoded) <= MAX_ROOT_TICKET_COOKIE_BYTES) return encoded;
    entries.pop();
  }
  return encodeTicketBundle(entries);
}

function isSecureRequest(request: express.Request) {
  return (
    request.secure ||
    request.protocol === "https" ||
    request.get("x-forwarded-proto") === "https"
  );
}

export function setPreviewTicketCookies(
  request: express.Request,
  response: express.Response,
  owner: PreviewOwner,
  ticket: string
) {
  const common = {
    httpOnly: true,
    maxAge: PREVIEW_TICKET_TTL_MS,
    sameSite: "lax" as const,
    secure: isSecureRequest(request)
  };
  response.cookie(PREVIEW_TICKET_COOKIE_NAME, buildTicketBundle(
    request.headers.cookie,
    owner,
    ticket
  ), {
    ...common,
    path: "/"
  });
}
