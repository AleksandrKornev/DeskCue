import { createReadStream } from "node:fs";
import { createInterface } from "node:readline/promises";

import type { AgentTranscriptEntry, TranscriptPart } from "@deskcue/protocol";

import {
  hasRequestedClaudeTranscriptTail,
  isPositiveClaudeTranscriptLimit,
  trimClaudeTranscript
} from "./claudeTranscriptProjection.ts";
import type { ClaudeTranscriptTailOptions } from "./claudeTranscriptProjection.ts";
import { readClaudeTranscriptTailLines } from "./claudeTranscriptReader.ts";
import type { ClaudeTranscriptLine } from "./claudeTranscriptReader.ts";

type ClaudeTranscriptContext = {
  toolNamesById: Map<string, string>;
};

type ToolCallPart = Extract<TranscriptPart, { type: "tool_call" }>;
type ToolResultPart = Extract<TranscriptPart, { type: "tool_result" }>;

const CLAUDE_NON_FINAL_ASSISTANT_PHASE = "non_final";

function buildTranscriptEntryId(
  sessionId: string,
  index: number | string,
  suffix?: string
) {
  return `${sessionId}-${index}${suffix ? `-${suffix}` : ""}`;
}

function findRole(value: unknown): AgentTranscriptEntry["role"] | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const role = typeof record.role === "string" ? record.role : null;
  const type = typeof record.type === "string" ? record.type : null;

  if (role === "user") return "user";

  if (role === "assistant") return "assistant";

  if (role === "tool") return "tool";

  if (type === "result" || type === "system") return "system";

  for (const nested of Object.values(record)) {
    const nestedRole = findRole(nested);
    if (nestedRole) return nestedRole;
  }

  return null;
}

function buildMarkdownTranscriptEntry(
  sessionId: string,
  index: number | string,
  timestamp: string,
  role: AgentTranscriptEntry["role"],
  text: string,
  options: { phase?: string | null; suffix?: string } = {}
) {
  return {
    id: buildTranscriptEntryId(sessionId, index, options.suffix),
    timestamp,
    role,
    text,
    phase: options.phase ?? null,
    parts: [
      {
        type: "markdown",
        text
      }
    ]
  } satisfies AgentTranscriptEntry;
}

function buildTranscriptEntry(
  sessionId: string,
  index: number | string,
  timestamp: string,
  role: AgentTranscriptEntry["role"],
  parts: TranscriptPart[],
  suffix?: string
) {
  const text = parts
    .map((part) => {
      if (part.type === "tool_call") return part.namespace ? `${part.namespace}.${part.toolName}` : part.toolName;

      if (part.type === "tool_result") return part.text;

      if (part.type === "markdown") return part.text;

      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();

  return {
    id: buildTranscriptEntryId(sessionId, index, suffix),
    timestamp,
    role,
    text,
    phase: null,
    parts
  } satisfies AgentTranscriptEntry;
}

function buildTurnCompletedEntry(
  sessionId: string,
  index: number | string,
  timestamp: string
) {
  return {
    id: buildTranscriptEntryId(sessionId, index, "turn-completed"),
    timestamp,
    role: "system",
    text: "Turn completed",
    phase: null,
    parts: [{ type: "status", label: "Turn completed", detail: null }]
  } satisfies AgentTranscriptEntry;
}

function readContentBlocks(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  }

  return [];
}

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function extractVisibleContentBlockText(blocks: Record<string, unknown>[]) {
  return blocks
    .filter((block) => readString(block.type) === "text")
    .map((block) => readString(block.text) ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : false;
}

function formatToolArguments(value: unknown) {
  if (value === null || typeof value === "undefined") return null;

  if (typeof value === "string") return value;

  return JSON.stringify(value, null, 2);
}

function toToolCallPart(
  block: Record<string, unknown>,
  context: ClaudeTranscriptContext
): ToolCallPart | null {
  if (readString(block.type) !== "tool_use") return null;

  const toolName = readString(block.name) ?? "tool";
  const toolUseId = readString(block.id);
  if (toolUseId) context.toolNamesById.set(toolUseId, toolName);

  return {
    type: "tool_call",
    toolName,
    namespace: null,
    argumentsText: formatToolArguments(block.input)
  } satisfies TranscriptPart;
}

function isMetadataTextField(fieldName: string) {
  return fieldName === "type" ||
    fieldName === "id" ||
    fieldName === "role" ||
    fieldName === "thinking" ||
    fieldName === "signature" ||
    fieldName === "tool_use_id" ||
    fieldName === "uuid" ||
    fieldName === "parentUuid" ||
    fieldName === "sessionId" ||
    fieldName === "version" ||
    fieldName === "timestamp" ||
    fieldName === "created_at" ||
    fieldName === "requestId";
}

function extractText(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => extractText(item))
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const directFields = ["text", "content", "message", "result", "summary"];
    for (const field of directFields) {
      const fieldValue = record[field];
      const text = extractText(fieldValue);
      if (text) return text;
    }

    for (const [field, nested] of Object.entries(record)) {
      if (isMetadataTextField(field)) continue;

      const text = extractText(nested);
      if (text) return text;
    }
  }

  return "";
}

