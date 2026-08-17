export type LocalLlmToolPolicy = "read_only" | "ask" | "auto_workspace" | "full_access";

export type LocalLlmToolRequest =
  | {
      id: string;
      name: "list_workspace_files";
      path?: string;
      maxEntries?: number;
    }
  | {
      id: string;
      name: "read_workspace_file";
      path: string;
      maxBytes?: number;
    }
  | {
      id: string;
      name: "search_workspace_text";
      query: string;
      path?: string;
      maxResults?: number;
    }
  | {
      id: string;
      name: "apply_unified_diff";
      patch: string;
    }
  | {
      id: string;
      name: "run_workspace_command";
      command: string;
      args?: readonly string[];
      timeoutMs?: number;
    };

export type LocalLlmActionRequest = {
  action: "apply_unified_diff" | "run_workspace_command";
  id: string;
  requestedAt: string;
  summary: string;
  toolCallId: string;
  turnId: string;
};

export type LocalLlmToolExecutorEvent =
  | {
      type: "tool_requested";
      eventId: string;
      timestamp: string;
      turnId: string;
      toolCallId: string;
      toolName: LocalLlmToolRequest["name"];
    }
  | {
      type: "tool_completed";
      eventId: string;
      timestamp: string;
      turnId: string;
      toolCallId: string;
      toolName: LocalLlmToolRequest["name"];
      summary: string;
    }
  | {
      type: "tool_failed";
      eventId: string;
      timestamp: string;
      turnId: string;
      toolCallId: string;
      toolName: LocalLlmToolRequest["name"];
      error: string;
    }
  | {
      type: "action_requested";
      eventId: string;
      timestamp: string;
      turnId: string;
      toolCallId: string;
      actionRequest: LocalLlmActionRequest;
    };

export type LocalLlmToolResult = {
  actionRequest?: LocalLlmActionRequest;
  error?: string;
  event: LocalLlmToolExecutorEvent;
  result?: unknown;
  status: "completed" | "failed" | "requires_approval";
  toolCallId: string;
};

export type LocalLlmToolExecutorLimits = {
  maxCommandOutputBytes: number;
  maxCommandTimeoutMs: number;
  maxDiffBytes: number;
  maxFilesPerDiff: number;
  maxPatchSourceBytes: number;
  maxReadBytes: number;
  maxSearchBytes: number;
  maxSearchDepth: number;
  maxSearchDirectories: number;
  maxSearchDurationMs: number;
  maxSearchFileBytes: number;
  maxSearchFiles: number;
  maxSearchResults: number;
  maxWorkspaceEntries: number;
};

export type LocalLlmToolExecutorOptions = Partial<LocalLlmToolExecutorLimits> & {
  /** Exact executable names that DeskCue must reject even in Full access mode. */
  deniedExecutables?: readonly string[];
};

export type ExecuteLocalLlmToolInput = {
  policy: LocalLlmToolPolicy;
  request: LocalLlmToolRequest;
  signal?: AbortSignal;
  turnId: string;
  workspacePath: string;
};

export const DEFAULT_LOCAL_LLM_TOOL_EXECUTOR_LIMITS: LocalLlmToolExecutorLimits = {
  maxCommandOutputBytes: 64 * 1024,
  maxCommandTimeoutMs: 60_000,
  maxDiffBytes: 512 * 1024,
  maxFilesPerDiff: 30,
  maxPatchSourceBytes: 8 * 1024 * 1024,
  maxReadBytes: 64 * 1024,
  maxSearchBytes: 4 * 1024 * 1024,
  maxSearchDepth: 16,
  maxSearchDirectories: 1_000,
  maxSearchDurationMs: 5_000,
  maxSearchFileBytes: 512 * 1024,
  maxSearchFiles: 2_000,
  maxSearchResults: 100,
  maxWorkspaceEntries: 400
};

export class LocalLlmToolError extends Error {}

export function clampLocalLlmToolLimit(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function localLlmToolErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
