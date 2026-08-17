import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";
import type { LookupFunction } from "node:net";

import { daemonConfig } from "#config/daemonConfig";
import { isLocalInterfaceHost } from "#http/networkHosts";

export const PREVIEW_EGRESS_PATH_SEGMENT = "__deskcue_egress__";
export const PREVIEW_EGRESS_STRIP_AUTH_PATH_SEGMENT = "__deskcue_no_auth__";
const MAX_EGRESS_URL_LENGTH = 8 * 1024;

export type ResolvedPreviewEgressTarget = {
  lookup?: LookupFunction;
  url: URL;
};

export type PreviewEgressResolver = (
  target: URL
) => Promise<ResolvedPreviewEgressTarget>;

type PreviewEgressResolutionOptions = {
  allowLoopback?: boolean;
};

function isSupportedHttpProtocol(protocol: string) {
  return protocol === "http:" || protocol === "https:";
}

function isSupportedEgressProtocol(protocol: string) {
  return isSupportedHttpProtocol(protocol) || protocol === "ws:" || protocol === "wss:";
}

function readDefaultPort(protocol: string) {
  return protocol === "https:" || protocol === "wss:" ? 443 : 80;
}

function normalizeHostname(value: string) {
  return value.replace(/^\[|\]$/g, "").toLowerCase();
}

function isBlockedHostname(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "metadata.google.internal"
  );
}

function parseIpv6Section(section: string) {
  if (!section) return [];
  const words: number[] = [];
  for (const token of section.split(":")) {
    if (/^[0-9a-f]{1,4}$/u.test(token)) {
      words.push(Number.parseInt(token, 16));
      continue;
    }
    if (!net.isIPv4(token)) return null;
    const octets = token.split(".").map(Number);
    words.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
  }
  return words;
}

function parseIpv6Words(address: string) {
  if (address.includes("%") || address.split("::").length > 2) return null;
  const [left = "", right] = address.split("::");
  const leftWords = parseIpv6Section(left);
  const rightWords = parseIpv6Section(right ?? "");
  if (!leftWords || !rightWords) return null;
  if (right === undefined) return leftWords.length === 8 ? leftWords : null;
  const omittedWords = 8 - leftWords.length - rightWords.length;
  if (omittedWords < 1) return null;
  return [...leftWords, ...Array<number>(omittedWords).fill(0), ...rightWords];
}

function readEmbeddedIpv4Address(address: string) {
  const words = parseIpv6Words(address);
  if (!words) return null;
  const mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  const compatible = words.slice(0, 6).every((word) => word === 0);
  if (!mapped && !compatible) return null;
  const high = words[6];
  const low = words[7];
  return [
    high >> 8,
    high & 0xff,
    low >> 8,
    low & 0xff
  ].join(".");
}

function isLoopbackNetworkAddress(address: string): boolean {
  if (net.isIPv4(address)) return address.split(".")[0] === "127";
  if (!net.isIPv6(address)) return false;
  const normalized = address.toLowerCase();
  const embeddedIpv4 = readEmbeddedIpv4Address(normalized);
  return normalized === "::1" || Boolean(
    embeddedIpv4 && isLoopbackNetworkAddress(embeddedIpv4)
  );
}

function isBlockedNetworkAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const parts = address.split(".").map(Number);
    return (
      parts[0] === 0 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      parts[0] >= 224
    );
  }
  if (!net.isIPv6(address)) return true;

  const lower = address.toLowerCase();
  const embeddedIpv4 = readEmbeddedIpv4Address(lower);
  if (embeddedIpv4 && isBlockedNetworkAddress(embeddedIpv4)) return true;
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb") ||
    lower.startsWith("ff") ||
    lower === "fd00:ec2::254"
  );
}

