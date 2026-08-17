import { createReadStream } from "node:fs";
import type { Stats } from "node:fs";

import { findNearestTranscriptByteOffset } from "./codexTranscriptLineIndex.ts";
import type {
  TranscriptCompactLineSpan,
  TranscriptLineIndexSnapshot,
  TranscriptLineOffset
} from "./codexTranscriptLineIndex.types.ts";
import { isCodexChatMessageLine } from "../../parsing/codexTranscript.ts";
import {
  CODEX_CHAT_MESSAGE_LINE_DETECTION_MAX_BYTES,
  CODEX_CHAT_MESSAGE_TAIL_MAX_READ_BYTES,
  CODEX_TRANSCRIPT_INDEXED_LINE_HINT_BYTES,
  CODEX_TRANSCRIPT_LINE_OFFSET_BLOCK_SIZE
} from "../codexTranscriptReadLimits.ts";
import {
  classifyIndexedTranscriptActivityLine,
  hasJsonStringProperty,
  readCodexTranscriptLineTypeHint,
  resolveKnownCompactTranscriptLineDecision,
  shouldKeepIndexedTranscriptLineExact
} from "../projection/codexTranscriptCompactProjection.ts";
import type { CodexTranscriptLineTypeHint } from "../projection/codexTranscriptCompactProjection.ts";

type TranscriptLineSnapshotScan = {
  byteOffset: number;
  chatMessageLineOffsets: TranscriptLineOffset[] | undefined;
  compactLineSpans: TranscriptCompactLineSpan[] | undefined;
  currentLineByteOffset: number;
  exactLineOffsets: TranscriptLineOffset[] | undefined;
  lastByte: number | null;
  lineHintMinByteOffset: number;
  lineHintsComplete: boolean | undefined;
  lineBreakCount: number;
  lineOffsets: TranscriptLineOffset[] | undefined;
  pendingLineBytes: number;
  pendingLineChunks: Buffer[];
  pendingLineTruncated: boolean;
};

function trimTranscriptLineHints(snapshot: TranscriptLineIndexSnapshot): TranscriptLineIndexSnapshot {
  if (snapshot.lineHintsComplete !== true) {
    return snapshot;
  }

  const hintStartByteOffset = Math.max(
    0,
    snapshot.size - CODEX_CHAT_MESSAGE_TAIL_MAX_READ_BYTES
  );
  const hintStartLineIndex = findNearestTranscriptByteOffset(
    snapshot.lineOffsets,
    hintStartByteOffset
  ).lineIndex;

  return {
    ...snapshot,
    compactLineSpans: (snapshot.compactLineSpans ?? [])
      .filter((span) => span.end >= hintStartLineIndex)
      .map((span) => ({
        ...span,
        start: Math.max(span.start, hintStartLineIndex)
      })),
    exactLineOffsets: (snapshot.exactLineOffsets ?? [])
      .filter((offset) => offset.lineIndex >= hintStartLineIndex)
  };
}

function createTranscriptLineSnapshotScan(options: {
  chatMessageLineOffsets?: TranscriptLineOffset[];
  compactLineSpans?: TranscriptCompactLineSpan[];
  exactLineOffsets?: TranscriptLineOffset[];
  includeChatMessageOffsets: boolean;
  includeLineHints: boolean;
  includeOffsets: boolean;
  initialByteOffset: number;
  initialLineBreakCount: number;
  lineHintMinByteOffset?: number;
  lineOffsets?: TranscriptLineOffset[];
}): TranscriptLineSnapshotScan {
  return {
    byteOffset: options.initialByteOffset,
    chatMessageLineOffsets: options.includeChatMessageOffsets
      ? [...(options.chatMessageLineOffsets ?? [])]
      : undefined,
    compactLineSpans: options.includeLineHints
      ? [...(options.compactLineSpans ?? [])]
      : undefined,
    currentLineByteOffset: options.initialByteOffset,
    exactLineOffsets: options.includeLineHints
      ? [...(options.exactLineOffsets ?? [])]
      : undefined,
    lastByte: null,
    lineHintMinByteOffset: options.lineHintMinByteOffset ?? 0,
    lineHintsComplete: options.includeLineHints ? true : undefined,
    lineBreakCount: options.initialLineBreakCount,
    lineOffsets: options.lineOffsets?.length
      ? [...options.lineOffsets]
      : options.includeOffsets
        ? [
            {
              byteOffset: 0,
              lineIndex: 0
            }
          ]
        : undefined,
    pendingLineBytes: 0,
    pendingLineChunks: [],
    pendingLineTruncated: false
  };
}

