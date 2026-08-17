import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";

import {
  readCompactTranscriptLinesFromIndexedHints,
  readCompactTranscriptLinesFromLineOffset
} from "./codexTranscriptCompactReader.ts";
import type { CodexTranscriptLifecycle } from "./codexTranscriptLifecycle.ts";
import { createCodexTranscriptRawTailIo } from "./codexTranscriptRawTailIo.ts";
import type { TranscriptLineIndexOffsetMode } from "./codexTranscriptRawTailIo.ts";
import {
  CODEX_CHAT_MESSAGE_LINE_READ_MULTIPLIER,
  CODEX_CHAT_MESSAGE_TAIL_MAX_READ_BYTES,
  CODEX_TRANSCRIPT_EXPANDED_TAIL_READ_BYTES,
  CODEX_TRANSCRIPT_TAIL_READ_BYTES
} from "./codexTranscriptReadLimits.ts";
import { createCodexTranscriptWindowIo } from "./codexTranscriptWindowIo.ts";
import {
  countTranscriptSliceChatMessageLines,
  createCodexTranscriptWindowReader
} from "./codexTranscriptWindowReader.ts";
import { findNearestTranscriptByteOffset } from "./index/codexTranscriptLineIndex.ts";
import type { CodexTranscriptLineIndex } from "./index/codexTranscriptLineIndex.ts";
import type { TranscriptSlice } from "./projection/codexTranscriptProjection.ts";
import { countCodexChatMessageLines } from "../parsing/codexTranscript.ts";

export type CodexTranscriptTailReader = ReturnType<typeof createCodexTranscriptTailReader>;

