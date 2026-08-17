import { randomUUID } from "node:crypto";

import type { LocalLlmChatEventType, LocalLlmChatMessage } from "@deskcue/protocol";
import type { DaemonEventBus } from "#application/ports";

import type { LocalLlmActiveTurn } from "../chat/localLlmChatEvents.ts";
import {
  LocalLlmChatLibrary,
  MAX_LOCAL_LLM_ASSISTANT_MESSAGE_BYTES
} from "../storage/localLlmChatLibrary.ts";

const STREAM_CHECKPOINT_INTERVAL_MS = 1_000;
const MAX_LOCAL_LLM_REASONING_BYTES = 128 * 1024;
const LOCAL_LLM_REALTIME_DELTA_UPDATE_MS = 750;

export type ActiveLocalLlmGeneration = {
  assistantMessageId: string;
  controller: AbortController;
  error: string | null;
  checkpointPromise: Promise<void>;
  checkpointTimer: NodeJS.Timeout | null;
  lastCheckpointAt: number;
  promise: Promise<void>;
  reasoning: string;
  reasoningRecorded: boolean;
  reasoningTruncated: boolean;
  text: string;
  turnId: string;
  outputLimitReached: boolean;
  realtimeUpdateTimer: NodeJS.Timeout | null;
};

export function createActiveLocalLlmGeneration(
  turn: Pick<LocalLlmActiveTurn, "assistantMessageId" | "turnId">,
  text = ""
): ActiveLocalLlmGeneration {
  return {
    assistantMessageId: turn.assistantMessageId,
    controller: new AbortController(),
    error: null,
    checkpointPromise: Promise.resolve(),
    checkpointTimer: null,
    lastCheckpointAt: Date.now(),
    promise: Promise.resolve(),
    reasoning: "",
    reasoningRecorded: false,
    reasoningTruncated: false,
    text,
    turnId: turn.turnId,
    outputLimitReached: false,
    realtimeUpdateTimer: null
  };
}

/**
 * Owns the volatile stream buffer and its durable/realtime projection. The
 * service decides turn state; this collaborator makes partial output survive
 * interruption and daemon shutdown without coupling provider transports to
 * storage or websocket events.
 */
export class LocalLlmStreamLifecycle {
  constructor(
    private readonly library: LocalLlmChatLibrary,
    private readonly events?: DaemonEventBus
  ) {}

  appendAssistantDelta(chatId: string, active: ActiveLocalLlmGeneration, text: string) {
    if (!text || active.outputLimitReached) return false;
    if (Buffer.byteLength(active.text, "utf8") + Buffer.byteLength(text, "utf8") > MAX_LOCAL_LLM_ASSISTANT_MESSAGE_BYTES) {
      active.outputLimitReached = true;
      active.error = "Local assistant response exceeded the 512 KiB limit.";
      active.controller.abort();
      return false;
    }
    active.text += text;
    this.scheduleCheckpoint(chatId, active);
    this.scheduleRealtimeUpdate(chatId, active);
    return true;
  }

  appendAssistantReasoningDelta(active: ActiveLocalLlmGeneration, text: string) {
    if (!text || active.reasoningTruncated) return;
    const next = active.reasoning + text;
    if (Buffer.byteLength(next, "utf8") <= MAX_LOCAL_LLM_REASONING_BYTES) {
      active.reasoning = next;
      return;
    }

    const remainingBytes = Math.max(
      0,
      MAX_LOCAL_LLM_REASONING_BYTES - Buffer.byteLength(active.reasoning, "utf8")
    );
    if (remainingBytes > 0) active.reasoning += Buffer.from(text, "utf8").subarray(0, remainingBytes).toString("utf8");
    active.reasoningTruncated = true;
  }

  throwIfAssistantOutputLimited(active: ActiveLocalLlmGeneration) {
    if (active.outputLimitReached) {
      throw new Error(active.error ?? "Local assistant response exceeded the 512 KiB limit.");
    }
  }

  async persistAssistantReasoning(chatId: string, active: ActiveLocalLlmGeneration) {
    if (active.reasoningRecorded || !active.reasoning.trim()) return;
    active.reasoningRecorded = true;
    await this.library.completeTurn(chatId, {
      id: randomUUID(),
      turnId: active.turnId,
      type: "model_reasoning_saved",
      timestamp: new Date().toISOString(),
      messageId: active.assistantMessageId,
      summary: active.reasoningTruncated
        ? `${active.reasoning}\n\n[Reasoning was truncated at 128 KiB]`
        : active.reasoning
    });
  }

  async finalizeAssistant(
    chatId: string,
    active: ActiveLocalLlmGeneration,
    message: LocalLlmChatMessage,
    terminalType: Extract<LocalLlmChatEventType, "turn_completed" | "turn_failed" | "turn_interrupted">,
    error?: string
  ) {
    if (active.checkpointTimer) {
      clearTimeout(active.checkpointTimer);
      active.checkpointTimer = null;
    }
    await active.checkpointPromise;
    await this.library.finalizeAssistant(chatId, message);
    await this.library.completeTurn(chatId, {
      id: randomUUID(),
      turnId: active.turnId,
      type: "assistant_message_saved",
      timestamp: message.timestamp,
      messageId: message.id
    });
    await this.recordTerminal(chatId, active, terminalType, error);
  }

  async recordTerminal(
    chatId: string,
    active: ActiveLocalLlmGeneration,
    type: Extract<LocalLlmChatEventType, "turn_completed" | "turn_failed" | "turn_interrupted">,
    error?: string
  ) {
    await this.persistAssistantReasoning(chatId, active);
    await this.library.completeTurn(chatId, {
      id: randomUUID(),
      turnId: active.turnId,
      type,
      timestamp: new Date().toISOString(),
      error
    });
  }

  publishChatUpdated(chatId: string, terminal = false) {
    this.events?.publishServerEvent({
      type: "local.llm.chat.updated",
      payload: { chatId, terminal }
    });
  }

  flushRealtimeUpdate(chatId: string, active: ActiveLocalLlmGeneration, terminal = false) {
    if (active.realtimeUpdateTimer) {
      clearTimeout(active.realtimeUpdateTimer);
      active.realtimeUpdateTimer = null;
    }
    this.publishChatUpdated(chatId, terminal);
  }

  private scheduleCheckpoint(chatId: string, active: ActiveLocalLlmGeneration) {
    if (active.checkpointTimer || !active.text.trim()) return;
    const delay = Math.max(0, STREAM_CHECKPOINT_INTERVAL_MS - (Date.now() - active.lastCheckpointAt));
    active.checkpointTimer = setTimeout(() => {
      active.checkpointTimer = null;
      active.lastCheckpointAt = Date.now();
      const message: LocalLlmChatMessage = {
        id: active.assistantMessageId,
        role: "assistant",
        text: active.text,
        timestamp: new Date().toISOString(),
        status: "interrupted"
      };
      active.checkpointPromise = active.checkpointPromise
        .catch(() => undefined)
        .then(() => this.library.checkpointAssistant(chatId, message));
    }, delay);
  }

  private scheduleRealtimeUpdate(chatId: string, active: ActiveLocalLlmGeneration) {
    if (active.realtimeUpdateTimer) return;
    active.realtimeUpdateTimer = setTimeout(() => {
      active.realtimeUpdateTimer = null;
      this.publishChatUpdated(chatId);
    }, LOCAL_LLM_REALTIME_DELTA_UPDATE_MS);
  }
}