function appendPendingTranscriptLineChunk(
  scan: TranscriptLineSnapshotScan,
  chunk: Buffer
) {
  if (!scan.chatMessageLineOffsets || chunk.length === 0) {
    return;
  }

  const remainingDetectionBytes =
    CODEX_CHAT_MESSAGE_LINE_DETECTION_MAX_BYTES - scan.pendingLineBytes;
  if (remainingDetectionBytes <= 0) {
    scan.pendingLineTruncated = true;
    return;
  }

  const retainedChunk = chunk.length > remainingDetectionBytes
    ? chunk.subarray(0, remainingDetectionBytes)
    : chunk;
  scan.pendingLineChunks.push(retainedChunk);
  scan.pendingLineBytes += retainedChunk.length;
  if (retainedChunk.length < chunk.length) {
    scan.pendingLineTruncated = true;
  }
}

function readTranscriptLineHintPrefix(lineBuffer: Buffer) {
  const prefix = lineBuffer.length > CODEX_TRANSCRIPT_INDEXED_LINE_HINT_BYTES
    ? lineBuffer.subarray(0, CODEX_TRANSCRIPT_INDEXED_LINE_HINT_BYTES)
    : lineBuffer;
  return prefix.toString("utf8");
}

function isKnownChatMessageTypeHint(typeHint: CodexTranscriptLineTypeHint) {
  return (
    (
      typeHint.itemType === "event_msg" &&
      typeHint.payloadType === "user_message"
    ) ||
    (
      typeHint.itemType === "response_item" &&
      typeHint.payloadType === "message" &&
      (
        typeHint.payloadRole === "user" ||
        (typeHint.payloadRole === "assistant" && typeHint.payloadPhase !== "commentary")
      )
    )
  );
}

function appendTranscriptCompactLineSpan(
  scan: TranscriptLineSnapshotScan,
  span: TranscriptCompactLineSpan
) {
  if (!scan.compactLineSpans) {
    return;
  }

  const previous = scan.compactLineSpans.at(-1);
  if (previous && previous.kind === span.kind && previous.end + 1 === span.start) {
    scan.compactLineSpans[scan.compactLineSpans.length - 1] = {
      ...previous,
      end: span.end,
      timestamp: span.timestamp
    };
    return;
  }

  scan.compactLineSpans.push(span);
}

function recordTranscriptLineHint(
  scan: TranscriptLineSnapshotScan,
  lineBuffer: Buffer,
  lineOffset: TranscriptLineOffset
) {
  if (lineOffset.byteOffset < scan.lineHintMinByteOffset) {
    return;
  }

  const linePrefix = readTranscriptLineHintPrefix(lineBuffer).trim();
  if (!linePrefix) {
    return;
  }

  const typeHint = readCodexTranscriptLineTypeHint(linePrefix);
  let decision = resolveKnownCompactTranscriptLineDecision(typeHint);

  if (
    decision?.retention === "keep" &&
    decision.compactKind === "details" &&
    scan.pendingLineTruncated
  ) {
    decision = {
      compactKind: "details",
      retention: "compact"
    };
  }

  if (!decision && !scan.pendingLineTruncated) {
    const line = lineBuffer.toString("utf8").trim();
    const fullTypeHint = readCodexTranscriptLineTypeHint(line);
    if (shouldKeepIndexedTranscriptLineExact(line, fullTypeHint)) {
      decision = {
        compactKind: null,
        retention: "keep"
      };
    } else {
      decision = {
        compactKind: classifyIndexedTranscriptActivityLine(fullTypeHint),
        retention: "compact"
      };
    }
  }

  if (!decision) {
    scan.lineHintsComplete = false;
    return;
  }

  if (decision.retention === "keep") {
    if (!isKnownChatMessageTypeHint(typeHint)) {
      scan.exactLineOffsets?.push(lineOffset);
    }
    return;
  }

  if (!decision.compactKind) {
    return;
  }

  appendTranscriptCompactLineSpan(scan, {
    end: lineOffset.lineIndex,
    kind: decision.compactKind,
    start: lineOffset.lineIndex,
    timestamp: typeHint.timestamp
  });
}

