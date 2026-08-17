import { tryParseJson } from "./streamReader.ts";
import type { LocalLlmCompletedToolCall } from "./types.ts";

export function parseToolArguments(value: unknown) {
  const argumentsText = typeof value === "string" ? value : JSON.stringify(value ?? {});
  const parsed = tryParseJson(argumentsText);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? { arguments: parsed as Record<string, unknown>, argumentsText }
    : null;
}

export function toToolCallWire(toolCall: LocalLlmCompletedToolCall) {
  return {
    id: toolCall.id,
    type: "function",
    function: { name: toolCall.name, arguments: toolCall.argumentsText }
  };
}

export function readStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : null;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

export function trimEndpoint(endpoint: string) {
  return endpoint.replace(/\/+$/, "");
}
