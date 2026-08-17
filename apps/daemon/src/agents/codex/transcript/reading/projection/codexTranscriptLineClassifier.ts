import {
  isContextCompactedLine,
  isCodexChatMessageLine,
  isCodexTurnLifecycleLine,
  isTurnContextLine
} from "../../parsing/codexTranscript.ts";
import { CODEX_TRANSCRIPT_INDEXED_LINE_HINT_BYTES } from "../codexTranscriptReadLimits.ts";
import type { IndexedTranscriptActivityKind } from "../index/codexTranscriptLineIndex.ts";

export type CodexTranscriptLineTypeHint = {
  itemType: string | null;
  payloadPhase: string | null;
  payloadRole: string | null;
  payloadType: string | null;
  timestamp: string;
};

export function shouldKeepIndexedTranscriptLineExact(
  line: string,
  typeHint: CodexTranscriptLineTypeHint
) {
  if (
    typeHint.itemType === "turn_context" || typeHint.itemType === "compacted" ||
    typeHint.payloadType === "compacted" || typeHint.payloadType === "task_started" ||
    typeHint.payloadType === "task_complete" || typeHint.payloadType === "turn_aborted"
  ) return true;

  if (typeHint.itemType === "event_msg" && typeHint.payloadType === "user_message") return true;
  if (
    typeHint.itemType === "response_item" && typeHint.payloadType === "message" &&
    (typeHint.payloadRole === "user" || typeHint.payloadRole === "assistant")
  ) return true;
  if (typeHint.itemType || typeHint.payloadType) return false;

  return isContextCompactedLine(line) || isTurnContextLine(line) ||
    isCodexTurnLifecycleLine(line) || isCodexChatMessageLine(line);
}

export function classifyIndexedTranscriptActivityLine(
  typeHint: CodexTranscriptLineTypeHint
): IndexedTranscriptActivityKind | null {
  if (typeHint.itemType !== "event_msg" && typeHint.itemType !== "response_item") return null;
  if (typeHint.payloadType === "patch_apply_end") return "changes";
  if ([
    "function_call", "custom_tool_call", "function_call_output", "custom_tool_call_output",
    "web_search_call", "web_search_end", "mcp_tool_call_end"
  ].includes(typeHint.payloadType ?? "")) return "tools";

  return typeHint.itemType === "response_item" && typeHint.payloadType === "message" &&
    typeHint.payloadRole === "assistant" && typeHint.payloadPhase === "commentary"
    ? "details"
    : null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hasJsonStringProperty(source: string, key: string, value: string) {
  return new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"${escapeRegExp(value)}"`).test(source);
}

function readJsonStringProperty(source: string, key: string) {
  return new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"([^"]*)"`).exec(source)?.[1] ?? null;
}

function readJsonObjectStringProperty(source: string, objectKey: string, key: string) {
  return new RegExp(
    `"${escapeRegExp(objectKey)}"\\s*:\\s*\\{([\\s\\S]*?)"${escapeRegExp(key)}"\\s*:\\s*"([^"]*)"`
  ).exec(source)?.[2] ?? null;
}

export function readCodexTranscriptLineTypeHint(line: string): CodexTranscriptLineTypeHint {
  const prefix = line.slice(0, CODEX_TRANSCRIPT_INDEXED_LINE_HINT_BYTES);
  return {
    itemType: readJsonStringProperty(prefix, "type"),
    payloadPhase: readJsonObjectStringProperty(prefix, "payload", "phase"),
    payloadRole: readJsonObjectStringProperty(prefix, "payload", "role"),
    payloadType: readJsonObjectStringProperty(prefix, "payload", "type"),
    timestamp: readJsonStringProperty(prefix, "timestamp") ?? new Date(0).toISOString()
  };
}
