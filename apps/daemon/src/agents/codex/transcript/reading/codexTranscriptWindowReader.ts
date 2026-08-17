import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";

import type { AgentTranscriptEntry } from "@deskcue/protocol";

import {
  readCompactTranscriptLinesFromIndexedHints,
  readCompactTranscriptLinesFromLineOffset
} from "./codexTranscriptCompactReader.ts";
import {
  CODEX_CHAT_MESSAGE_LINE_READ_MULTIPLIER,
  CODEX_CHAT_MESSAGE_TAIL_MAX_READ_BYTES,
  CODEX_TRANSCRIPT_EXPANDED_TAIL_READ_BYTES,
  CODEX_TRANSCRIPT_TAIL_READ_BYTES,
  CODEX_TRANSCRIPT_TAIL_WINDOW_BACKTRACK_BYTES
} from "./codexTranscriptReadLimits.ts";
import type { createCodexTranscriptWindowIo } from "./codexTranscriptWindowIo.ts";
import { countCodexChatMessageLines, isCodexChatMessageLine } from "../parsing/codexTranscript.ts";
import { findNearestTranscriptByteOffset } from "./index/codexTranscriptLineIndex.ts";
import {
  buildCodexTranscriptWindowSessionId,
  parseTranscript,
  readCodexTranscriptWindowEntryRef,
  readTranscriptEntryLineIndex
} from "./projection/codexTranscriptProjection.ts";
import type { TranscriptSlice } from "./projection/codexTranscriptProjection.ts";

type TranscriptWindowIo = ReturnType<typeof createCodexTranscriptWindowIo>;

export function countTranscriptSliceChatMessageLines(transcriptSlice: TranscriptSlice) {
  if (transcriptSlice.raw !== undefined) return countCodexChatMessageLines(transcriptSlice.raw);
  return (transcriptSlice.lines ?? []).filter(({ line }) => isCodexChatMessageLine(line)).length;
}

function transcriptEntryReferencesSourceLine(
  entry: AgentTranscriptEntry,
  windowSessionId: string,
  lineIndex: number
) {
  const sourceEntryId = `${windowSessionId}-${lineIndex}`;
  if (entry.sourceEntryIds?.includes(sourceEntryId)) return true;
  const sourcePrefix = `${windowSessionId}-`;
  return [...(entry.sourceEntryRanges ?? []), ...(entry.sourceEntrySpans ?? [])].some((range) =>
    range.prefix === sourcePrefix && range.start <= lineIndex && range.end >= lineIndex
  );
}

