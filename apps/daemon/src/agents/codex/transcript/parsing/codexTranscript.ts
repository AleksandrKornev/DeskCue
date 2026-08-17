import type { CodexTranscriptEntry } from "@deskcue/protocol";

import { dedupeCodexTranscriptEntries } from "./codexTranscriptDedupe.ts";
import { isRecord, safeParseJson } from "./codexTranscriptShared.ts";
import { toCodexTranscriptEntry } from "./entries/codexTranscriptEntry.ts";
import { createCodexTranscriptEntry } from "./entries/codexTranscriptEntryFactory.ts";

const RECENT_CHAT_MESSAGE_LINE_FLOOR = 240;
const CHAT_MESSAGE_TAIL_RAW_LINE_MULTIPLIER = 4;

export function isContextCompactedLine(line: string) {
  if (line.includes('"context_compacted"')) {
    return true;
  }

  if (!line.includes('"compacted"')) {
    return false;
  }

  const item = safeParseJson<Record<string, unknown>>(line);
  if (!item || typeof item.type !== "string") {
    return false;
  }

  const payload = isRecord(item.payload) ? item.payload : null;

  return item.type === "compacted" || (item.type === "response_item" && payload?.type === "compacted");
}

export function isCodexChatMessageLine(line: string) {
  if (
    !line.includes('"user_message"') &&
    !line.includes('"type":"message"') &&
    !line.includes('"type": "message"')
  ) {
    return false;
  }

  const item = safeParseJson<Record<string, unknown>>(line);
  if (!item || typeof item.type !== "string") {
    return false;
  }

  const payload = isRecord(item.payload) ? item.payload : null;

  if (item.type === "event_msg" && payload?.type === "user_message") {
    return true;
  }

  if (item.type !== "response_item" || payload?.type !== "message") {
    return false;
  }

  if (payload.role === "user") {
    return true;
  }

  return payload.role === "assistant" && payload.phase !== "commentary";
}

export function countCodexChatMessageLines(raw: string) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(isCodexChatMessageLine).length;
}

export function isCodexTurnLifecycleLine(line: string) {
  if (
    !line.includes('"turn_context"') &&
    !line.includes('"task_started"') &&
    !line.includes('"task_complete"') &&
    !line.includes('"turn_aborted"')
  ) {
    return false;
  }

  const item = safeParseJson<Record<string, unknown>>(line);
  if (!item) {
    return false;
  }

  if (item.type === "turn_context") {
    return true;
  }

  if (item.type !== "event_msg") {
    return false;
  }

  const payload = isRecord(item.payload) ? item.payload : null;
  return (
    payload?.type === "task_started" ||
    payload?.type === "task_complete" ||
    payload?.type === "turn_aborted"
  );
}

export function isTurnContextLine(line: string) {
  if (!line.includes('"turn_context"')) {
    return false;
  }

  const item = safeParseJson<Record<string, unknown>>(line);
  return item?.type === "turn_context";
}