export function firstTranscriptText(items: Record<string, unknown>[], wantedRole: "user" | "assistant") {
  for (const item of items) {
    if (item.isMeta === true) continue;
    if (findRole(item) === wantedRole) {
      const text = extractText(item);
      if (text) return text.slice(0, 120);
    }
  }

  return null;
}

function toToolResultPart(
  block: Record<string, unknown>,
  context: ClaudeTranscriptContext
): ToolResultPart | null {
  if (readString(block.type) !== "tool_result") return null;

  const toolUseId = readString(block.tool_use_id);
  const toolName = toolUseId ? context.toolNamesById.get(toolUseId) ?? null : null;
  const resultContent = extractText(block.content);

  return {
    type: "tool_result",
    toolName,
    status: readBoolean(block.is_error) ? "failed" : "completed",
    text: resultContent || "(empty tool result)"
  } satisfies TranscriptPart;
}

function toContentBlockEntries(
  blocks: Record<string, unknown>[],
  sessionId: string,
  index: number | string,
  timestamp: string,
  context: ClaudeTranscriptContext,
  stopReason: string | null
): AgentTranscriptEntry[] {
  if (blocks.length === 0) return [];

  const toolCallParts = blocks.flatMap((block) => {
    const part = toToolCallPart(block, context);
    return part ? [part] : [];
  });
  const toolResultParts = blocks.flatMap((block) => {
    const part = toToolResultPart(block, context);
    return part ? [part] : [];
  });

  if (toolCallParts.length > 0 && toolCallParts.length === blocks.length) {
    return [buildTranscriptEntry(sessionId, index, timestamp, "tool", toolCallParts)];
  }

  if (toolResultParts.length > 0 && toolResultParts.length === blocks.length) {
    return [buildTranscriptEntry(sessionId, index, timestamp, "tool", toolResultParts)];
  }

  const thinkingText = blocks
    .map((block) => readString(block.thinking))
    .filter(Boolean)
    .join("\n")
    .trim();
  if (thinkingText && blocks.every((block) => readString(block.type) === "thinking")) {
    return [{
      ...buildMarkdownTranscriptEntry(sessionId, index, timestamp, "commentary", thinkingText),
      phase: "thinking"
    } satisfies AgentTranscriptEntry];
  }

  if (toolCallParts.length > 0) {
    const entries: AgentTranscriptEntry[] = [];
    const visibleText = extractVisibleContentBlockText(blocks);
    if (visibleText) {
      entries.push(buildMarkdownTranscriptEntry(
        sessionId,
        index,
        timestamp,
        "assistant",
        visibleText,
        {
          phase: stopReason === "tool_use" ? CLAUDE_NON_FINAL_ASSISTANT_PHASE : null,
          suffix: "text"
        }
      ));
    }
    entries.push(buildTranscriptEntry(
      sessionId,
      index,
      timestamp,
      "tool",
      toolCallParts,
      "tool"
    ));
    return entries;
  }

  return [];
}

function findNestedString(value: unknown, fieldName: string): string | null {
  if (!value || typeof value !== "object") return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findNestedString(item, fieldName);
      if (nested) return nested;
    }

    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record[fieldName] === "string" && record[fieldName].trim()) return record[fieldName].trim();

  for (const nested of Object.values(record)) {
    const result = findNestedString(nested, fieldName);
    if (result) return result;
  }

  return null;
}

