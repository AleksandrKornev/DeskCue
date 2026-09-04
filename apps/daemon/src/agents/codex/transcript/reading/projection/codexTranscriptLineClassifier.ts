import {
  isContextCompactedLine,
  isCodexChatMessageLine,
  isCodexTurnLifecycleLine,
  isTurnContextLine
} from "../../parsing/codexTranscript.ts";
import type { IndexedTranscriptActivityKind } from "../index/codexTranscriptLineIndex.ts";

export type CodexTranscriptLineTypeHint = {
  itemType: string | null;
  payloadItemType: string | null;
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

  if (
    typeHint.itemType === "event_msg" &&
    (
      typeHint.payloadType === "patch_apply_end" ||
      (
        typeHint.payloadType === "item_completed" &&
        typeHint.payloadItemType === "FileChange"
      )
    )
  ) return "changes";
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

function skipJsonWhitespace(source: string, start: number) {
  let cursor = start;

  while (/\s/.test(source[cursor] ?? "")) cursor += 1;

  return cursor;
}

function readJsonString(source: string, start: number) {
  if (source[start] !== "\"") return null;

  for (let cursor = start + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === "\\") {
      cursor += 1;
      continue;
    }

    if (source[cursor] !== "\"") continue;

    try {
      return {
        end: cursor + 1,
        value: JSON.parse(source.slice(start, cursor + 1)) as string
      };
    } catch {
      return null;
    }
  }

  return null;
}

function skipJsonValue(source: string, start: number) {
  const valueStart = skipJsonWhitespace(source, start);
  const first = source[valueStart];

  if (first === "\"") return readJsonString(source, valueStart)?.end ?? null;

  if (first === "{" || first === "[") {
    const closing = first === "{" ? "}" : "]";
    let depth = 1;

    for (let cursor = valueStart + 1; cursor < source.length; cursor += 1) {
      if (source[cursor] === "\"") {
        const stringValue = readJsonString(source, cursor);

        if (!stringValue) return null;

        cursor = stringValue.end - 1;
        continue;
      }

      if (source[cursor] === first) depth += 1;
      if (source[cursor] === closing) depth -= 1;
      if (depth === 0) return cursor + 1;
    }

    return null;
  }

  for (let cursor = valueStart; cursor < source.length; cursor += 1) {
    if (source[cursor] === "," || source[cursor] === "}" || source[cursor] === "]") {
      return cursor;
    }
  }

  return null;
}

type DirectJsonObjectProperty = {
  start: number;
  stringValue: string | null;
};

const ROOT_PROPERTY_KEYS = new Set(["payload", "timestamp", "type"]);
const PAYLOAD_PROPERTY_KEYS = new Set(["item", "phase", "role", "type"]);
const ITEM_PROPERTY_KEYS = new Set(["type"]);
const EMPTY_DIRECT_JSON_OBJECT_PROPERTIES = new Map<string, DirectJsonObjectProperty>();

function readDirectJsonObjectProperties(
  source: string,
  objectStart: number,
  requestedKeys: ReadonlySet<string>
) {
  const properties = new Map<string, DirectJsonObjectProperty>();

  if (source[objectStart] !== "{") return properties;

  let cursor = objectStart + 1;

  while (cursor < source.length) {
    cursor = skipJsonWhitespace(source, cursor);
    if (source[cursor] === "}") return properties;

    const property = readJsonString(source, cursor);

    if (!property) return properties;

    cursor = skipJsonWhitespace(source, property.end);
    if (source[cursor] !== ":") return properties;

    const valueStart = skipJsonWhitespace(source, cursor + 1);

    if (requestedKeys.has(property.value)) {
      properties.set(property.value, {
        start: valueStart,
        stringValue: readJsonString(source, valueStart)?.value ?? null
      });
    }

    const valueEnd = skipJsonValue(source, valueStart);

    if (valueEnd === null) return properties;

    cursor = skipJsonWhitespace(source, valueEnd);
    if (source[cursor] === ",") {
      cursor += 1;
      continue;
    }

    if (source[cursor] === "}") return properties;

    return properties;
  }

  return properties;
}

function readTranscriptLineShape(source: string) {
  const rootStart = source.indexOf("{");
  const root = readDirectJsonObjectProperties(
    source,
    rootStart,
    ROOT_PROPERTY_KEYS
  );
  const itemType = root.get("type")?.stringValue ?? null;
  const timestamp = root.get("timestamp")?.stringValue ?? null;
  const payloadStart = root.get("payload")?.start ?? null;

  if (payloadStart === null) {
    return {
      itemType,
      payloadItemType: null,
      payloadPhase: null,
      payloadRole: null,
      payloadType: null,
      timestamp
    };
  }

  const payload = readDirectJsonObjectProperties(
    source,
    payloadStart,
    PAYLOAD_PROPERTY_KEYS
  );
  const itemStart = payload.get("item")?.start ?? null;
  const item = itemStart === null
    ? EMPTY_DIRECT_JSON_OBJECT_PROPERTIES
    : readDirectJsonObjectProperties(source, itemStart, ITEM_PROPERTY_KEYS);

  return {
    itemType,
    payloadItemType: item.get("type")?.stringValue ?? null,
    payloadPhase: payload.get("phase")?.stringValue ?? null,
    payloadRole: payload.get("role")?.stringValue ?? null,
    payloadType: payload.get("type")?.stringValue ?? null,
    timestamp
  };
}

export function readCodexTranscriptLineTypeHint(line: string): CodexTranscriptLineTypeHint {
  const shape = readTranscriptLineShape(line);

  return {
    ...shape,
    timestamp: shape.timestamp ?? new Date(0).toISOString()
  };
}