function resetPendingTranscriptLine(scan: TranscriptLineSnapshotScan) {
  scan.pendingLineBytes = 0;
  scan.pendingLineChunks = [];
  scan.pendingLineTruncated = false;
}

function isLikelyCodexChatMessageLinePrefix(linePrefix: string) {
  if (
    hasJsonStringProperty(linePrefix, "type", "event_msg") &&
    hasJsonStringProperty(linePrefix, "type", "user_message")
  ) {
    return true;
  }

  if (
    !hasJsonStringProperty(linePrefix, "type", "response_item") ||
    !hasJsonStringProperty(linePrefix, "type", "message")
  ) {
    return false;
  }

  if (!hasJsonStringProperty(linePrefix, "role", "user") &&
      !hasJsonStringProperty(linePrefix, "role", "assistant")) {
    return false;
  }

  return !hasJsonStringProperty(linePrefix, "phase", "commentary");
}

function isCodexChatMessageLineBuffer(
  lineBuffer: Buffer,
  options: { truncated: boolean }
) {
  const normalizedBuffer = lineBuffer.at(-1) === 13
    ? lineBuffer.subarray(0, lineBuffer.length - 1)
    : lineBuffer;
  if (
    !normalizedBuffer.includes('"user_message"') &&
    !normalizedBuffer.includes('"type":"message"') &&
    !normalizedBuffer.includes('"type": "message"')
  ) {
    return false;
  }

  if (options.truncated) {
    return isLikelyCodexChatMessageLinePrefix(normalizedBuffer.toString("utf8"));
  }

  return isCodexChatMessageLine(normalizedBuffer.toString("utf8").trim());
}

function recordChatMessageLineOffsetIfMatched(scan: TranscriptLineSnapshotScan) {
  if (
    !scan.chatMessageLineOffsets &&
    !scan.compactLineSpans &&
    !scan.exactLineOffsets
  ) {
    resetPendingTranscriptLine(scan);
    return;
  }

  const lineBuffer = scan.pendingLineChunks.length === 1
    ? scan.pendingLineChunks[0]
    : Buffer.concat(scan.pendingLineChunks, scan.pendingLineBytes);
  const lineOffset = {
    byteOffset: scan.currentLineByteOffset,
    lineIndex: scan.lineBreakCount
  };
  if (lineBuffer && scan.chatMessageLineOffsets && isCodexChatMessageLineBuffer(lineBuffer, {
    truncated: scan.pendingLineTruncated
  })) {
    scan.chatMessageLineOffsets.push(lineOffset);
  }

  if (lineBuffer && scan.lineHintsComplete === true) {
    recordTranscriptLineHint(scan, lineBuffer, lineOffset);
  }

  resetPendingTranscriptLine(scan);
}

function scanTranscriptLineSnapshotBuffer(
  scan: TranscriptLineSnapshotScan,
  buffer: Buffer,
  fileSize: number
) {
  let lineStartIndex = 0;

  for (let index = 0; index < buffer.length; index += 1) {
    const byte = buffer[index];
    scan.lastByte = byte;
    if (byte !== 10) {
      continue;
    }

    appendPendingTranscriptLineChunk(scan, buffer.subarray(lineStartIndex, index));
    recordChatMessageLineOffsetIfMatched(scan);

    scan.lineBreakCount += 1;
    const nextLineByteOffset = scan.byteOffset + index + 1;
    if (
      scan.lineOffsets &&
      scan.lineBreakCount % CODEX_TRANSCRIPT_LINE_OFFSET_BLOCK_SIZE === 0 &&
      nextLineByteOffset < fileSize
    ) {
      scan.lineOffsets.push({
        byteOffset: nextLineByteOffset,
        lineIndex: scan.lineBreakCount
      });
    }

    scan.currentLineByteOffset = nextLineByteOffset;
    lineStartIndex = index + 1;
  }

  appendPendingTranscriptLineChunk(scan, buffer.subarray(lineStartIndex));
  scan.byteOffset += buffer.length;
}

