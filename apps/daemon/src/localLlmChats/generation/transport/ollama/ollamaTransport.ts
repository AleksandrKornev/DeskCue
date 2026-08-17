import { readJsonLines } from "../streamReader.ts";
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
  trimEndpoint
} from "../wireValues.ts";

export function parseOllamaToolCalls(payload: unknown): LocalLlmCompletedToolCall[] {
  const calls = asRecord(asRecord(payload)?.message)?.tool_calls;
  if (!Array.isArray(calls)) return [];
  return calls.flatMap((call, index) => {
    const functionCall = asRecord(asRecord(call)?.function);
    const name = stringValue(functionCall?.name);
    const parsed = parseToolArguments(functionCall?.arguments);
    if (!name || !parsed) return [];
    return [{
      arguments: parsed.arguments,
      argumentsText: parsed.argumentsText,
      id: stringValue(asRecord(call)?.id) ?? `ollama-call-${index}`,
      name
    }];
  });
}

function toOllamaMessage(message: LocalLlmAgentMessage) {
  if (message.role === "tool") return { role: "tool", content: message.content };
  return {
    role: message.role,
    content: message.content,
    ...(message.role === "assistant" && message.toolCalls?.length
      ? {
        // Ollama expects arguments as an object, unlike OpenAI's JSON string.
        tool_calls: message.toolCalls.map((toolCall) => ({
          function: { name: toolCall.name, arguments: toolCall.arguments }
        }))
      }
      : {})
  };
}

export async function streamOllamaChat(input: {
  endpoint: string;
  fetch: LocalLlmFetch;
  messages: readonly LocalLlmAgentMessage[];
  model: string;
  onEvent: (event: LocalLlmAgentStreamEvent) => void;
  signal?: AbortSignal;
  tools?: readonly LocalLlmAgentToolDefinition[];
}) {
  const response = await input.fetch(`${trimEndpoint(input.endpoint)}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages.map(toOllamaMessage),
      ...(input.tools ? { tools: input.tools } : {}),
      stream: true
    }),
    signal: input.signal
  });
  await readJsonLines(response, input.signal, (payload) => {
    const message = asRecord(asRecord(payload)?.message);
    const reasoning = stringValue(message?.thinking);
    if (reasoning) input.onEvent({ type: "assistant_reasoning_delta", text: reasoning });
    const content = stringValue(message?.content);
    if (content) input.onEvent({ type: "assistant_text_delta", text: content });
    for (const toolCall of parseOllamaToolCalls(payload)) {
      input.onEvent({ type: "tool_call", toolCall });
    }
  });
}

export const streamOllamaAgentChat = streamOllamaChat;
