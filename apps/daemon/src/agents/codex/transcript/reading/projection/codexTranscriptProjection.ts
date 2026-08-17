import type {
  AgentTranscriptEntry,
  CodexSessionDetail,
  CodexSessionSummary
} from "@deskcue/protocol";

import type { CodexSessionRuntimeContext } from "../../../runtime/codexRuntimeContext.ts";
import {
  extractCodexRuntimeContext,
  extractCodexRuntimeContextLine
} from "../../../runtime/codexRuntimeContext.ts";
import {
  dedupeCodexTranscriptEntries,
  parseCodexTranscript,
  parseCodexTranscriptChatMessageLines,
  parseCodexTranscriptChatMessageTail,
  parseCodexTranscriptSelectedLines,
  parseCodexTranscriptTail
} from "../../parsing/codexTranscript.ts";

export interface TranscriptSlice {
  containsTurnContextLine?: boolean;
  entries?: AgentTranscriptEntry[];
  indexed?: boolean;
  lineIndexOffset: number;
  lines?: Array<{ index: number; line: string }>;
  raw?: string;
  readLineCount?: number;
}

export function mergeCodexDetailSummary(
  detail: CodexSessionDetail,
  summary: CodexSessionSummary,
  runtimeContext: CodexSessionRuntimeContext | null = null
): CodexSessionDetail {
  return {
    ...detail,
    ...summary,
    approvalPolicy: runtimeContext?.approvalPolicy ?? detail.approvalPolicy ?? summary.approvalPolicy,
    model: runtimeContext?.model ?? detail.model ?? summary.model,
    sandboxMode: runtimeContext?.sandboxMode ?? detail.sandboxMode ?? summary.sandboxMode,
    transcript: detail.transcript
  };
}

export function extractRuntimeContextFromLines(lines: Array<{ line: string }>) {
  let latestContext: CodexSessionRuntimeContext | null = null;
  for (const { line } of lines) {
    const context = extractCodexRuntimeContextLine(line);
    if (context) {
      latestContext = context;
    }
  }

  return latestContext;
}

export function readTranscriptEntryLineIndex(entry: AgentTranscriptEntry | undefined) {
  if (!entry) {
    return null;
  }

  const sourceRange = entry.sourceEntryRanges?.[0] ?? entry.sourceEntrySpans?.[0];
  if (sourceRange) {
    return sourceRange.start;
  }

  const separatorIndex = entry.id.lastIndexOf("-");
  if (separatorIndex < 0) {
    return null;
  }

  const parsed = Number(entry.id.slice(separatorIndex + 1));
  return Number.isInteger(parsed) ? parsed : null;
}

export function extractCodexRuntimeContextFromTranscriptSlice(
  transcriptSlice: TranscriptSlice
): CodexSessionRuntimeContext | null {
  if (transcriptSlice.raw !== undefined) {
    return extractCodexRuntimeContext(transcriptSlice.raw);
  }

  let latestContext: CodexSessionRuntimeContext | null = null;
  for (const { line } of transcriptSlice.lines ?? []) {
    const context = extractCodexRuntimeContextLine(line.trim());
    if (context) {
      latestContext = context;
    }
  }

  return latestContext;
}

