import {
  CLOUD_REMOTE_ASSET_MAX_BODY_BYTES,
  CLOUD_REMOTE_READ_MAX_RESPONSE_BYTES,
  parseCloudRemoteReadOperationInput
} from "@deskcue/protocol/cloud";
import type {
  CloudRemoteReadOperation,
  CloudResolvedSessionRoute
} from "@deskcue/protocol/cloud";
import { createCloudProcessLocalAuthorization } from "#security/cloudProcessLocalCredential";

import { readBoundedCloudResponse } from "./cloudBoundedResponse.ts";
import {
  encodeCloudRemoteAssetEnvelope
} from "./cloudRemoteAssetEnvelope.ts";

const DEFAULT_TIMEOUT_MS = 12_000;
const CLOUD_REMOTE_ASSET_MAX_RANGE_BYTES = BigInt(CLOUD_REMOTE_ASSET_MAX_BODY_BYTES);

export type CloudRemoteReadResult = {
  status: number;
  body: unknown;
  binary?: boolean;
};

export type CloudRemoteReadExecutorOptions = {
  daemonOrigin: string;
  fetchImplementation?: typeof fetch;
  resolveSessionRoute?: (cloudSessionId: string) => Promise<CloudResolvedSessionRoute | null>;
  timeoutMs?: number;
};

function setNumber(query: URLSearchParams, key: string, value: number | undefined) {
  if (value !== undefined) query.set(key, String(value));
}

function setString(query: URLSearchParams, key: string, value: string | null | undefined) {
  if (value) query.set(key, value);
}

function setStringArray(query: URLSearchParams, key: string, value: string[] | undefined) {
  if (value && value.length > 0) query.set(key, value.join(","));
}

