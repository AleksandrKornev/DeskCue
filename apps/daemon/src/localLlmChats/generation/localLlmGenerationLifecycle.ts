import type { LocalLlmChatMessage, LocalLlmChatSummary } from "@deskcue/protocol";
import { AppError } from "#application/errors";
import type { DaemonEventBus } from "#application/ports";

import { LocalLlmAgentOrchestrator } from "./localLlmAgentOrchestrator.ts";
import type { LocalLlmAgentContinuation } from "./localLlmAgentOrchestrator.ts";
import { buildInferenceSystemPrompt } from "./localLlmAgentTools.ts";
import type { LocalLlmGenerationSlotRelease } from "./localLlmGenerationGate.ts";
import { NativeLmStudioStreamError } from "./localLlmProviderTransport.ts";
import type { LocalLlmChatTransport } from "./localLlmProviderTransport.ts";
import {
  createActiveLocalLlmGeneration,
  LocalLlmStreamLifecycle
} from "./localLlmStreamLifecycle.ts";
import type { ActiveLocalLlmGeneration } from "./localLlmStreamLifecycle.ts";
import type { LocalLlmActiveTurn } from "../chat/localLlmChatEvents.ts";
import { LocalLlmChatLibrary } from "../storage/localLlmChatLibrary.ts";
import type { LocalLlmChatManifest } from "../storage/localLlmChatStorageSchema.ts";

type GenerationOutcome = {
  error: string | null;
  state: LocalLlmChatSummary["generationState"];
};

/**
 * Owns in-memory generation identity and its durable terminal projection.
 * Starting, resuming, interrupting, finishing and draining all observe the
 * same active/outcome registries instead of coordinating separate maps.
 */
export class LocalLlmGenerationLifecycle {
  private readonly activeByChatId = new Map<string, ActiveLocalLlmGeneration>();
  private readonly outcomesByChatId = new Map<string, GenerationOutcome>();

  constructor(
    private readonly library: LocalLlmChatLibrary,
    private readonly transport: LocalLlmChatTransport,
    private readonly agentOrchestrator: LocalLlmAgentOrchestrator,
    private readonly streamLifecycle: LocalLlmStreamLifecycle,
    private readonly events?: DaemonEventBus
  ) {}

  hasActive(chatId: string) {
    return this.activeByChatId.has(chatId);
  }

  hasAnyActive() {
    return this.activeByChatId.size > 0;
  }

  getPendingAssistantText(chatId: string, manifest: LocalLlmChatManifest) {
    const active = this.activeByChatId.get(chatId);
    const continuationText = !active ? manifest.agentContinuation?.assistantText ?? null : null;
    return active?.text || continuationText;
  }

  getSummaryState(manifest: LocalLlmChatManifest): Pick<LocalLlmChatSummary, "generationError" | "generationState"> {
    const active = this.activeByChatId.get(manifest.id);
    const outcome = this.outcomesByChatId.get(manifest.id);
    return {
      generationState: active
        ? "running"
        : (manifest.actionRequests ?? []).some((action) => action.status === "pending")
          ? "waiting_approval"
          : manifest.activeTurn
            ? "running"
            : outcome?.state ?? "idle",
      generationError: active?.error ?? outcome?.error ?? null
    };
  }

  startGeneration(input: {
    chatId: string;
    contextCompacted: boolean;
    manifest: LocalLlmChatManifest;
    messages: LocalLlmChatMessage[];
    releaseGenerationSlot: LocalLlmGenerationSlotRelease;
    turn: LocalLlmActiveTurn;
  }) {
    const active = createActiveLocalLlmGeneration(input.turn);
    this.outcomesByChatId.delete(input.chatId);
    this.activeByChatId.set(input.chatId, active);
    this.streamLifecycle.publishChatUpdated(input.chatId);
    active.promise = this.runGeneration({ ...input, active });
    void active.promise;
  }