function finishTranscriptLineSnapshotScan(scan: TranscriptLineSnapshotScan) {
  if (scan.pendingLineBytes > 0) {
    recordChatMessageLineOffsetIfMatched(scan);
  }
}

export async function readFullTranscriptLineBreakSnapshot(
  filePath: string,
  fileStat: Stats,
  options: {
    includeChatMessageOffsets: boolean;
    includeLineHints: boolean;
    includeOffsets: boolean;
  }
): Promise<TranscriptLineIndexSnapshot> {
  const scan = createTranscriptLineSnapshotScan({
    includeChatMessageOffsets: options.includeChatMessageOffsets,
    includeLineHints: options.includeLineHints,
    includeOffsets: options.includeOffsets,
    initialByteOffset: 0,
    initialLineBreakCount: 0,
    lineHintMinByteOffset: Math.max(
      0,
      fileStat.size - CODEX_CHAT_MESSAGE_TAIL_MAX_READ_BYTES
    )
  });
  const stream = createReadStream(filePath);

  try {
    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      scanTranscriptLineSnapshotBuffer(scan, buffer, fileStat.size);
    }
  } finally {
    stream.destroy();
  }
  finishTranscriptLineSnapshotScan(scan);

  return trimTranscriptLineHints({
    chatMessageLineOffsets: scan.chatMessageLineOffsets,
    compactLineSpans: scan.compactLineSpans,
    endsWithLineBreak: scan.lastByte === 10,
    exactLineOffsets: scan.exactLineOffsets,
    lineHintsComplete: scan.lineHintsComplete,
    lineBreakCount: scan.lineBreakCount,
    lineOffsets: scan.lineOffsets,
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size
  });
}

export async function readLineBreakSnapshotFromAppendRange(
  cached: TranscriptLineIndexSnapshot,
  filePath: string,
  options: {
    appendStartByteOffset: number;
    mtimeMs: number;
    requireChatMessageOffsets: boolean;
    requireLineHints: boolean;
    requireOffsets: boolean;
    size: number;
  }
): Promise<TranscriptLineIndexSnapshot> {
  const scan = createTranscriptLineSnapshotScan({
    chatMessageLineOffsets: cached.chatMessageLineOffsets,
    compactLineSpans: cached.compactLineSpans,
    exactLineOffsets: cached.exactLineOffsets,
    includeChatMessageOffsets: options.requireChatMessageOffsets,
    includeLineHints: options.requireLineHints,
    includeOffsets: options.requireOffsets,
    initialByteOffset: options.appendStartByteOffset,
    initialLineBreakCount: cached.lineBreakCount,
    lineHintMinByteOffset: Math.max(
      0,
      options.size - CODEX_CHAT_MESSAGE_TAIL_MAX_READ_BYTES
    ),
    lineOffsets: cached.lineOffsets
  });
  scan.lastByte = cached.endsWithLineBreak ? 10 : null;
  const stream = createReadStream(filePath, {
    end: options.size - 1,
    start: options.appendStartByteOffset
  });

  try {
    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      scanTranscriptLineSnapshotBuffer(scan, buffer, options.size);
    }
  } finally {
    stream.destroy();
  }
  finishTranscriptLineSnapshotScan(scan);

  return trimTranscriptLineHints({
    chatMessageLineOffsets: scan.chatMessageLineOffsets,
    compactLineSpans: scan.compactLineSpans,
    endsWithLineBreak: scan.lastByte === 10,
    exactLineOffsets: scan.exactLineOffsets,
    lineHintsComplete: scan.lineHintsComplete,
    lineBreakCount: scan.lineBreakCount,
    lineOffsets: scan.lineOffsets,
    mtimeMs: options.mtimeMs,
    size: options.size
  });
}
