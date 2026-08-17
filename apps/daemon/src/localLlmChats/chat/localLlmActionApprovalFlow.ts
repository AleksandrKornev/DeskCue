import { randomUUID } from "node:crypto";

import { AppError } from "#application/errors";

import { LocalLlmAgentOrchestrator } from "../generation/localLlmAgentOrchestrator.ts";
import { toLocalLlmChatEvent } from "../generation/localLlmAgentTools.ts";
import type { LocalLlmGenerationSlotRelease } from "../generation/localLlmGenerationGate.ts";
import { LocalLlmGenerationLifecycle } from "../generation/localLlmGenerationLifecycle.ts";
import { LocalLlmChatLibrary } from "../storage/localLlmChatLibrary.ts";
import { LocalLlmToolExecutor } from "../tools/localLlmToolExecutor.ts";
import { captureLocalLlmWorkspaceGitBaseline } from "../workspace/workspaceGitChangeSet.ts";

/**
 * Resolves a durable approval boundary and resumes the exact suspended agent
 * continuation. Tool execution, audit events and continuation ownership stay
 * in one transaction-shaped flow.
 */
export class LocalLlmActionApprovalFlow {
  constructor(
    private readonly library: LocalLlmChatLibrary,
    private readonly toolExecutor: LocalLlmToolExecutor,
    private readonly agentOrchestrator: LocalLlmAgentOrchestrator,
    private readonly generations: LocalLlmGenerationLifecycle
  ) {}

  async resolve(
    chatId: string,
    actionRequestId: string,
    decision: "approve" | "reject",
    releaseGenerationSlot: LocalLlmGenerationSlotRelease,
    signal: AbortSignal
  ) {
    signal.throwIfAborted();
    const manifest = await this.library.getManifest(chatId);
    const actionRequest = (manifest.actionRequests ?? []).find((item) => item.id === actionRequestId);
    if (!actionRequest || actionRequest.status !== "pending") {
      throw new AppError("not_found", "Pending local agent action not found.");
    }
    if (!manifest.workspace) {
      throw new AppError("conflict", "Attach a workspace before resolving this action.");
    }
    const request = await this.library.takePendingToolRequest(chatId, actionRequestId);
    if (!request) {
      throw new AppError("not_found", "The requested local agent action is no longer available.");
    }
    const continuation = await this.library.readAgentContinuation(chatId);
    if (!continuation || continuation.turnId !== actionRequest.turnId) {
      throw new AppError("conflict", "The local agent continuation is no longer available.");
    }
    const workspaceBaseline = decision === "approve" && request.name === "run_workspace_command"
      ? await captureLocalLlmWorkspaceGitBaseline(manifest.workspace.path)
      : null;
    const result = decision === "approve"
      ? await this.toolExecutor.execute({
        policy: "full_access",
        request,
        signal,
        turnId: actionRequest.turnId,
        workspacePath: manifest.workspace.path
      })
      : null;
    signal.throwIfAborted();
    const status = decision === "reject"
      ? "rejected" as const
      : result?.status === "completed"
        ? "executed" as const
        : "failed" as const;
    await this.library.upsertActionRequest(chatId, { ...actionRequest, status });
    await this.library.removePendingToolRequest(chatId, actionRequestId);
    if (result) {
      await this.library.completeTurn(chatId, toLocalLlmChatEvent(result.event));
    }
    await this.library.completeTurn(chatId, {
      id: randomUUID(),
      turnId: actionRequest.turnId,
      type: "action_resolved",
      timestamp: new Date().toISOString(),
      summary: decision === "reject"
        ? "Local agent action was rejected."
        : result?.status === "completed"
          ? "Approved local agent action completed."
          : `Approved local agent action failed: ${result?.error ?? "unknown error"}`
    });
    if (request.name === "apply_unified_diff" && result?.status === "completed") {
      await this.agentOrchestrator.recordAppliedChangeSet(
        chatId,
        actionRequest.turnId,
        request.patch,
        result.result
      );
    }
    if (workspaceBaseline && result?.status === "completed") {
      await this.agentOrchestrator.recordObservedWorkspaceChangeSet(
        chatId,
        actionRequest.turnId,
        workspaceBaseline
      );
    }
    this.generations.resumeAfterAction({
      actionRequest,
      chatId,
      continuation,
      manifest,
      releaseGenerationSlot,
      result: decision === "reject"
        ? { rejected: true, error: "User rejected this action." }
        : result?.status === "completed"
          ? result.result
          : { error: result?.error ?? "Action failed." }
    });
  }
}