export function createCodexTranscriptTailReader(
  transcriptLineIndex: CodexTranscriptLineIndex,
  _transcriptLifecycle: CodexTranscriptLifecycle
) {
const transcriptRawTailIo = createCodexTranscriptRawTailIo(transcriptLineIndex);
const transcriptWindowIo = createCodexTranscriptWindowIo(transcriptLineIndex);
const transcriptWindowReader = createCodexTranscriptWindowReader(transcriptWindowIo);
const {
  readCodexRuntimeContext,
  readTranscriptTail
} = transcriptRawTailIo;
const {
  readCodexTranscriptLineByteOffset,
  readTranscriptLineIndexSnapshot,
  readTranscriptLinesByIndexes,
  readTranscriptLinesByWindowIndexes,
  readTranscriptLinesFromLineOffset
} = transcriptWindowIo;
const {
  getCodexTranscriptWindowFromByteOffset,
  readCompactTranscriptTail,
  readCompactTranscriptTailWindowForLimits,
  readCompactTranscriptWindowBeforeByteOffset
} = transcriptWindowReader;

async function readTranscriptChatMessageTailByIndex(
  filePath: string,
  providedStat: Stats | undefined,
  requiredChatMessageLines: number,
  options: {
    compactActivityLines?: boolean;
    sessionId?: string;
  } = {}
): Promise<TranscriptSlice | null> {
  const fileStat = providedStat ?? await stat(filePath);
  if (fileStat.size <= CODEX_TRANSCRIPT_TAIL_READ_BYTES) {
    return null;
  }

  const lineIndexSnapshot = await readTranscriptLineIndexSnapshot(filePath, fileStat, {
    requireChatMessageOffsets: true,
    requireLineHints: options.compactActivityLines,
    requireOffsets: options.compactActivityLines
  });
  const chatMessageLineOffsets = lineIndexSnapshot.chatMessageLineOffsets;
  if (!chatMessageLineOffsets?.length) {
    return null;
  }

  const messageStartIndex = Math.max(
    0,
    chatMessageLineOffsets.length - requiredChatMessageLines
  );
  const messageStartOffset = chatMessageLineOffsets[messageStartIndex];
  if (!messageStartOffset) {
    return null;
  }

  const cappedStartByteOffset = Math.max(
    0,
    fileStat.size - CODEX_CHAT_MESSAGE_TAIL_MAX_READ_BYTES
  );

  if (messageStartOffset.byteOffset < cappedStartByteOffset) {
    if (options.compactActivityLines && options.sessionId) {
      const cappedStartOffset = findNearestTranscriptByteOffset(
          lineIndexSnapshot.lineOffsets,
          cappedStartByteOffset
      );
      return (await readCompactTranscriptLinesFromIndexedHints(
        filePath,
        lineIndexSnapshot,
        cappedStartOffset,
        options.sessionId
      )) ?? readCompactTranscriptLinesFromLineOffset(
        filePath,
        cappedStartOffset,
        options.sessionId
      );
    }

    return readTranscriptTail(filePath, CODEX_CHAT_MESSAGE_TAIL_MAX_READ_BYTES, fileStat);
  }

  if (options.compactActivityLines && options.sessionId) {
    return (await readCompactTranscriptLinesFromIndexedHints(
      filePath,
      lineIndexSnapshot,
      messageStartOffset,
      options.sessionId
    )) ?? readCompactTranscriptLinesFromLineOffset(
      filePath,
      messageStartOffset,
      options.sessionId
    );
  }

  return readTranscriptLinesFromLineOffset(filePath, messageStartOffset);
}

async function readCompactTranscriptTailForLimits(
  filePath: string,
  {
    fileStat: providedStat,
    readBytes,
    requiredChatMessageLines,
    sessionId
  }: {
    fileStat?: Stats;
    readBytes: number;
    requiredChatMessageLines: number;
    sessionId: string;
  }
): Promise<TranscriptSlice | null> {
  if (!sessionId) {
    return null;
  }

  const fileStat = providedStat ?? await stat(filePath);
  if (fileStat.size <= readBytes) {
    return null;
  }

  const maxReadBytes = Math.min(fileStat.size, CODEX_CHAT_MESSAGE_TAIL_MAX_READ_BYTES);
  let currentReadBytes = readBytes;
  let lastSlice: TranscriptSlice | null = null;

  while (currentReadBytes <= maxReadBytes) {
    lastSlice = await readCompactTranscriptTail(
      filePath,
      fileStat,
      currentReadBytes,
      sessionId
    );
    if (
      requiredChatMessageLines <= 0 ||
      countTranscriptSliceChatMessageLines(lastSlice) >= requiredChatMessageLines
    ) {
      return lastSlice;
    }

    if (currentReadBytes === maxReadBytes) {
      break;
    }

    currentReadBytes = Math.min(
      Math.max(currentReadBytes * 2, CODEX_TRANSCRIPT_EXPANDED_TAIL_READ_BYTES),
      maxReadBytes
    );
  }

  return lastSlice;
}

async function readTranscriptTailForLimits(
  filePath: string,
  options: {
    allowIndexedTail?: boolean;
    chatMessageTail?: number;
    compactActivityLines?: boolean;
    fileStat?: Stats;
    lineIndexOffset?: TranscriptLineIndexOffsetMode;
    sessionId?: string;
  }
) {
  const shouldReadCompactActivityLines =
    options.compactActivityLines === true &&
    Boolean(options.sessionId) &&
    Boolean(options.chatMessageTail && options.chatMessageTail > 0);
  const compactRequiredChatMessageLines =
    options.chatMessageTail && options.chatMessageTail > 0
      ? options.chatMessageTail
      : 0;
  const rawRequiredChatMessageLines =
    options.chatMessageTail && options.chatMessageTail > 0
      ? options.chatMessageTail * CODEX_CHAT_MESSAGE_LINE_READ_MULTIPLIER
      : 0;

  if (shouldReadCompactActivityLines && compactRequiredChatMessageLines > 0) {
    const indexedTranscriptSlice = await readTranscriptChatMessageTailByIndex(
      filePath,
      options.fileStat,
      compactRequiredChatMessageLines,
      {
        compactActivityLines: true,
        sessionId: options.sessionId
      }
    );
    if (indexedTranscriptSlice) {
      return indexedTranscriptSlice;
    }

    const compactTailSlice = await readCompactTranscriptTailForLimits(filePath, {
      fileStat: options.fileStat,
      readBytes: CODEX_TRANSCRIPT_TAIL_READ_BYTES,
      requiredChatMessageLines: compactRequiredChatMessageLines,
      sessionId: options.sessionId ?? ""
    });
    if (compactTailSlice) {
      return compactTailSlice;
    }
  }

  const transcriptSlice = await readTranscriptTail(
    filePath,
    CODEX_TRANSCRIPT_TAIL_READ_BYTES,
    options.fileStat,
    {
      lineIndexOffset: options.lineIndexOffset
    }
  );
  if (!options.chatMessageTail || options.chatMessageTail <= 0) {
    return transcriptSlice;
  }

  if (countCodexChatMessageLines(transcriptSlice.raw ?? "") >= rawRequiredChatMessageLines) {
    return transcriptSlice;
  }

  if (options.allowIndexedTail !== false) {
    const indexedTranscriptSlice = await readTranscriptChatMessageTailByIndex(
      filePath,
      options.fileStat,
      rawRequiredChatMessageLines
    );
    if (indexedTranscriptSlice) {
      return indexedTranscriptSlice;
    }
  }

  let readBytes = Math.max(
    CODEX_TRANSCRIPT_EXPANDED_TAIL_READ_BYTES,
    CODEX_TRANSCRIPT_TAIL_READ_BYTES * 2
  );
  let expandedTranscriptSlice = transcriptSlice;
  const fileSize = options.fileStat?.size ?? Number.POSITIVE_INFINITY;
  const maxReadBytes = Math.min(fileSize, CODEX_CHAT_MESSAGE_TAIL_MAX_READ_BYTES);

  while (readBytes < maxReadBytes) {
    expandedTranscriptSlice = await readTranscriptTail(
      filePath,
      readBytes,
      options.fileStat,
      {
        lineIndexOffset: options.lineIndexOffset
      }
    );

    if (countCodexChatMessageLines(expandedTranscriptSlice.raw ?? "") >= rawRequiredChatMessageLines) {
      return expandedTranscriptSlice;
    }

    readBytes = Math.min(readBytes * 2, maxReadBytes);
  }

  return readTranscriptTail(
    filePath,
    maxReadBytes,
    options.fileStat,
    {
      lineIndexOffset: options.lineIndexOffset
    }
  );
}

  return {
    getCodexTranscriptWindowFromByteOffset,
    readCompactTranscriptLinesFromLineOffset,
    readCodexRuntimeContext,
    readCodexTranscriptLineByteOffset,
    readCompactTranscriptTailWindowForLimits,
    readCompactTranscriptWindowBeforeByteOffset,
    readTranscriptLineIndexSnapshot,
    readTranscriptLinesByIndexes,
    readTranscriptLinesByWindowIndexes,
    readTranscriptTail,
    readTranscriptTailForLimits
  };
}