  resumeAfterAction(input: {
    actionRequest: { toolCallId: string; turnId: string };
    chatId: string;
    continuation: LocalLlmAgentContinuation;
    manifest: LocalLlmChatManifest;
    releaseGenerationSlot: LocalLlmGenerationSlotRelease;
    result: unknown;
  }) {
    if (this.activeByChatId.has(input.chatId)) {
      throw new AppError("conflict", "This local chat is already resuming an action.");
    }
    const activeTurn = input.manifest.activeTurn;
    if (!activeTurn || activeTurn.turnId !== input.actionRequest.turnId) {
      throw new AppError("conflict", "The local agent turn is no longer active.");
    }
    const active = createActiveLocalLlmGeneration(
      activeTurn,
      input.continuation.assistantText ?? ""
    );
    this.activeByChatId.set(input.chatId, active);
    active.promise = this.runResumedAgentGeneration({
      active,
      chatId: input.chatId,
      continuation: {
        ...input.continuation,
        messages: [...input.continuation.messages, {
          content: JSON.stringify(input.result),
          role: "tool",
          toolCallId: input.actionRequest.toolCallId
        }]
      },
      manifest: input.manifest,
      releaseGenerationSlot: input.releaseGenerationSlot
    });
    void active.promise;
  }

  async interrupt(chatId: string) {
    const active = this.activeByChatId.get(chatId);
    if (active) {
      active.controller.abort();
      await active.promise;
    }
  }

  abortAndSnapshot(previous: ActiveLocalLlmGeneration[] = []) {
    const activeGenerations = Array.from(new Set([
      ...previous,
      ...this.activeByChatId.values()
    ]));
    for (const active of activeGenerations) {
      active.controller.abort();
    }
    return activeGenerations;
  }

  async collectDrainFailures(activeGenerations: ActiveLocalLlmGeneration[]) {
    const results = await Promise.allSettled(activeGenerations.map((active) => active.promise));
    const checkpointResults = await Promise.allSettled(
      activeGenerations.map((active) => active.checkpointPromise)
    );
    return [...results, ...checkpointResults]
      .filter((result): result is PromiseRejectedResult => result.status === "rejected");
  }

