import type express from "express";
import type { IncomingMessage } from "node:http";
import net from "node:net";

import { isLocalInterfaceHost } from "./networkHosts.ts";

type RequestLike =
  | express.Request
  | IncomingMessage
  | {
      headers?: Record<string, string | string[] | undefined>;
      socket: {
        remoteAddress?: string;
      };
    };

export function readRequestClientAddress(
  request: RequestLike
) {
  // Proxy headers are attacker-controlled unless the daemon has an explicit,
  // reviewed trusted-proxy configuration. DeskCue does not have that contract
  // yet, so every security and rate-limit decision must use the actual peer.
  return request.socket.remoteAddress ?? ("ip" in request ? request.ip : "") ?? "";
}

function normalizeRemoteAddress(address: string | null) {
  if (!address) {
    return null;
  }

  return address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
}

export function isHostClientRequest(request: express.Request) {
  const remoteAddress = normalizeRemoteAddress(readRequestClientAddress(request));

  if (!remoteAddress) {
    return false;
  }

  if (remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1") {
    return true;
  }

  if (net.isIPv4(remoteAddress)) {
    return remoteAddress === "127.0.0.1" || isLocalInterfaceHost(remoteAddress);
  }

  if (net.isIPv6(remoteAddress)) {
    return remoteAddress === "::1";
  }

  return remoteAddress === "localhost";
}

export function isLoopbackClientRequest(request: RequestLike) {
  const remoteAddress = normalizeRemoteAddress(readRequestClientAddress(request));

  return (
    remoteAddress === "localhost" ||
    remoteAddress === "127.0.0.1" ||
    remoteAddress === "::1"
  );
}

function isLoopbackHostname(value: string) {
  return value === "localhost" || value === "127.0.0.1" || value === "::1";
}

function isSameHostBrowserOrigin(value: string, expectedHost: string) {
  try {
    const origin = new URL(value);
    return (
      (origin.protocol === "http:" || origin.protocol === "https:") &&
      isLoopbackHostname(origin.hostname) &&
      origin.host === expectedHost
    );
  } catch {
    return false;
  }
}

function readHeaderValue(request: RequestLike, name: string) {
  const value = request.headers?.[name];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function formatHostForUrl(host: string) {
  return net.isIPv6(host) && !host.startsWith("[") ? `[${host}]` : host;
}

function readLoopbackHost(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(`http://${formatHostForUrl(value.trim())}`);
    return isLoopbackHostname(url.hostname) ? url.host : null;
  } catch {
    return null;
  }
}

export function isTrustedLoopbackBrowserRequest(request: RequestLike) {
  if (!isLoopbackClientRequest(request)) {
    return false;
  }

  const host = readLoopbackHost(readHeaderValue(request, "host"));
  if (!host) {
    return false;
  }

  const origin = readHeaderValue(request, "origin");
  if (origin) {
    return isSameHostBrowserOrigin(origin, host);
  }

  return readHeaderValue(request, "sec-fetch-site") === "same-origin";
}
