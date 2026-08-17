import { randomUUID } from "node:crypto";

import type { LocalLlmChatChangeSet, LocalLlmChatMessage } from "@deskcue/protocol";
import type { DaemonEventBus } from "#application/ports";

import {
  buildAgentSystemPrompt,
  buildRequiredToolRepairTranscript,
  LOCAL_LLM_AGENT_TOOLS,
  MAX_LOCAL_LLM_AGENT_ROUNDS,
  MAX_LOCAL_LLM_TOOL_CALLS_PER_ROUND,
  MAX_REQUIRED_TOOL_CALL_REPAIR_ATTEMPTS,
  readAppliedFilePaths,
  requiredLocalLlmToolName,
  toLocalLlmChatEvent,
  toLocalLlmToolRequest
} from "./localLlmAgentTools.ts";
import type {
  LocalLlmAgentMessage,
  LocalLlmAgentTransport,
  LocalLlmCompletedToolCall,
  LocalLlmToolCapabilityProbe
} from "./localLlmAgentTransport.ts";
import type { ActiveLocalLlmGeneration } from "./localLlmStreamLifecycle.ts";
import { LocalLlmStreamLifecycle } from "./localLlmStreamLifecycle.ts";
import { LocalLlmChatLibrary } from "../storage/localLlmChatLibrary.ts";
import {
  createLocalLlmToolRequestedEvent,
  LocalLlmToolExecutor
} from "../tools/localLlmToolExecutor.ts";
import {
  captureLocalLlmWorkspaceGitBaseline,
  completeLocalLlmWorkspaceGitChangeSet
} from "../workspace/workspaceGitChangeSet.ts";

export type LocalLlmAgentContinuation = {
  assistantText?: string;
  messages: LocalLlmAgentMessage[];
  nextRound: number;
  turnId: string;
};

type LocalLlmManifest = Awaited<ReturnType<LocalLlmChatLibrary["createChat"]>>;
export type LocalLlmAgentGenerationOutcome = "not_agent" | "completed" | "waiting_approval";

/** Coordinates native function calling independently from normal chat transport. */
export class LocalLlmAgentOrchestrator {
  constructor(
    private readonly library: LocalLlmChatLibrary,
    private readonly agentTransport: LocalLlmAgentTransport,
    private readonly toolCapabilityProbe: LocalLlmToolCapabilityProbe,
    private readonly toolExecutor: LocalLlmToolExecutor,
    private readonly streamLifecycle: LocalLlmStreamLifecycle,
    private readonly events?: DaemonEventBus
  ) {}