  private async runResumedAgentGeneration(input: {
    active: ActiveLocalLlmGeneration;
    chatId: string;
    continuation: LocalLlmAgentContinuation;
    manifest: LocalLlmChatManifest;
    releaseGenerationSlot: LocalLlmGenerationSlotRelease;
  }) {
    const { active, chatId, continuation, manifest, releaseGenerationSlot } = input;
    try {
      const outcome = await this.agentOrchestrator.run({ active, chatId, manifest, messages: [], continuation });
      if (outcome === "waiting_approval") {
        this.outcomesByChatId.set(chatId, { error: null, state: "waiting_approval" });
        return;
      }
      if (outcome === "not_agent") {
        throw new Error("Local model no longer supports tool calling for this continuation.");
      }
      if (active.text.trim()) {
        await this.streamLifecycle.finalizeAssistant(chatId, active, {
          id: active.assistantMessageId,
          role: "assistant",
          text: active.text,
          timestamp: new Date().toISOString(),
          status: "complete"
        }, "turn_completed");
      } else {
        await this.streamLifecycle.recordTerminal(chatId, active, "turn_completed");
      }
      this.outcomesByChatId.set(chatId, { error: null, state: "idle" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Local agent continuation failed.";
      await this.streamLifecycle.recordTerminal(chatId, active, "turn_failed", message);
      this.outcomesByChatId.set(chatId, { error: message, state: "failed" });
    } finally {
      if (active.checkpointTimer) clearTimeout(active.checkpointTimer);
      this.streamLifecycle.flushRealtimeUpdate(chatId, active, true);
      this.activeByChatId.delete(chatId);
      releaseGenerationSlot();
    }
  }

  private async runGeneration(input: {
    active: ActiveLocalLlmGeneration;
    chatId: string;
    contextCompacted: boolean;
    manifest: LocalLlmChatManifest;
    messages: LocalLlmChatMessage[];
    releaseGenerationSlot: LocalLlmGenerationSlotRelease;
    turn: LocalLlmActiveTurn;
  }) {
    const {
      active,
      chatId,
      contextCompacted,
      manifest,
      messages,
      releaseGenerationSlot
    } = input;
    const useNativeSession = manifest.runtimeId === "lm-studio"
      && (Boolean(manifest.lmStudioSession?.responseId) || messages.length === 1)
      && manifest.lmStudioSession?.mode !== "history_replay";
    try {
      const agentOutcome = await this.agentOrchestrator.run({ active, chatId, manifest, messages, contextCompacted });
      if (agentOutcome === "waiting_approval") {
        await this.streamLifecycle.persistAssistantReasoning(chatId, active);
        this.outcomesByChatId.set(chatId, { error: null, state: "waiting_approval" });
        return;
      }
      const result = agentOutcome !== "not_agent" ? undefined : await this.transport.generate({
        model: manifest.model,
        messages: messages.map(({ role, text }) => ({ role, text })),
        onDelta: (text) => this.streamLifecycle.appendAssistantDelta(chatId, active, text),
        onReasoningDelta: (text) => this.streamLifecycle.appendAssistantReasoningDelta(active, text),
        previousResponseId: manifest.lmStudioSession?.responseId,
        runtimeId: manifest.runtimeId,
        signal: active.controller.signal,
        systemPrompt: buildInferenceSystemPrompt(manifest.systemPrompt, contextCompacted),
        useNativeSession
      });
      this.streamLifecycle.throwIfAssistantOutputLimited(active);
      if (manifest.runtimeId === "lm-studio" && useNativeSession && agentOutcome === "not_agent") {
        await this.library.setLmStudioSession(chatId, result?.responseId ?? null);
      }
      if (active.text.trim()) {
        await this.streamLifecycle.finalizeAssistant(chatId, active, {
          id: active.assistantMessageId,
          role: "assistant",
          text: active.text,
          timestamp: new Date().toISOString(),
          status: "complete"
        }, "turn_completed");
      } else {
        await this.streamLifecycle.recordTerminal(chatId, active, "turn_completed");
      }
      this.outcomesByChatId.set(chatId, { error: null, state: "idle" });
    } catch (error) {
      if (manifest.runtimeId === "lm-studio" && useNativeSession) {
        await this.library.setLmStudioSession(
          chatId,
          error instanceof NativeLmStudioStreamError ? error.responseId ?? null : null
        );
      }
      if (active.outputLimitReached) {
        const message = active.error ?? "Local assistant response exceeded the 512 KiB limit.";
        await this.persistInterruptedOrTerminal(chatId, active, "turn_failed", message);
        this.outcomesByChatId.set(chatId, { error: message, state: "failed" });
      } else if (active.controller.signal.aborted) {
        await this.persistInterruptedOrTerminal(chatId, active, "turn_interrupted");
        this.outcomesByChatId.set(chatId, { error: null, state: "interrupted" });
      } else {
        const message = error instanceof Error ? error.message : "Local runtime request failed.";
        await this.persistInterruptedOrTerminal(chatId, active, "turn_failed", message);
        active.error = message;
        this.outcomesByChatId.set(chatId, { error: message, state: "failed" });
      }
    } finally {
      if (active.checkpointTimer) {
        clearTimeout(active.checkpointTimer);
        active.checkpointTimer = null;
      }
      this.publishChatFinished(chatId, manifest, active);
      this.streamLifecycle.flushRealtimeUpdate(chatId, active, true);
      this.activeByChatId.delete(chatId);
      releaseGenerationSlot();
    }
  }

  private async persistInterruptedOrTerminal(
    chatId: string,
    active: ActiveLocalLlmGeneration,
    eventType: "turn_failed" | "turn_interrupted",
    error?: string
  ) {
    if (active.text.trim()) {
      await this.streamLifecycle.finalizeAssistant(chatId, active, {
        id: active.assistantMessageId,
        role: "assistant",
        text: active.text,
        timestamp: new Date().toISOString(),
        status: "interrupted"
      }, eventType, error);
    } else {
      await this.streamLifecycle.recordTerminal(chatId, active, eventType, error);
    }
  }

  private publishChatFinished(
    chatId: string,
    manifest: LocalLlmChatManifest,
    active: ActiveLocalLlmGeneration
  ) {
    const outcome = this.outcomesByChatId.get(chatId);
    if (!outcome || outcome.state === "waiting_approval") return;
    const status = outcome.state === "idle"
      ? "completed"
      : outcome.state === "interrupted"
        ? "interrupted"
        : "failed";
    this.events?.publishServerEvent({
      type: "local.llm.chat.finished",
      payload: {
        answer: active.text.trim() || null,
        chatId,
        completedAt: new Date().toISOString(),
        error: outcome.error,
        model: manifest.model,
        runtimeId: manifest.runtimeId,
        status,
        title: manifest.title
      }
    });
  }
}
