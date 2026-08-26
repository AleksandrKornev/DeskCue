import type express from "express";

import { daemonConfig } from "#config/daemonConfig";

function readBrowserFacingProtocol(request: express.Request) {
  const requestHost = request.get("host")?.toLowerCase();

  for (const value of [request.get("origin"), request.get("referer")]) {
    if (!value) continue;

    try {
      const url = new URL(value);
      const trustedOrigin = url.host.toLowerCase() === requestHost || daemonConfig.allowedOrigins.includes(url.origin);

      if (trustedOrigin && (url.protocol === "http:" || url.protocol === "https:")) return url.protocol.slice(0, -1);
    } catch {
      // Fall through to the next browser-facing URL or the direct request.
    }
  }

  return request.secure || request.protocol === "https" ? "https" : "http";
}

export function buildPreviewUrl(request: express.Request, basePath: string, previewProxyPort?: number) {
  if (!previewProxyPort) return `${basePath}/`;

  const protocol = readBrowserFacingProtocol(request);
  const origin = new URL(`${protocol}://${request.get("host") ?? "localhost"}`);

  origin.port = String(previewProxyPort);

  origin.pathname = `${basePath}/`;
  origin.search = "";
  origin.hash = "";
  return origin.toString();
}
