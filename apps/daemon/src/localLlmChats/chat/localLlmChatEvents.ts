import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";

import type { LocalLlmChatEvent, LocalLlmChatEventType } from "@deskcue/protocol";

export const LOCAL_LLM_CHAT_EVENTS_FILE = "events.jsonl";

export type { LocalLlmChatEvent, LocalLlmChatEventType };

/**
 * DeskCue-owned lifecycle record for a local-model turn.
 *
 * These records describe transport, persistence, and explicitly exposed local
 * model reasoning. DeskCue never reconstructs hidden reasoning on its own.
 */
export type LocalLlmActiveTurn = {
  assistantMessageId: string;
  startedAt: string;
  turnId: string;
  userMessageId: string;
};

export function isTerminalEvent(event: Pick<LocalLlmChatEvent, "type">) {
  return (
    event.type === "turn_completed" ||
    event.type === "turn_failed" ||
    event.type === "turn_interrupted" ||
    event.type === "turn_interrupted_after_restart"
  );
}

export function isLocalLlmChatEvent(value: unknown): value is LocalLlmChatEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<LocalLlmChatEvent>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.turnId === "string" &&
    typeof candidate.timestamp === "string" &&
    (candidate.type === "turn_started" ||
      candidate.type === "assistant_message_saved" ||
      candidate.type === "turn_completed" ||
      candidate.type === "turn_failed" ||
      candidate.type === "turn_interrupted" ||
      candidate.type === "turn_interrupted_after_restart" ||
      candidate.type === "model_reasoning_saved" ||
      candidate.type === "tool_requested" ||
      candidate.type === "tool_completed" ||
      candidate.type === "tool_failed" ||
      candidate.type === "action_requested" ||
      candidate.type === "action_resolved") &&
    (candidate.messageId === undefined || typeof candidate.messageId === "string") &&
    (candidate.error === undefined || typeof candidate.error === "string") &&
    (candidate.toolCallId === undefined || typeof candidate.toolCallId === "string") &&
    (candidate.toolName === undefined || typeof candidate.toolName === "string") &&
    (candidate.summary === undefined || typeof candidate.summary === "string")
  );
}

export class LocalLlmChatEventLedger {
  constructor(private readonly chatPath: string) {}

  async append(event: LocalLlmChatEvent) {
    await appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
  }

  async read(): Promise<LocalLlmChatEvent[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return raw
        .split(/\r?\n/)
        .filter(Boolean)
        .flatMap((line) => {
          try {
            const parsed = JSON.parse(line) as unknown;
            return isLocalLlmChatEvent(parsed) ? [parsed] : [];
          } catch {
            return [];
          }
        });
    } catch {
      return [];
    }
  }

  async hasTerminalEvent(turnId: string) {
    return (await this.read()).some((event) => event.turnId === turnId && isTerminalEvent(event));
  }

  private get filePath() {
    return path.join(this.chatPath, LOCAL_LLM_CHAT_EVENTS_FILE);
  }
}
