import { randomUUID } from "node:crypto";

import {
  createDeniedLocalLlmExecutableSet,
  runLocalLlmWorkspaceCommand
} from "./localLlmCommandRunner.ts";
import {
  createLocalLlmActionRequest,
  createLocalLlmToolRequestedEvent,
  isLocalLlmToolAllowed,
  localLlmToolRequiresApproval
} from "./localLlmToolPolicy.ts";
import {
  DEFAULT_LOCAL_LLM_TOOL_EXECUTOR_LIMITS,
  LocalLlmToolError,
  localLlmToolErrorMessage
} from "./localLlmToolTypes.ts";
import type {
  ExecuteLocalLlmToolInput,
  LocalLlmToolExecutorLimits,
  LocalLlmToolExecutorOptions,
  LocalLlmToolRequest,
  LocalLlmToolResult
} from "./localLlmToolTypes.ts";
import { applyLocalLlmUnifiedDiff } from "./localLlmUnifiedDiff.ts";
import {
  listLocalLlmWorkspaceFiles,
  readLocalLlmWorkspaceFile,
  resolveLocalLlmWorkspaceRoot,
  searchLocalLlmWorkspaceText
} from "./localLlmWorkspaceFilesystem.ts";

export {
  DEFAULT_LOCAL_LLM_TOOL_EXECUTOR_LIMITS,
  createLocalLlmToolRequestedEvent
};
export type {
  ExecuteLocalLlmToolInput,
  LocalLlmActionRequest,
  LocalLlmToolExecutorEvent,
  LocalLlmToolExecutorLimits,
  LocalLlmToolExecutorOptions,
  LocalLlmToolPolicy,
  LocalLlmToolRequest,
  LocalLlmToolResult
} from "./localLlmToolTypes.ts";

function summarizeResult(request: LocalLlmToolRequest, result: unknown) {
  if (request.name === "apply_unified_diff") {
    return `${(result as { files: unknown[] }).files.length} file change(s) applied.`;
  }
  if (request.name === "run_workspace_command") {
    return `Command ${request.command} finished.`;
  }
  return `${request.name} completed.`;
}

/**
 * Isolated executor for DeskCue-owned local-agent turns.
 *
 * It does not persist events itself. The caller appends the returned event to
 * its durable turn ledger before asking the model to continue, which makes
 * recovery deterministic after a daemon restart.
 */
export class LocalLlmToolExecutor {
  private readonly deniedExecutables: Set<string>;
  private readonly limits: LocalLlmToolExecutorLimits;

  constructor(options: LocalLlmToolExecutorOptions = {}) {
    this.limits = { ...DEFAULT_LOCAL_LLM_TOOL_EXECUTOR_LIMITS, ...options };
    this.deniedExecutables = createDeniedLocalLlmExecutableSet(options.deniedExecutables ?? []);
  }

  async execute(input: ExecuteLocalLlmToolInput): Promise<LocalLlmToolResult> {
    const requestedAt = new Date().toISOString();
    const root = await resolveLocalLlmWorkspaceRoot(input.workspacePath);
    try {
      if (localLlmToolRequiresApproval(input.policy, input.request)) {
        const actionRequest = createLocalLlmActionRequest(input, requestedAt);
        return {
          actionRequest,
          event: {
            type: "action_requested",
            eventId: randomUUID(),
            timestamp: requestedAt,
            turnId: input.turnId,
            toolCallId: input.request.id,
            actionRequest
          },
          status: "requires_approval",
          toolCallId: input.request.id
        };
      }

      if (!isLocalLlmToolAllowed(input.policy, input.request)) {
        throw new LocalLlmToolError(`Tool ${input.request.name} is unavailable in ${input.policy} mode.`);
      }

      input.signal?.throwIfAborted();
      const result = await this.executeAllowed(root, input.request, input.signal);
      return {
        event: {
          type: "tool_completed",
          eventId: randomUUID(),
          timestamp: new Date().toISOString(),
          turnId: input.turnId,
          toolCallId: input.request.id,
          toolName: input.request.name,
          summary: summarizeResult(input.request, result)
        },
        result,
        status: "completed",
        toolCallId: input.request.id
      };
    } catch (error) {
      const message = localLlmToolErrorMessage(error);
      return {
        error: message,
        event: {
          type: "tool_failed",
          eventId: randomUUID(),
          timestamp: new Date().toISOString(),
          turnId: input.turnId,
          toolCallId: input.request.id,
          toolName: input.request.name,
          error: message
        },
        status: "failed",
        toolCallId: input.request.id
      };
    }
  }

  private async executeAllowed(
    root: string,
    request: LocalLlmToolRequest,
    signal?: AbortSignal
  ): Promise<unknown> {
    switch (request.name) {
      case "list_workspace_files":
        return listLocalLlmWorkspaceFiles(root, request, this.limits, signal);
      case "read_workspace_file":
        return readLocalLlmWorkspaceFile(root, request, this.limits, signal);
      case "search_workspace_text":
        return searchLocalLlmWorkspaceText(root, request, this.limits, signal);
      case "apply_unified_diff":
        return applyLocalLlmUnifiedDiff(root, request.patch, this.limits);
      case "run_workspace_command":
        return runLocalLlmWorkspaceCommand(root, request, this.deniedExecutables, this.limits, signal);
    }
  }
}