function validateResolvedAddress(
  address: string,
  target: URL,
  options: PreviewEgressResolutionOptions
) {
  const normalized = normalizeHostname(address);
  if (
    isBlockedNetworkAddress(normalized) &&
    !(options.allowLoopback && isLoopbackNetworkAddress(normalized))
  ) {
    throw new Error("Preview egress target resolved to a protected address.");
  }

  const port = Number(target.port || readDefaultPort(target.protocol));
  const localInterfaceCandidate = net.isIPv6(normalized)
    ? readEmbeddedIpv4Address(normalized) ?? normalized
    : normalized;
  if (port === daemonConfig.daemonPort && isLocalInterfaceHost(localInterfaceCandidate)) {
    throw new Error("Preview egress cannot connect back to DeskCue.");
  }
}

function validateEgressUrlShape(target: URL) {
  if (
    !isSupportedEgressProtocol(target.protocol) ||
    target.href.length > MAX_EGRESS_URL_LENGTH ||
    target.username ||
    target.password
  ) {
    throw new Error("Preview egress target is invalid.");
  }
}

export async function resolvePreviewEgressTarget(
  target: URL,
  options: PreviewEgressResolutionOptions = {}
): Promise<ResolvedPreviewEgressTarget> {
  validateEgressUrlShape(target);
  const hostname = normalizeHostname(target.hostname);
  const loopbackHostname = hostname === "localhost" || hostname.endsWith(".localhost");
  if (isBlockedHostname(hostname) && !(options.allowLoopback && loopbackHostname)) {
    throw new Error("Preview egress target is not allowed.");
  }

  if (net.isIP(hostname)) {
    validateResolvedAddress(hostname, target, options);
    return { url: target };
  }

  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  if (records.length === 0) throw new Error("Preview egress target did not resolve.");
  for (const record of records) validateResolvedAddress(record.address, target, options);

  // Pin the validated address for this connection. This avoids a DNS
  // validate-then-connect race while preserving the original hostname for TLS
  // SNI and Host.
  const selected = records[0];
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [selected]);
      return;
    }
    callback(null, selected.address, selected.family);
  };
  return { lookup: pinnedLookup, url: target };
}

export function buildPreviewEgressPath(
  basePath: string,
  target: URL,
  options: { stripAuthorization?: boolean } = {}
) {
  if (!isSupportedEgressProtocol(target.protocol)) {
    throw new Error("Preview egress supports only HTTP and WebSocket URLs.");
  }
  const encodedOrigin = Buffer.from(target.origin).toString("base64url");
  const authorizationSegment = options.stripAuthorization
    ? `/${PREVIEW_EGRESS_STRIP_AUTH_PATH_SEGMENT}`
    : "";
  return `${basePath}${authorizationSegment}/${PREVIEW_EGRESS_PATH_SEGMENT}/${encodedOrigin}${target.pathname}${target.search}${target.hash}`;
}

export function previewEgressMustStripAuthorization(requestUrl: string | undefined) {
  if (!requestUrl) return false;
  try {
    return new URL(requestUrl, "http://deskcue.local").pathname
      .split("/")
      .includes(PREVIEW_EGRESS_STRIP_AUTH_PATH_SEGMENT);
  } catch {
    return false;
  }
}

export function readPreviewEgressUrl(requestUrl: string | undefined) {
  if (!requestUrl) return null;
  const incoming = new URL(requestUrl, "http://deskcue.local");
  const marker = `/${PREVIEW_EGRESS_PATH_SEGMENT}/`;
  const markerIndex = incoming.pathname.indexOf(marker);
  if (markerIndex < 0) return null;

  const encodedStart = markerIndex + marker.length;
  const encodedEnd = incoming.pathname.indexOf("/", encodedStart);
  const encodedOrigin = encodedEnd < 0
    ? incoming.pathname.slice(encodedStart)
    : incoming.pathname.slice(encodedStart, encodedEnd);
  if (!encodedOrigin || encodedOrigin.length > 512) return null;

  try {
    const origin = Buffer.from(encodedOrigin, "base64url").toString("utf8");
    const base = new URL(origin);
    if (base.origin !== origin || !isSupportedEgressProtocol(base.protocol)) return null;
    const pathname = encodedEnd < 0 ? "/" : incoming.pathname.slice(encodedEnd);
    const target = new URL(`${pathname}${incoming.search}`, base);
    return target.href.length <= MAX_EGRESS_URL_LENGTH ? target : null;
  } catch {
    return null;
  }
}
