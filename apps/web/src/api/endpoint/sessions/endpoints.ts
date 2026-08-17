import type {
  ExternalClaudeBackgroundStopCapability,
  ExternalDesktopInterruptCapability,
  ExternalForceStopCapability,
  ExternalForceStopTarget,
  ManualCommandResult,
  PreviewNetworkMode,
  SessionDetail
} from "@deskcue/protocol";
import type { ApiErrorPayload } from "@api/transport/errors";
import { isApiHttpStatusError } from "@api/transport/errors";
import {
  getConditionalJsonResult,
  getNullableJson,
  postApi,
  postConditionalJsonResult
} from "@api/transport/requests";
import type { ConditionalJsonResult } from "@api/transport/requests";

import type {
  FetchSessionOptions,
  RefreshGitOptions,
  SendSessionInputOptions,
  SessionCommandResponse,
  SessionInterruptResponse,
  SessionUpdateResponse
} from "./types";

function buildFetchSessionQuery(options?: FetchSessionOptions) {
  const query = new URLSearchParams();
  if (options?.view) {
    query.set("view", options.view);
  }
  if (options?.debugLogTail !== undefined) {
    query.set("logTail", String(options.debugLogTail));
  }

  return query.size ? `?${query.toString()}` : "";
}

export const sessionsApi = {
  create(workspaceId: string, command: string) {
    return postApi<SessionDetail | ApiErrorPayload>("/api/sessions", {
      workspaceId,
      command
    });
  },

  runManualCommand(workspaceId: string, command: string) {
    return postApi<ManualCommandResult | ApiErrorPayload>("/api/manual-command", {
      workspaceId,
      command
    });
  },

  getOne(sessionId: string, options?: FetchSessionOptions) {
    return getNullableJson<SessionDetail>(
      `/api/sessions/${sessionId}${buildFetchSessionQuery(options)}`,
      "Failed to load session"
    );
  },

  sendInput(sessionId: string, input: string, options?: SendSessionInputOptions) {
    const query = options?.compact ? "?compact=1" : "";
    return postApi<SessionCommandResponse | ApiErrorPayload>(
      `/api/sessions/${sessionId}/input${query}`,
      {
        input
      },
      { commandId: options?.commandId }
    );
  },

  async getOneWithMeta(
    sessionId: string,
    options?: FetchSessionOptions
  ): Promise<ConditionalJsonResult<SessionDetail | null>> {
    try {
      return await getConditionalJsonResult<SessionDetail>(
        `/api/sessions/${sessionId}${buildFetchSessionQuery(options)}`,
        "Failed to load session",
        {
          signal: options?.signal
        }
      );
    } catch (error) {
      if (isApiHttpStatusError(error) && error.status === 404) {
        return {
          data: null,
          etag: null,
          notModified: false,
          status: 404
        };
      }

      throw error;
    }
  },

  stop(sessionId: string, commandId?: string) {
    return postApi<SessionUpdateResponse | ApiErrorPayload>(
      `/api/sessions/${sessionId}/stop?compact=1`,
      undefined,
      { commandId }
    );
  },

  interrupt(sessionId: string, commandId?: string) {
    return postApi<SessionInterruptResponse | ApiErrorPayload>(
      `/api/sessions/${sessionId}/interrupt?compact=1`,
      undefined,
      { commandId }
    );
  },

  getExternalClaudeBackgroundStopCapability(sessionId: string) {
    return getNullableJson<ExternalClaudeBackgroundStopCapability>(
      `/api/sessions/${sessionId}/external-claude-background-stop-capability`,
      "Failed to check Claude background stop availability"
    );
  },

  stopExternalClaudeBackground(sessionId: string) {
    return postApi<SessionUpdateResponse | ApiErrorPayload>(
      `/api/sessions/${sessionId}/external-claude-background-stop?compact=1`
    );
  },

  getExternalDesktopInterruptCapability(sessionId: string) {
    return getNullableJson<ExternalDesktopInterruptCapability>(
      `/api/sessions/${sessionId}/external-desktop-interrupt-capability`,
      "Failed to check Codex Desktop interrupt availability"
    );
  },

  interruptExternalDesktopSession(sessionId: string) {
    return postApi<SessionUpdateResponse | ApiErrorPayload>(
      `/api/sessions/${sessionId}/external-desktop-interrupt?compact=1`
    );
  },

  openExternalCodexDesktopChat(sessionId: string) {
    return postApi<{ requested: true } | ApiErrorPayload>(
      `/api/sessions/${sessionId}/external-desktop-open`
    );
  },

  getExternalForceStopCapability(sessionId: string) {
    return getNullableJson<ExternalForceStopCapability>(
      `/api/sessions/${sessionId}/external-force-stop-capability`,
      "Failed to check force stop availability"
    );
  },

  forceStopExternalProcess(sessionId: string, target: ExternalForceStopTarget) {
    return postApi<SessionUpdateResponse | ApiErrorPayload>(
      `/api/sessions/${sessionId}/external-force-stop?compact=1`,
      target
    );
  },

  refreshGit(sessionId: string, options?: RefreshGitOptions) {
    const query = options?.view ? `?view=${encodeURIComponent(options.view)}` : "";
    return postApi<SessionDetail | ApiErrorPayload>(
      `/api/sessions/${sessionId}/refresh-git${query}`
    );
  },

  refreshGitWithMeta(
    sessionId: string,
    options?: RefreshGitOptions
  ): Promise<ConditionalJsonResult<SessionDetail>> {
    const query = options?.view ? `?view=${encodeURIComponent(options.view)}` : "";
    return postConditionalJsonResult<SessionDetail>(
      `/api/sessions/${sessionId}/refresh-git${query}`,
      undefined,
      "Failed to refresh git state"
    );
  },

  setPreview(
    sessionId: string,
    input: { port: number | null; networkMode: PreviewNetworkMode },
    commandId?: string
  ) {
    return postApi<SessionDetail | ApiErrorPayload>(
      `/api/sessions/${sessionId}/preview`,
      { ...input },
      { commandId }
    );
  },
};
