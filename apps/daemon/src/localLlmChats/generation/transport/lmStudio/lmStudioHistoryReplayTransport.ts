import { readSse } from "../streamReader.ts";
import type {
  LocalLlmAgentMessage,
  LocalLlmAgentStreamEvent,
  LocalLlmAgentToolDefinition,
  LocalLlmCompletedToolCall,
  LocalLlmFetch
} from "../types.ts";
import {
  asRecord,
  parseToolArguments,
  stringValue,
  toToolCallWire,
  trimEndpoint
} from "../wireValues.ts";

export const MAX_LM_STUDIO_TOOL_CALLS = 16;
export const MAX_LM_STUDIO_TOOL_ARGUMENT_BYTES = 256 * 1024;
export const MAX_LM_STUDIO_TOTAL_TOOL_ARGUMENT_BYTES = 512 * 1024;

type PendingLmStudioToolCall = {
  argumentBytes: number;
  argumentsText: string;
  id: string;
  name: string;
};

/** Accumulates OpenAI-compatible `choices[].delta.tool_calls` fragments. */
export class LmStudioToolCallAccumulator {
  private readonly calls = new Map<number, PendingLmStudioToolCall>();
  private totalArgumentBytes = 0;

  push(payload: unknown): LocalLlmAgentStreamEvent[] {
    const choices = asRecord(payload)?.choices;
    const firstChoice = Array.isArray(choices) ? asRecord(choices[0]) : null;
    const delta = asRecord(firstChoice?.delta);
    if (!delta) return [];
    const events: LocalLlmAgentStreamEvent[] = [];
    const content = stringValue(delta.content);
    if (content) events.push({ type: "assistant_text_delta", text: content });
    const toolCalls = delta.tool_calls;
    if (!Array.isArray(toolCalls)) return events;
    for (const rawCall of toolCalls) {
      const call = asRecord(rawCall);
      const index = typeof call?.index === "number" ? call.index : 0;
      if (!Number.isSafeInteger(index) || index < 0 || index >= MAX_LM_STUDIO_TOOL_CALLS) {
        throw new Error("LM Studio returned too many concurrent tool calls.");
      }
      const existing = this.calls.get(index) ?? {
        argumentBytes: 0,
        argumentsText: "",
        id: "",
        name: ""
      };
      const functionCall = asRecord(call?.function);
      existing.id = stringValue(call?.id) ?? existing.id;
      existing.name = stringValue(functionCall?.name) ?? existing.name;
      const argumentFragment = stringValue(functionCall?.arguments) ?? "";
      const fragmentBytes = Buffer.byteLength(argumentFragment, "utf8");
      if (
        existing.argumentBytes + fragmentBytes > MAX_LM_STUDIO_TOOL_ARGUMENT_BYTES ||
        this.totalArgumentBytes + fragmentBytes > MAX_LM_STUDIO_TOTAL_TOOL_ARGUMENT_BYTES
      ) {
        throw new Error("LM Studio tool arguments exceed the safety limit.");
      }
      existing.argumentsText += argumentFragment;
      existing.argumentBytes += fragmentBytes;
      this.totalArgumentBytes += fragmentBytes;
      this.calls.set(index, existing);
    }
    return events;
  }

  complete(): LocalLlmCompletedToolCall[] {
    const completed: LocalLlmCompletedToolCall[] = [];
    for (const [index, call] of this.calls) {
      const parsed = parseToolArguments(call.argumentsText);
      if (!call.name || !parsed) throw new Error(`LM Studio returned an incomplete tool call at index ${index}.`);
      completed.push({
        arguments: parsed.arguments,
        argumentsText: parsed.argumentsText,
        id: call.id || `lm-studio-call-${index}`,
        name: call.name
      });
    }
    this.calls.clear();
    this.totalArgumentBytes = 0;
    return completed;
  }
}

function toOpenAiMessage(message: LocalLlmAgentMessage) {
  if (message.role === "tool") return { role: "tool", content: message.content, tool_call_id: message.toolCallId };
  return {
    role: message.role,
    content: message.content,
    ...(message.role === "assistant" && message.toolCalls?.length
      ? { tool_calls: message.toolCalls.map(toToolCallWire) }
      : {})
  };
}

/**
 * LM Studio turns use OpenAI-compatible history replay. Native `/api/v1/chat`
 * response ids cannot represent tool-result turns in DeskCue's durable ledger.
 */
export async function streamLmStudioHistoryReplayChat(input: {
  endpoint: string;
  fetch: LocalLlmFetch;
  messages: readonly LocalLlmAgentMessage[];
  model: string;
  onEvent: (event: LocalLlmAgentStreamEvent) => void;
  signal?: AbortSignal;
  tools?: readonly LocalLlmAgentToolDefinition[];
}) {
  const response = await input.fetch(`${trimEndpoint(input.endpoint)}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages.map(toOpenAiMessage),
      ...(input.tools ? {
        tools: input.tools,
        tool_choice: input.tools.length > 0 ? "auto" : undefined
      } : {}),
      stream: true
    }),
    signal: input.signal
  });
  const accumulator = new LmStudioToolCallAccumulator();
  await readSse(response, input.signal, (payload) => {
    for (const event of accumulator.push(payload)) input.onEvent(event);
  });
  for (const toolCall of accumulator.complete()) {
    input.onEvent({ type: "tool_call", toolCall });
  }
}

export const streamLmStudioHistoryReplayAgentChat = streamLmStudioHistoryReplayChat;