  async run({
    active,
    chatId,
    manifest,
    messages,
    continuation,
    contextCompacted = false
  }: {
    active: ActiveLocalLlmGeneration;
    chatId: string;
    manifest: LocalLlmManifest;
    messages: LocalLlmChatMessage[];
    continuation?: LocalLlmAgentContinuation | null;
    contextCompacted?: boolean;
  }): Promise<LocalLlmAgentGenerationOutcome> {
    if (!manifest.workspace) return "not_agent";
    const capability = await this.toolCapabilityProbe.probe({
      model: manifest.model,
      runtimeId: manifest.runtimeId,
      signal: active.controller.signal
    });
    await this.library.setToolCapability(chatId, capability);
    if (!capability.modelSupportsToolCalls) return "not_agent";

    let transcript: LocalLlmAgentMessage[] = continuation?.messages ?? [
      ...(buildAgentSystemPrompt(manifest.systemPrompt, contextCompacted)
        ? [{ content: buildAgentSystemPrompt(manifest.systemPrompt, contextCompacted), role: "system" as const }]
        : []),
      ...messages.map((message) => ({ content: message.text, role: message.role }))
    ];
    const requiredToolName = continuation ? null : requiredLocalLlmToolName(messages.at(-1)?.text);
    let requiredToolRepairAttempts = 0;
    for (let round = continuation?.nextRound ?? 0; round < MAX_LOCAL_LLM_AGENT_ROUNDS; round += 1) {
      const toolCalls: LocalLlmCompletedToolCall[] = [];
      let roundText = "";
      const holdAssistantTextUntilToolCall = Boolean(requiredToolName && round === 0);
      await this.agentTransport.generate({
        messages: transcript,
        model: manifest.model,
        onEvent: (event) => {
          if (event.type === "assistant_text_delta") {
            if (holdAssistantTextUntilToolCall) {
              roundText += event.text;
            } else if (this.streamLifecycle.appendAssistantDelta(chatId, active, event.text)) {
              roundText += event.text;
            }
          } else if (event.type === "assistant_reasoning_delta") {
            this.streamLifecycle.appendAssistantReasoningDelta(active, event.text);
          } else {
            toolCalls.push(event.toolCall);
          }
        },
        runtimeId: manifest.runtimeId,
        signal: active.controller.signal,
        tools: LOCAL_LLM_AGENT_TOOLS
      });
      this.streamLifecycle.throwIfAssistantOutputLimited(active);
      if (!toolCalls.length) {
        if (requiredToolName && round === 0) {
          if (requiredToolRepairAttempts >= MAX_REQUIRED_TOOL_CALL_REPAIR_ATTEMPTS) {
            throw new Error(`Local model did not make the required ${requiredToolName} function call.`);
          }
          requiredToolRepairAttempts += 1;
          transcript = buildRequiredToolRepairTranscript(requiredToolName, messages.at(-1)?.text ?? "");
          round -= 1;
          continue;
        }
        return "completed";
      }

      if (holdAssistantTextUntilToolCall && roundText) {
        this.streamLifecycle.appendAssistantDelta(chatId, active, roundText);
      }

      transcript.push({ content: roundText, role: "assistant", toolCalls });
      for (const toolCall of toolCalls.slice(0, MAX_LOCAL_LLM_TOOL_CALLS_PER_ROUND)) {
        const request = toLocalLlmToolRequest(toolCall);
        await this.library.completeTurn(chatId, toLocalLlmChatEvent(createLocalLlmToolRequestedEvent({
          policy: manifest.agentMode,
          request,
          turnId: active.turnId,
          workspacePath: manifest.workspace.path
        })));
        this.streamLifecycle.publishChatUpdated(chatId);
        const workspaceBaseline = request.name === "run_workspace_command"
          ? await captureLocalLlmWorkspaceGitBaseline(manifest.workspace.path)
          : null;
        const result = await this.toolExecutor.execute({
          policy: manifest.agentMode,
          request,
          signal: active.controller.signal,
          turnId: active.turnId,
          workspacePath: manifest.workspace.path
        });
        await this.library.completeTurn(chatId, toLocalLlmChatEvent(result.event));
        this.streamLifecycle.publishChatUpdated(chatId);
        if (result.status === "requires_approval" && result.actionRequest) {
          await this.library.savePendingAgentAction(chatId, {
            actionRequest: { ...result.actionRequest, status: "pending" },
            continuation: {
              assistantText: active.text,
              messages: transcript,
              nextRound: round + 1,
              turnId: active.turnId
            },
            request
          });
          this.events?.publishServerEvent({
            type: "local.llm.chat.approval.required",
            payload: {
              action: result.actionRequest.action,
              chatId,
              model: manifest.model,
              requestedAt: result.actionRequest.requestedAt,
              runtimeId: manifest.runtimeId,
              summary: result.actionRequest.summary,
              title: manifest.title
            }
          });
          this.streamLifecycle.publishChatUpdated(chatId);
          return "waiting_approval";
        }
        if (request.name === "apply_unified_diff" && result.status === "completed") {
          await this.recordAppliedChangeSet(chatId, active.turnId, request.patch, result.result);
        }
        if (workspaceBaseline && result.status === "completed") {
          await this.recordObservedWorkspaceChangeSet(chatId, active.turnId, workspaceBaseline);
        }
        transcript.push({
          content: JSON.stringify(result.status === "completed" ? result.result : { error: result.error }),
          role: "tool",
          toolCallId: toolCall.id
        });
      }
    }
    throw new Error("Local agent reached the maximum number of tool rounds.");
  }

  async recordAppliedChangeSet(chatId: string, turnId: string, diff: string, result: unknown) {
    const files = readAppliedFilePaths(result);
    if (!files.length) return;
    const changeSet: LocalLlmChatChangeSet = {
      attribution: "applied_by_deskcue_local_agent",
      changedFiles: files,
      diff,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      turnId
    };
    await this.library.appendChangeSet(chatId, changeSet);
  }

  async recordObservedWorkspaceChangeSet(
    chatId: string,
    turnId: string,
    baseline: Awaited<ReturnType<typeof captureLocalLlmWorkspaceGitBaseline>>
  ) {
    const observed = await completeLocalLlmWorkspaceGitChangeSet(baseline);
    if (observed.kind === "unavailable" || !observed.changedFiles.length || !observed.finalSnapshot?.diff) return;
    await this.library.appendChangeSet(chatId, {
      attribution: observed.attribution,
      changedFiles: observed.changedFiles,
      diff: observed.finalSnapshot.diff,
      id: randomUUID(),
      timestamp: observed.completedAt,
      turnId
    });
  }
}