export function createCodexTranscriptWindowReader(windowIo: TranscriptWindowIo) {
  async function getCodexTranscriptWindowFromByteOffset(
    filePath: string,
    windowRef: NonNullable<ReturnType<typeof readCodexTranscriptWindowEntryRef>>,
    options: { maxLineCount?: number; overlapLineCount?: number }
  ) {
    const fileStat = await stat(filePath);
    if (windowRef.endByteOffset !== undefined && windowRef.endByteOffset > fileStat.size) return null;
    if (windowRef.byteOffset >= fileStat.size) return null;

    const overlapLineCount = Math.max(0, options.overlapLineCount ?? 96);
    const startLineIndex = Math.max(0, windowRef.lineIndex - overlapLineCount);
    const transcriptSlice = await readCompactTranscriptLinesFromLineOffset(
      filePath,
      { byteOffset: windowRef.byteOffset, lineIndex: 0 },
      windowRef.windowSessionId,
      windowRef.endByteOffset
    );
    if (
      options.maxLineCount &&
      transcriptSlice.readLineCount &&
      transcriptSlice.readLineCount - startLineIndex > options.maxLineCount
    ) return null;

    const entries = parseTranscript(transcriptSlice, windowRef.windowSessionId);
    const filteredEntries = entries.filter((entry) => {
      const lineIndex = readTranscriptEntryLineIndex(entry);
      return lineIndex === null || lineIndex >= startLineIndex;
    });

    return filteredEntries.some((entry) =>
      entry.id === `${windowRef.windowSessionId}-${windowRef.lineIndex}` ||
      transcriptEntryReferencesSourceLine(entry, windowRef.windowSessionId, windowRef.lineIndex)
    ) ? filteredEntries : null;
  }

  async function readCompactTranscriptTail(
    filePath: string,
    fileStat: Stats,
    readBytes: number,
    sessionId: string
  ) {
    const tailStartByteOffset = Math.max(0, fileStat.size - readBytes);
    const lineIndexSnapshot = await windowIo.readTranscriptLineIndexSnapshot(filePath, fileStat, {
      requireLineHints: true,
      requireOffsets: true
    });
    const tailStartOffset = findNearestTranscriptByteOffset(
      lineIndexSnapshot.lineOffsets,
      tailStartByteOffset
    );
    return (await readCompactTranscriptLinesFromIndexedHints(
      filePath,
      lineIndexSnapshot,
      tailStartOffset,
      sessionId
    )) ?? readCompactTranscriptLinesFromLineOffset(filePath, tailStartOffset, sessionId);
  }

  async function readCompactTranscriptTailWindowForLimits(
    filePath: string,
    fileStat: Stats,
    sessionId: string,
    options: { chatMessageTail?: number }
  ): Promise<{ transcriptSlice: TranscriptSlice } | null> {
    const requiredLines = options.chatMessageTail && options.chatMessageTail > 0
      ? options.chatMessageTail * CODEX_CHAT_MESSAGE_LINE_READ_MULTIPLIER
      : 0;
    const maxReadBytes = Math.min(fileStat.size, CODEX_CHAT_MESSAGE_TAIL_MAX_READ_BYTES);
    let readBytes = Math.min(fileStat.size, CODEX_TRANSCRIPT_TAIL_READ_BYTES);
    let lastWindow: { transcriptSlice: TranscriptSlice } | null = null;

    while (readBytes <= maxReadBytes) {
      lastWindow = { transcriptSlice: await readCompactTranscriptTail(filePath, fileStat, readBytes, sessionId) };
      if (requiredLines <= 0 || countTranscriptSliceChatMessageLines(lastWindow.transcriptSlice) >= requiredLines) {
        return lastWindow;
      }
      if (readBytes === maxReadBytes) break;
      readBytes = Math.min(
        Math.max(readBytes * 2, CODEX_TRANSCRIPT_EXPANDED_TAIL_READ_BYTES),
        maxReadBytes
      );
    }
    return lastWindow;
  }

  async function readCompactTranscriptWindowBeforeByteOffset(
    filePath: string,
    sessionId: string,
    endByteOffset: number
  ): Promise<{
    transcriptSlice: TranscriptSlice;
    windowSessionId: string;
    windowStartByteOffset: number;
  } | null> {
    const maxReadBytes = Math.min(endByteOffset, CODEX_CHAT_MESSAGE_TAIL_MAX_READ_BYTES);
    let readBytes = Math.min(endByteOffset, CODEX_TRANSCRIPT_TAIL_READ_BYTES);
    let lastWindow: {
      transcriptSlice: TranscriptSlice;
      windowSessionId: string;
      windowStartByteOffset: number;
    } | null = null;

    while (readBytes <= maxReadBytes) {
      const targetStartByteOffset = Math.max(0, endByteOffset - readBytes);
      const windowStartByteOffset = await windowIo.findTranscriptTailWindowStartByteOffset(
        filePath,
        targetStartByteOffset,
        CODEX_TRANSCRIPT_TAIL_WINDOW_BACKTRACK_BYTES
      );
      const windowSessionId = buildCodexTranscriptWindowSessionId(
        sessionId,
        windowStartByteOffset,
        endByteOffset
      );
      const transcriptSlice = await readCompactTranscriptLinesFromLineOffset(
        filePath,
        { byteOffset: windowStartByteOffset, lineIndex: 0 },
        windowSessionId,
        endByteOffset
      );
      lastWindow = { transcriptSlice, windowSessionId, windowStartByteOffset };
      if (countTranscriptSliceChatMessageLines(transcriptSlice) >= 1 || windowStartByteOffset === 0) {
        return lastWindow;
      }
      if (readBytes === maxReadBytes) break;
      readBytes = Math.min(
        Math.max(readBytes * 2, CODEX_TRANSCRIPT_EXPANDED_TAIL_READ_BYTES),
        maxReadBytes
      );
    }
    return lastWindow;
  }

  return {
    getCodexTranscriptWindowFromByteOffset,
    readCompactTranscriptTail,
    readCompactTranscriptTailWindowForLimits,
    readCompactTranscriptWindowBeforeByteOffset
  };
}