export function readCodexSourceEntryLineIndex(sessionId: string, sourceEntryId: string) {
  const idPrefix = `${sessionId}-`;
  if (!sourceEntryId.startsWith(idPrefix)) {
    return null;
  }

  const parsed = Number(sourceEntryId.slice(idPrefix.length));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function buildCodexTranscriptWindowSessionId(
  sessionId: string,
  byteOffset: number,
  endByteOffset?: number
) {
  return endByteOffset === undefined
    ? `${sessionId}@${byteOffset}`
    : `${sessionId}@${byteOffset}~${endByteOffset}`;
}

export function readCodexTranscriptWindowEntryRef(sessionId: string, sourceEntryId: string) {
  const idPrefix = `${sessionId}@`;
  if (!sourceEntryId.startsWith(idPrefix)) {
    return null;
  }

  const separatorIndex = sourceEntryId.lastIndexOf("-");
  if (separatorIndex <= idPrefix.length || separatorIndex === sourceEntryId.length - 1) {
    return null;
  }

  const windowRange = sourceEntryId.slice(idPrefix.length, separatorIndex);
  const [byteOffsetText, endByteOffsetText] = windowRange.split("~", 2);
  const byteOffset = Number(byteOffsetText);
  const endByteOffset = endByteOffsetText === undefined ? undefined : Number(endByteOffsetText);
  const lineIndex = Number(sourceEntryId.slice(separatorIndex + 1));
  if (
    !Number.isSafeInteger(byteOffset) ||
    (endByteOffset !== undefined && (!Number.isSafeInteger(endByteOffset) || endByteOffset <= byteOffset)) ||
    !Number.isSafeInteger(lineIndex) ||
    byteOffset < 0 ||
    lineIndex < 0
  ) {
    return null;
  }

  return {
    byteOffset,
    endByteOffset,
    lineIndex,
    windowSessionId: buildCodexTranscriptWindowSessionId(sessionId, byteOffset, endByteOffset)
  };
}

export function readCodexTranscriptEntryRefs(sessionId: string, entryIds: string[]) {
  const exactLineIndexes = new Set<number>();
  const windowLineIndexesByByteOffset = new Map<number, Set<number>>();
  const idPrefix = `${sessionId}-`;

  for (const entryId of entryIds) {
    const windowRef = readCodexTranscriptWindowEntryRef(sessionId, entryId);
    if (windowRef) {
      const lineIndexes = windowLineIndexesByByteOffset.get(windowRef.byteOffset) ?? new Set<number>();
      lineIndexes.add(windowRef.lineIndex);
      windowLineIndexesByByteOffset.set(windowRef.byteOffset, lineIndexes);
      continue;
    }

    if (!entryId.startsWith(idPrefix)) {
      continue;
    }

    const parsed = Number(entryId.slice(idPrefix.length));
    if (Number.isInteger(parsed) && parsed >= 0) {
      exactLineIndexes.add(parsed);
    }
  }

  return { exactLineIndexes, windowLineIndexesByByteOffset };
}

function trimTranscriptToChatMessageTail(
  transcript: CodexSessionDetail["transcript"],
  chatMessageTail: number
) {
  const chatEntries = transcript.filter((entry) => entry.role === "user" || entry.role === "assistant");
  if (chatEntries.length <= chatMessageTail) {
    return transcript;
  }

  const firstVisibleChatEntry = chatEntries[chatEntries.length - chatMessageTail];
  const firstVisibleLineIndex = readTranscriptEntryLineIndex(firstVisibleChatEntry);
  if (firstVisibleLineIndex === null) {
    return transcript.slice(Math.max(0, transcript.length - chatMessageTail));
  }

  return transcript.filter((entry) => {
    const lineIndex = readTranscriptEntryLineIndex(entry);
    return lineIndex === null || lineIndex >= firstVisibleLineIndex;
  });
}

export function trimIncrementalTranscript(
  transcript: CodexSessionDetail["transcript"],
  options: {
    chatMessageTail?: number;
    transcriptTail?: number;
  }
) {
  if (options.chatMessageTail && options.chatMessageTail > 0) {
    return trimTranscriptToChatMessageTail(transcript, options.chatMessageTail);
  }

  if (options.transcriptTail && options.transcriptTail > 0) {
    return transcript.slice(-options.transcriptTail);
  }

  return transcript;
}

function parseTranscriptSliceLines(
  transcriptSlice: TranscriptSlice,
  sessionId: string,
  options: { chatMessageTail?: number; transcriptTail?: number }
) {
  if (options.chatMessageTail && options.chatMessageTail > 0) {
    if (transcriptSlice.lines) {
      return parseCodexTranscriptChatMessageLines(transcriptSlice.lines, sessionId, options.chatMessageTail);
    }
    return parseCodexTranscriptChatMessageTail(
      transcriptSlice.raw ?? "",
      sessionId,
      options.chatMessageTail,
      transcriptSlice.lineIndexOffset
    );
  }

  if (options.transcriptTail && options.transcriptTail > 0) {
    return parseCodexTranscriptTail(
      transcriptSlice.raw ?? "",
      sessionId,
      options.transcriptTail,
      transcriptSlice.lineIndexOffset
    );
  }

  if (transcriptSlice.lines) {
    return parseCodexTranscriptSelectedLines(transcriptSlice.lines, sessionId);
  }
  return parseCodexTranscript(transcriptSlice.raw ?? "", sessionId);
}

function readFirstVisibleChatTranscriptLineIndex(entries: AgentTranscriptEntry[]) {
  for (const entry of entries) {
    if (entry.role !== "user" && entry.role !== "assistant") {
      continue;
    }
    const lineIndex = readTranscriptEntryLineIndex(entry);
    if (lineIndex !== null) {
      return lineIndex;
    }
  }
  return null;
}

function readFirstVisibleTranscriptLineIndex(entries: AgentTranscriptEntry[]) {
  for (const entry of entries) {
    const lineIndex = readTranscriptEntryLineIndex(entry);
    if (lineIndex !== null) {
      return lineIndex;
    }
  }
  return null;
}

function filterIndexedTranscriptEntriesToVisibleWindow(
  entries: AgentTranscriptEntry[],
  parsedTranscript: AgentTranscriptEntry[],
  options: { chatMessageTail?: number; transcriptTail?: number }
) {
  const firstVisibleLineIndex = options.chatMessageTail && options.chatMessageTail > 0
    ? readFirstVisibleChatTranscriptLineIndex(parsedTranscript)
    : options.transcriptTail && options.transcriptTail > 0
      ? readFirstVisibleTranscriptLineIndex(parsedTranscript)
      : null;

  if (firstVisibleLineIndex === null) {
    return entries;
  }

  return entries.filter((entry) => {
    const lineIndex = readTranscriptEntryLineIndex(entry);
    return lineIndex === null || lineIndex >= firstVisibleLineIndex;
  });
}

function compareTranscriptEntriesBySourceLine(left: AgentTranscriptEntry, right: AgentTranscriptEntry) {
  const leftLineIndex = readTranscriptEntryLineIndex(left);
  const rightLineIndex = readTranscriptEntryLineIndex(right);
  if (leftLineIndex !== null && rightLineIndex !== null && leftLineIndex !== rightLineIndex) {
    return leftLineIndex - rightLineIndex;
  }
  if (leftLineIndex !== null && rightLineIndex === null) {
    return -1;
  }
  if (leftLineIndex === null && rightLineIndex !== null) {
    return 1;
  }
  return left.id.localeCompare(right.id);
}

function mergeTranscriptSliceEntries(
  parsedTranscript: AgentTranscriptEntry[],
  indexedEntries: AgentTranscriptEntry[] | undefined,
  options: { chatMessageTail?: number; transcriptTail?: number }
) {
  if (!indexedEntries?.length) {
    return parsedTranscript;
  }

  const visibleIndexedEntries = filterIndexedTranscriptEntriesToVisibleWindow(
    indexedEntries,
    parsedTranscript,
    options
  );
  if (visibleIndexedEntries.length === 0) {
    return parsedTranscript;
  }

  return dedupeCodexTranscriptEntries(
    [...parsedTranscript, ...visibleIndexedEntries].sort(compareTranscriptEntriesBySourceLine)
  );
}

export function parseTranscript(
  transcriptSlice: TranscriptSlice,
  sessionId: string,
  options: {
    chatMessageTail?: number;
    transcriptTail?: number;
  } = {}
) {
  const parsedTranscript = parseTranscriptSliceLines(transcriptSlice, sessionId, options);
  return mergeTranscriptSliceEntries(parsedTranscript, transcriptSlice.entries, options);
}