function setJson(query: URLSearchParams, key: string, value: unknown[] | undefined) {
  if (value && value.length > 0) query.set(key, JSON.stringify(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function clampCloudRemoteAssetRange(range: string | undefined) {
  if (!range) return undefined;

  const match = range.match(/^bytes=(\d*)-(\d*)$/iu);

  if (!match) return range;

  const startText = match[1] ?? "";
  const endText = match[2] ?? "";

  if (!startText) {
    const suffixLength = BigInt(endText);

    return `bytes=-${suffixLength > CLOUD_REMOTE_ASSET_MAX_RANGE_BYTES
      ? CLOUD_REMOTE_ASSET_MAX_RANGE_BYTES
      : suffixLength}`;
  }

  const start = BigInt(startText);
  const maximumEnd = start + CLOUD_REMOTE_ASSET_MAX_RANGE_BYTES - 1n;

  if (!endText) return `bytes=${start}-${maximumEnd}`;

  const requestedEnd = BigInt(endText);

  return `bytes=${start}-${requestedEnd > maximumEnd ? maximumEnd : requestedEnd}`;
}

function normalizeWorkspacePath(value: string) {
  return value
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/");
}

function sanitizeWorkspaceDirectoryResponse(
  body: unknown,
  requestedWorkspaceId: string,
  requestedPath: string
) {
  if (!isRecord(body) || body.workspaceId !== requestedWorkspaceId ||
      typeof body.path !== "string" ||
      normalizeWorkspacePath(body.path) !== normalizeWorkspacePath(requestedPath) ||
      !Array.isArray(body.entries)) return null;
  return body;
}

function sanitizeWorkspaceFileResponse(
  body: unknown,
  requestedWorkspaceId: string,
  requestedPath: string
) {
  if (!isRecord(body) || body.workspaceId !== requestedWorkspaceId ||
      typeof body.path !== "string" ||
      normalizeWorkspacePath(body.path) !== normalizeWorkspacePath(requestedPath)) return null;
  return body;
}

function buildRequest(
  operation: Exclude<CloudRemoteReadOperation, "sessions.resolveRoute">,
  value: unknown
): { method: "GET" | "POST"; path: string; body?: unknown } {
  // Overview and sessions.
  if (operation === "assets.ticket.create") {
    const input = parseCloudRemoteReadOperationInput(operation, value);

    return { method: "POST", path: "/api/assets/ticket", body: input };
  }

  if (operation === "assets.file.read") {
    const input = parseCloudRemoteReadOperationInput(operation, value);
    const query = new URLSearchParams({ path: input.path });

    setString(query, "agentSessionId", input.agentSessionId);
    setString(query, "managedSessionId", input.managedSessionId);
    setString(query, "workspaceId", input.workspaceId);
    if (input.download) query.set("download", "1");

    return { method: "GET", path: `/api/assets/file?${query}` };
  }

  if (operation === "assets.ticket.read") {
    const input = parseCloudRemoteReadOperationInput(operation, value);

    return {
      method: "GET",
      path: `/api/assets/ticket/${encodeURIComponent(input.ticket)}`
    };
  }

  if (operation === "overview.get") {
    const input = parseCloudRemoteReadOperationInput(operation, value);
    const query = new URLSearchParams();

    setNumber(query, "sessionLimit", input.sessionLimit);

    return { method: "GET", path: `/api/overview${query.size ? `?${query}` : ""}` };
  }

  if (operation === "managedSessions.get") {
    const input = parseCloudRemoteReadOperationInput(operation, value);
    const query = new URLSearchParams();

    setString(query, "view", input.view);

    setNumber(query, "logTail", input.debugLogTail);
    return {
      method: "GET",
      path: `/api/sessions/${encodeURIComponent(input.sessionId)}${query.size ? `?${query}` : ""}`
    };
  }

  if (operation === "sessions.list") {
    const input = parseCloudRemoteReadOperationInput(operation, value);
    const query = new URLSearchParams();

    setNumber(query, "limit", input.limit);

    setNumber(query, "offset", input.offset);
    setString(query, "query", input.query);
    setString(query, "source", input.sourceId);
    if (input.includeLiveMetadata === true) query.set("includeLiveMetadata", "1");
    return { method: "GET", path: `/api/agents/sessions${query.size ? `?${query}` : ""}` };
  }

  if (operation === "sessions.reviewed.post") {
    const input = parseCloudRemoteReadOperationInput(operation, value);

    return {
      method: "POST",
      path: `/api/agents/sessions/${encodeURIComponent(input.agentSessionId)}/reviewed`,
      body: {}
    };
  }

  // Workspace and Preview resources.
  if (operation === "workspace.files.list") {
    const input = parseCloudRemoteReadOperationInput(operation, value);
    const query = new URLSearchParams();

    setString(query, "path", input.path);

    setString(query, "cursor", input.cursor);
    setNumber(query, "limit", input.limit);
    return {
      method: "GET",
      path: `/api/workspaces/${encodeURIComponent(input.workspaceId)}/files${
        query.size ? `?${query}` : ""
      }`
    };
  }

  if (operation === "workspace.files.read") {
    const input = parseCloudRemoteReadOperationInput(operation, value);
    const query = new URLSearchParams({ path: input.path });

    return {
      method: "GET",
      path: `/api/workspaces/${encodeURIComponent(input.workspaceId)}/file?${query}`
    };
  }

  if (operation === "managed.git.refresh") {
    const input = parseCloudRemoteReadOperationInput(operation, value);
    const query = new URLSearchParams();

    setString(query, "view", input.view);

    return {
      method: "POST",
      path: `/api/sessions/${encodeURIComponent(input.sessionId)}/refresh-git${
        query.size ? `?${query}` : ""
      }`
    };
  }

  if (operation === "preview.candidates") {
    const input = parseCloudRemoteReadOperationInput(operation, value);
    const query = new URLSearchParams({ kind: input.kind, ownerId: input.ownerId });

    return { method: "GET", path: `/api/preview/candidates?${query}` };
  }

  // Transcript and change evidence.
  if (operation === "transcript.page") {
    const input = parseCloudRemoteReadOperationInput(operation, value);
    const sessionId = encodeURIComponent(input.agentSessionId);
    const query = new URLSearchParams();

    setString(query, "beforeEntryId", input.beforeEntryId);

    setNumber(query, "limit", input.limit);
    return {
      method: "GET",
      path: `/api/agents/sessions/${sessionId}/transcript-page?${query}`
    };
  }

  if (operation === "transcript.entries.get") {
    const input = parseCloudRemoteReadOperationInput(operation, value);
    const sessionId = encodeURIComponent(input.agentSessionId);
    const query = new URLSearchParams();

    setStringArray(query, "entryIds", input.entryIds);

    return {
      method: "GET",
      path: `/api/agents/sessions/${sessionId}/transcript-entries?${query}`
    };
  }

  if (operation === "transcript.entries.post") {
    const input = parseCloudRemoteReadOperationInput(operation, value);
    const sessionId = encodeURIComponent(input.agentSessionId);

    return {
      method: "POST",
      path: `/api/agents/sessions/${sessionId}/transcript-entries`,
      body: { entryIds: input.entryIds }
    };
  }

  if (operation === "changes.get" || operation === "changes.post") {
    const input = parseCloudRemoteReadOperationInput(operation, value);
    const sessionId = encodeURIComponent(input.agentSessionId);
    const path = `/api/agents/sessions/${sessionId}/changes/${encodeURIComponent(input.groupId)}`;

    if (operation === "changes.get") {
      const query = new URLSearchParams();

      setStringArray(query, "entryIds", input.sourceEntryIds);

      setJson(query, "entryRanges", input.sourceEntryRanges);
      setJson(query, "entrySpans", input.sourceEntrySpans);
      return { method: "GET", path: `${path}${query.size ? `?${query}` : ""}` };
    }

    return {
      method: "POST",
      path,
      body: {
        ...(input.sourceEntryIds ? { entryIds: input.sourceEntryIds } : {}),
        ...(input.sourceEntryRanges ? { entryRanges: input.sourceEntryRanges } : {}),
        ...(input.sourceEntrySpans ? { entrySpans: input.sourceEntrySpans } : {})
      }
    };
  }

  // Shared session-detail reads.
  const input = parseCloudRemoteReadOperationInput(operation, value);
  const sessionId = encodeURIComponent(input.agentSessionId);
  const suffix = operation === "sessions.get" ? "" : operation === "transcript.view"
    ? "/transcript-view" : "/transcript-updates";
  const query = new URLSearchParams();

  setNumber(query, "chatMessageTail", input.chatMessageTail);

  setNumber(query, "overlapItemCount", input.overlapItemCount);
  setNumber(query, "transcriptTail", input.transcriptTail);
  setString(query, "baseItemKey", input.baseItemKey);
  setString(query, "baseSourceEntryId", input.baseSourceEntryId);
  setString(query, "waitingSince", input.waitingSince);
  if (input.fullTranscript === true) query.set("fullTranscript", "1");
  if (input.includeSessionSummary === true) query.set("includeSessionSummary", "1");
  if (input.omitTranscript === true) query.set("omitTranscript", "1");
  if (input.transcriptDetail === "summary") query.set("transcriptDetail", "summary");
  return {
    method: "GET",
    path: `/api/agents/sessions/${sessionId}${suffix}${query.size ? `?${query}` : ""}`
  };
}

/** Executes only explicitly modelled read operations against loopback. */
export class CloudRemoteReadExecutor {
  private readonly fetchImplementation: typeof fetch;
  private readonly resolveSessionRoute?: CloudRemoteReadExecutorOptions["resolveSessionRoute"];
  private readonly timeoutMs: number;
  private readonly daemonOrigin: string;

  constructor(options: CloudRemoteReadExecutorOptions) {
    const origin = new URL(options.daemonOrigin);

    if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" ||
        origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) {
      throw new Error("Cloud remote reads require a trusted loopback daemon origin.");
    }

    this.daemonOrigin = origin.origin;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.resolveSessionRoute = options.resolveSessionRoute;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async execute(
    operation: CloudRemoteReadOperation,
    value: unknown,
    shutdownSignal?: AbortSignal
  ): Promise<CloudRemoteReadResult> {
    if (operation === "sessions.resolveRoute") {
      const input = parseCloudRemoteReadOperationInput(operation, value);

      if (!this.resolveSessionRoute) return { status: 503, body: { error: "remote_read_unavailable" } };

      try {
        shutdownSignal?.throwIfAborted();
        const route = await this.resolveSessionRoute(input.cloudSessionId);

        shutdownSignal?.throwIfAborted();

        return route
          ? { status: 200, body: { route } }
          : { status: 404, body: { error: "session_not_found" } };
      } catch (error) {
        if (shutdownSignal?.aborted) throw error;

        return { status: 503, body: { error: "remote_read_unavailable" } };
      }
    }

    const workspaceFileInput = operation === "workspace.files.list" ||
      operation === "workspace.files.read"
      ? parseCloudRemoteReadOperationInput(operation, value)
      : null;

    const request = buildRequest(operation, value);
    const controller = new AbortController();
    const signal = shutdownSignal
      ? AbortSignal.any([controller.signal, shutdownSignal])
      : controller.signal;
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    timeout.unref?.();

    try {
      const assetRange = operation === "assets.file.read" || operation === "assets.ticket.read"
        ? clampCloudRemoteAssetRange(parseCloudRemoteReadOperationInput(operation, value).range)
        : undefined;
      const response = await this.fetchImplementation(`${this.daemonOrigin}${request.path}`, {
        method: request.method,
        headers: {
          accept: "application/json",
          authorization: createCloudProcessLocalAuthorization(),
          ...(assetRange ? { range: assetRange } : {}),
          ...(request.body ? { "content-type": "application/json" } : {})
        },
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
        redirect: "error",
        signal
      });

      shutdownSignal?.throwIfAborted();
      const isAssetRead = operation === "assets.ticket.read" || operation === "assets.file.read";
      const isBinaryAssetRead = isAssetRead && (response.ok || response.status === 416);
      const responseLimit = isBinaryAssetRead
        ? CLOUD_REMOTE_ASSET_MAX_BODY_BYTES
        : CLOUD_REMOTE_READ_MAX_RESPONSE_BYTES;
      const bytes = await readBoundedCloudResponse(response, responseLimit);

      shutdownSignal?.throwIfAborted();

      if (!bytes) return { status: 502, body: { error: "remote_response_too_large" } };

      if (isBinaryAssetRead) {
        return {
          status: response.status,
          body: encodeCloudRemoteAssetEnvelope(response, bytes),
          binary: true
        };
      }

      try {
        const body = JSON.parse(bytes.toString("utf8")) as unknown;

        if (response.ok && operation === "workspace.files.list") {
          const sanitized = sanitizeWorkspaceDirectoryResponse(
            body,
            workspaceFileInput?.workspaceId ?? "",
            workspaceFileInput?.path ?? ""
          );

          return sanitized
            ? { status: response.status, body: sanitized }
            : { status: 502, body: { error: "invalid_remote_response" } };
        }

        if (response.ok && operation === "workspace.files.read") {
          const sanitized = sanitizeWorkspaceFileResponse(
            body,
            workspaceFileInput?.workspaceId ?? "",
            workspaceFileInput?.path ?? ""
          );

          return sanitized
            ? { status: response.status, body: sanitized }
            : { status: 502, body: { error: "invalid_remote_response" } };
        }

        return { status: response.status, body };
      } catch {
        return { status: 502, body: { error: "invalid_remote_response" } };
      }
    } catch (error) {
      if (shutdownSignal?.aborted) throw error;

      return {
        status: 503,
        body: {
          error: error instanceof Error && error.name === "AbortError"
            ? "remote_read_timeout"
            : "remote_read_unavailable"
        }
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
