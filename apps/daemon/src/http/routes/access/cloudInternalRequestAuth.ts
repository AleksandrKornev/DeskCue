import type express from "express";
import type { IncomingMessage } from "node:http";

import {
  createCloudProcessLocalAuthorization,
  isValidCloudProcessLocalAuthorization
} from "#security/cloudProcessLocalCredential";

import { isLoopbackClientRequest } from "../../hostClient.ts";

const CLOUD_INTERNAL_ROUTE_TEMPLATES: Readonly<Record<"GET" | "POST", readonly string[]>> = {
  GET: [
    "/api/assets/ticket/:ticket",
    "/api/overview",
    "/api/preview/candidates",
    "/api/workspaces/:workspaceId/files",
    "/api/workspaces/:workspaceId/file",
    "/api/sessions/:sessionId",
    "/api/agents/sessions",
    "/api/agents/sessions/:agentSessionId",
    "/api/agents/sessions/:agentSessionId/transcript-view",
    "/api/agents/sessions/:agentSessionId/transcript-updates",
    "/api/agents/sessions/:agentSessionId/transcript-page",
    "/api/agents/sessions/:agentSessionId/transcript-entries",
    "/api/agents/sessions/:agentSessionId/changes/:groupId"
  ],
  POST: [
    "/api/assets/ticket",
    "/api/agents/sessions/:agentSessionId/attach",
    "/api/agents/sessions/:agentSessionId/reviewed",
    "/api/agents/sessions/:agentSessionId/transcript-entries",
    "/api/agents/sessions/:agentSessionId/changes/:groupId",
    "/api/sessions/:sessionId/input",
    "/api/sessions/:sessionId/interrupt",
    "/api/sessions/:sessionId/stop",
    "/api/sessions/:sessionId/refresh-git",
    "/api/sessions/:sessionId/preview"
  ]
};

/** Returns process-local credentials for the connector's loopback HTTP client. */
export function createCloudInternalRequestHeaders(): Record<string, string> {
  return {
    authorization: createCloudProcessLocalAuthorization()
  };
}

export function isAuthorizedCloudInternalWebSocketRequest(request: IncomingMessage): boolean {
  if (!isLoopbackClientRequest(request)) return false;
  let pathname: string;
  try {
    pathname = new URL(request.url ?? "/", "http://deskcue.local").pathname;
  } catch {
    return false;
  }
  return pathname === "/ws" &&
    isValidCloudProcessLocalAuthorization(request.headers.authorization);
}

function readRouteSegments(path: string): string[] | null {
  if (!path.startsWith("/") || path.endsWith("/") || path.includes("//")) return null;
  const segments = path.slice(1).split("/");
  return segments.every(Boolean) ? segments : null;
}

function matchesRouteTemplate(segments: string[], template: string): boolean {
  const templateSegments = template.slice(1).split("/");
  return segments.length === templateSegments.length &&
    segments.every((segment, index) => {
      const templateSegment = templateSegments[index];
      return templateSegment?.startsWith(":") || segment === templateSegment;
    });
}

function isCloudInternalRoute(request: express.Request): boolean {
  if (request.method !== "GET" && request.method !== "POST") return false;
  const segments = readRouteSegments(request.path);
  if (!segments) return false;
  return CLOUD_INTERNAL_ROUTE_TEMPLATES[request.method].some((template) =>
    matchesRouteTemplate(segments, template)
  );
}

export function isAuthorizedCloudInternalRequest(request: express.Request): boolean {
  if (!isLoopbackClientRequest(request) || !isCloudInternalRoute(request)) return false;

  return isValidCloudProcessLocalAuthorization(request.headers.authorization);
}
