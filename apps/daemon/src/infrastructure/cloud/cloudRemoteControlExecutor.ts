import type { RemoteControlOperation } from "@deskcue/protocol/cloud";
import {
  REMOTE_CONTROL_MAX_RESPONSE_BYTES,
  parseRemoteControlOperationInput
} from "@deskcue/protocol/cloud";
import { createCloudProcessLocalAuthorization } from "#security/cloudProcessLocalCredential";

import { readBoundedCloudResponse } from "./cloudBoundedResponse.ts";

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_LOCAL_RESPONSE_BYTES = REMOTE_CONTROL_MAX_RESPONSE_BYTES;

export type CloudRemoteControlResult = {
  status: number;
  body: unknown;
};

export type CloudRemoteControlExecutorOptions = {
  daemonOrigin: string;
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
};

function sanitizeControlResponse(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;

  const body = structuredClone(value as Record<string, unknown>);

  // SessionDetail embeds prompt history and logs. The Cloud command response
  // only needs the current session shape; never persist or relay those fields.
  if ("inputHistory" in body) body.inputHistory = [];
  if ("logs" in body) body.logs = [];
  if ("command" in body) body.command = "";
  if ("sourceSessionFilePath" in body) body.sourceSessionFilePath = null;
  if (body.replyState && typeof body.replyState === "object" && !Array.isArray(body.replyState)) {
    (body.replyState as Record<string, unknown>).promptText = null;
  }

  if (body.promptRecovery && typeof body.promptRecovery === "object" &&
      !Array.isArray(body.promptRecovery)) {
    (body.promptRecovery as Record<string, unknown>).promptText = null;
  }

  if (body.actionRequest && typeof body.actionRequest === "object" &&
      !Array.isArray(body.actionRequest)) {
    (body.actionRequest as Record<string, unknown>).command = null;
    (body.actionRequest as Record<string, unknown>).reason = null;
  }

  if (body.git && typeof body.git === "object" && !Array.isArray(body.git)) {
    const git = body.git as Record<string, unknown>;

    git.diff = "";
    git.changedFiles = [];
    git.changedFileStatuses = {};
    git.changedFilePreviousPaths = {};
    git.diffTruncated = false;
  }

  return body;
}

function buildRequest(
  operation: RemoteControlOperation,
  value: unknown
): { path: string; body: Record<string, unknown> } {
  if (operation === "source.attach") {
    const input = parseRemoteControlOperationInput(operation, value);

    return {
      path: `/api/agents/sessions/${encodeURIComponent(input.agentSessionId)}/attach`,
      body: input.prompt === undefined ? {} : { prompt: input.prompt }
    };
  }

  if (operation === "managed.input") {
    const input = parseRemoteControlOperationInput(operation, value);
    const sessionId = encodeURIComponent(input.sessionId);

    return { path: `/api/sessions/${sessionId}/input?compact=1`, body: { input: input.input } };
  }

  if (operation === "preview.configure") {
    const input = parseRemoteControlOperationInput(operation, value);
    const sessionId = encodeURIComponent(input.sessionId);

    return {
      path: `/api/sessions/${sessionId}/preview`,
      body: { port: input.port, networkMode: input.networkMode }
    };
  }

  if (operation === "preview.stop") {
    const input = parseRemoteControlOperationInput(operation, value);
    const sessionId = encodeURIComponent(input.sessionId);

    return {
      path: `/api/sessions/${sessionId}/preview`,
      body: { port: null, networkMode: "device-direct" }
    };
  }

  const input = parseRemoteControlOperationInput(operation, value);
  const sessionId = encodeURIComponent(input.sessionId);

  if (operation === "managed.stop") return { path: `/api/sessions/${sessionId}/stop?compact=1`, body: {} };

  return { path: `/api/sessions/${sessionId}/interrupt?compact=1`, body: {} };
}

/** Executes only the explicitly modelled Cloud control operations against loopback. */
export class CloudRemoteControlExecutor {
  private readonly daemonOrigin: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: CloudRemoteControlExecutorOptions) {
    const origin = new URL(options.daemonOrigin);

    if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" ||
        origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) {
      throw new Error("Cloud remote control requires a trusted loopback daemon origin.");
    }

    this.daemonOrigin = origin.origin;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async execute(
    operation: RemoteControlOperation,
    value: unknown,
    shutdownSignal?: AbortSignal
  ): Promise<CloudRemoteControlResult> {
    const request = buildRequest(operation, value);
    const controller = new AbortController();
    const signal = shutdownSignal
      ? AbortSignal.any([controller.signal, shutdownSignal])
      : controller.signal;
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    timeout.unref?.();

    try {
      const response = await this.fetchImplementation(`${this.daemonOrigin}${request.path}`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: createCloudProcessLocalAuthorization()
        },
        body: JSON.stringify(request.body),
        redirect: "error",
        signal
      });

      shutdownSignal?.throwIfAborted();
      const bytes = await readBoundedCloudResponse(response, MAX_LOCAL_RESPONSE_BYTES);

      shutdownSignal?.throwIfAborted();

      if (!bytes) return { status: 502, body: { error: "remote_control_failed" } };

      let responseBody: unknown;
      try {
        responseBody = JSON.parse(bytes.toString("utf8")) as unknown;
      } catch {
        return { status: 502, body: { error: "remote_control_failed" } };
      }

      if (!response.ok) return { status: response.status, body: { error: "remote_control_failed" } };

      const sanitizedBody = sanitizeControlResponse(responseBody);

      if (Buffer.byteLength(JSON.stringify(sanitizedBody), "utf8") > REMOTE_CONTROL_MAX_RESPONSE_BYTES) {
        return { status: 502, body: { error: "remote_control_failed" } };
      }

      return { status: response.status, body: sanitizedBody };
    } catch (error) {
      if (shutdownSignal?.aborted) throw error;

      return {
        status: 503,
        body: {
          error: error instanceof Error && error.name === "AbortError"
            ? "remote_control_timeout"
            : "remote_control_unavailable"
        }
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