export function findStringField(items: Record<string, unknown>[], fieldNames: string[]) {
  for (const item of items) {
    for (const field of fieldNames) {
      const value = findNestedString(item, field);
      if (value) return value;
    }
  }

  return null;
}

export function normalizeTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function toTranscriptEntries(
  item: Record<string, unknown> | null,
  sessionId: string,
  index: number | string,
  context: ClaudeTranscriptContext
): AgentTranscriptEntry[] {
  if (!item) return [];

  // Claude CLI injects resume bookkeeping as a synthetic user turn with
  // `isMeta: true` before it dequeues the real `--print` prompt. It belongs to
  // the native transport lifecycle and must not be projected as user input.
  if (item.isMeta === true) return [];

  const timestamp = normalizeTimestamp(findStringField([item], ["timestamp", "created_at"]) ?? new Date().toISOString());
  const message = readRecord(item.message);
  const stopReason = readString(message?.stop_reason);
  const content = message?.content ?? item.content;
  const contentBlocks = readContentBlocks(content);
  const blockEntries = toContentBlockEntries(
    contentBlocks,
    sessionId,
    index,
    timestamp,
    context,
    stopReason
  );
  if (blockEntries.length > 0) return blockEntries;

  const role = findRole(item);
  const text = contentBlocks.length > 0
    ? extractVisibleContentBlockText(contentBlocks)
    : extractText(item);
  if (!role || !text) return [];

  // Claude CLI writes this synthetic acknowledgement into the JSONL stream
  // when no assistant reply was requested. It is transport metadata, not a
  // user-visible assistant response.
  if (role === "assistant" && text === "No response requested.") {
    return stopReason === "end_turn"
      ? [buildTurnCompletedEntry(sessionId, index, timestamp)]
      : [];
  }

  const entry = buildMarkdownTranscriptEntry(
    sessionId,
    index,
    timestamp,
    role,
    text,
    {
      phase: role === "assistant" && stopReason === "tool_use"
        ? CLAUDE_NON_FINAL_ASSISTANT_PHASE
        : null
    }
  );

  return role === "assistant" && stopReason === "end_turn"
    ? [entry, buildTurnCompletedEntry(sessionId, index, timestamp)]
    : [entry];
}

export function safeParseJson<T>(value: string) {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function parseClaudeTranscriptLines(lines: ClaudeTranscriptLine[], sessionId: string) {
  const transcript: AgentTranscriptEntry[] = [];
  const context: ClaudeTranscriptContext = {
    toolNamesById: new Map()
  };

  lines.forEach(({ index, line }) => {
    const item = safeParseJson<Record<string, unknown>>(line.trim());
    transcript.push(...toTranscriptEntries(item, sessionId, index, context));
  });

  return transcript;
}

export async function parseClaudeTranscript(
  filePath: string,
  sessionId: string,
  options: ClaudeTranscriptTailOptions = {}
) {
  if (
    isPositiveClaudeTranscriptLimit(options.chatMessageTail) ||
    isPositiveClaudeTranscriptLimit(options.transcriptTail)
  ) {
    const lines = await readClaudeTranscriptTailLines(
      filePath,
      (candidateLines) => hasRequestedClaudeTranscriptTail(
        parseClaudeTranscriptLines(candidateLines, sessionId),
        options
      )
    );
    return trimClaudeTranscript(parseClaudeTranscriptLines(lines, sessionId), options);
  }

  const lines = createInterface({
    crlfDelay: Infinity,
    input: createReadStream(filePath, { encoding: "utf8" })
  });
  const context: ClaudeTranscriptContext = { toolNamesById: new Map() };
  const transcript: AgentTranscriptEntry[] = [];
  let index = 0;
  try {
    for await (const line of lines) {
      if (line.trim()) {
        const item = safeParseJson<Record<string, unknown>>(line.trim());
        transcript.push(...toTranscriptEntries(item, sessionId, index, context));
      }
      index += 1;
    }
  } finally {
    lines.close();
  }
  return transcript;
}