function capitalize(value: string) {
  return value.length > 0 ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function formatCodexModelLabel(model: string) {
  const parts = model.split("-").filter(Boolean);
  if (parts.length >= 2 && /^gpt$/i.test(parts[0])) {
    const [family, version, ...suffix] = parts;
    return [
      `${family.toUpperCase()}-${version}`,
      ...suffix.map(capitalize)
    ].join(" ");
  }

  return parts.map(capitalize).join(" ");
}

function toTurnContextModelChangeEntry(
  item: Record<string, unknown> | null,
  sessionId: string,
  index: number,
  previousModel: string | null
) {
  const payload = isRecord(item?.payload) ? item.payload : null;
  const modelValue = payload?.model ?? item?.model;

  if (!item || item.type !== "turn_context" || typeof modelValue !== "string") {
    return {
      entry: null,
      nextModel: null
    };
  }

  const nextModel = modelValue.trim();
  if (!nextModel || previousModel === null || previousModel === nextModel) {
    return {
      entry: null,
      nextModel
    };
  }

  const timestamp = typeof item.timestamp === "string" ? item.timestamp : new Date(0).toISOString();
  const previousLabel = formatCodexModelLabel(previousModel);
  const nextLabel = formatCodexModelLabel(nextModel);

  return {
    entry: createCodexTranscriptEntry(
      sessionId,
      index,
      timestamp,
      "system",
      `Model changed to ${nextLabel}`,
      "model_changed",
      [
        {
          type: "status",
          label: "Model changed",
          detail: `${previousLabel} -> ${nextLabel}`
        }
      ]
    ),
    nextModel
  };
}

function parseTranscriptLines(
  lines: Array<{ index: number; line: string }>,
  sessionId: string
) {
  const transcript: CodexTranscriptEntry[] = [];
  let previousTurnContextModel: string | null = null;

  for (const { index, line } of lines) {
    const item = safeParseJson<Record<string, unknown>>(line);
    const modelChangeEntry = toTurnContextModelChangeEntry(
      item,
      sessionId,
      index,
      previousTurnContextModel
    );

    if (modelChangeEntry.nextModel) {
      previousTurnContextModel = modelChangeEntry.nextModel;
    }

    if (modelChangeEntry.entry) {
      transcript.push(modelChangeEntry.entry);
      continue;
    }

    const entry = toCodexTranscriptEntry(item, sessionId, index);
    if (entry) {
      transcript.push(entry);
    }
  }

  return dedupeCodexTranscriptEntries(transcript);
}

export function parseCodexTranscript(raw: string, sessionId: string) {
  return parseTranscriptLines(
    raw
      .split(/\r?\n/)
      .map((line, index) => ({ index, line: line.trim() }))
      .filter(({ line }) => Boolean(line)),
    sessionId
  );
}

export function parseCodexTranscriptTail(
  raw: string,
  sessionId: string,
  transcriptTail: number,
  lineIndexOffset = 0
) {
  const lines = raw
    .split(/\r?\n/)
    .map((line, index) => ({ index: index + lineIndexOffset, line: line.trim() }))
    .filter(({ line }) => Boolean(line));

  if (lines.length <= transcriptTail) {
    return parseTranscriptLines(lines, sessionId);
  }

  const tailStart = Math.max(0, lines.length - transcriptTail);
  const selectedLineIndexes = new Set<number>();
  for (let index = tailStart; index < lines.length; index += 1) {
    selectedLineIndexes.add(index);
  }

  let latestTurnLifecycleLineIndex: number | null = null;

  for (let index = 0; index < tailStart; index += 1) {
    const line = lines[index].line;
    if (isContextCompactedLine(line) || isTurnContextLine(line)) {
      selectedLineIndexes.add(index);
    }

    if (isCodexTurnLifecycleLine(line)) {
      latestTurnLifecycleLineIndex = index;
    }
  }

  if (latestTurnLifecycleLineIndex !== null) {
    selectedLineIndexes.add(latestTurnLifecycleLineIndex);
  }

  let retainedChatMessageLineCount = 0;
  for (
    let index = tailStart - 1;
    index >= 0 && retainedChatMessageLineCount < RECENT_CHAT_MESSAGE_LINE_FLOOR;
    index -= 1
  ) {
    if (isCodexChatMessageLine(lines[index].line)) {
      selectedLineIndexes.add(index);
      retainedChatMessageLineCount += 1;
    }
  }

  const selectedLines = Array.from(selectedLineIndexes)
    .sort((left, right) => left - right)
    .map((index) => lines[index]);

  return parseTranscriptLines(selectedLines, sessionId);
}

export function parseCodexTranscriptSelectedLines(
  lines: Array<{ index: number; line: string }>,
  sessionId: string
) {
  return parseTranscriptLines(
    lines
      .map(({ index, line }) => ({ index, line: line.trim() }))
      .filter(({ line }) => Boolean(line)),
    sessionId
  );
}

function isChatTranscriptEntry(entry: CodexTranscriptEntry) {
  return entry.role === "user" || entry.role === "assistant";
}

function isLifecycleTranscriptEntry(entry: CodexTranscriptEntry) {
  return entry.role === "system" && entry.parts?.some((part) => part.type === "status");
}

function readTranscriptEntryLineIndex(entry: CodexTranscriptEntry) {
  const separatorIndex = entry.id.lastIndexOf("-");
  if (separatorIndex < 0) {
    return null;
  }

  const parsed = Number(entry.id.slice(separatorIndex + 1));
  return Number.isInteger(parsed) ? parsed : null;
}

function isTranscriptEntryInVisibleWindow(
  entry: CodexTranscriptEntry,
  firstVisibleLineIndex: number | null,
  firstVisibleTime: number
) {
  const lineIndex = readTranscriptEntryLineIndex(entry);
  if (firstVisibleLineIndex !== null && lineIndex !== null && lineIndex >= firstVisibleLineIndex) {
    return true;
  }

  const entryTime = Date.parse(entry.timestamp);
  return Number.isFinite(entryTime) && Number.isFinite(firstVisibleTime) && entryTime >= firstVisibleTime;
}

function trimParsedTranscriptToChatMessageTail(
  entries: CodexTranscriptEntry[],
  chatMessageTail: number
) {
  const chatEntries = entries.filter(isChatTranscriptEntry);
  if (chatEntries.length <= chatMessageTail) {
    return entries;
  }

  const firstVisibleChatEntry = chatEntries[chatEntries.length - chatMessageTail];
  const firstVisibleLineIndex = readTranscriptEntryLineIndex(firstVisibleChatEntry);
  const firstVisibleTime = Date.parse(firstVisibleChatEntry.timestamp);

  return entries.filter((entry) => {
    if (entry.phase === "context_compacted" || isLifecycleTranscriptEntry(entry)) {
      return isTranscriptEntryInVisibleWindow(entry, firstVisibleLineIndex, firstVisibleTime);
    }

    const lineIndex = readTranscriptEntryLineIndex(entry);
    return firstVisibleLineIndex === null || lineIndex === null || lineIndex >= firstVisibleLineIndex;
  });
}

export function parseCodexTranscriptChatMessageLines(
  rawLines: Array<{ index: number; line: string }>,
  sessionId: string,
  chatMessageTail: number
) {
  const lines = rawLines
    .map(({ index, line }) => ({ index, line: line.trim() }))
    .filter(({ line }) => Boolean(line));

  if (lines.length === 0) {
    return [];
  }

  const chatMessageIndexes = lines
    .map(({ line }, index) => (isCodexChatMessageLine(line) ? index : -1))
    .filter((index) => index >= 0);

  if (chatMessageIndexes.length === 0) {
    return parseTranscriptLines(lines, sessionId);
  }

  const rawChatMessageLimit = chatMessageTail * CHAT_MESSAGE_TAIL_RAW_LINE_MULTIPLIER;
  const startMessagePosition = Math.max(0, chatMessageIndexes.length - rawChatMessageLimit);
  const windowStart = chatMessageIndexes[startMessagePosition];
  const selectedLineIndexes = new Set<number>();

  for (let index = windowStart; index < lines.length; index += 1) {
    selectedLineIndexes.add(index);
  }

  let latestTurnLifecycleLineIndex: number | null = null;
  for (let index = 0; index < windowStart; index += 1) {
    const line = lines[index].line;
    if (isContextCompactedLine(line) || isTurnContextLine(line)) {
      selectedLineIndexes.add(index);
    }

    if (isCodexTurnLifecycleLine(line)) {
      latestTurnLifecycleLineIndex = index;
    }
  }

  if (latestTurnLifecycleLineIndex !== null) {
    selectedLineIndexes.add(latestTurnLifecycleLineIndex);
  }

  const selectedLines = Array.from(selectedLineIndexes)
    .sort((left, right) => left - right)
    .map((index) => lines[index]);

  return trimParsedTranscriptToChatMessageTail(
    parseTranscriptLines(selectedLines, sessionId),
    chatMessageTail
  );
}

export function parseCodexTranscriptChatMessageTail(
  raw: string,
  sessionId: string,
  chatMessageTail: number,
  lineIndexOffset = 0
) {
  const lines = raw
    .split(/\r?\n/)
    .map((line, index) => ({ index: index + lineIndexOffset, line: line.trim() }))
    .filter(({ line }) => Boolean(line));

  return parseCodexTranscriptChatMessageLines(lines, sessionId, chatMessageTail);
}
export { dedupeCodexTranscriptEntries } from "./codexTranscriptDedupe.ts";
