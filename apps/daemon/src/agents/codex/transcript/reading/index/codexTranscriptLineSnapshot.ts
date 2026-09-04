import { createReadStream } from "node:fs";
import type { Stats } from "node:fs";

import type {
  TranscriptCompactLineSpan,
  TranscriptLineIndexSnapshot,
  TranscriptLineOffset
} from "./codexTranscriptLineIndex.types.ts";
import { isCodexChatMessageLine } from "../../parsing/codexTranscript.ts";
import {
  CODEX_CHAT_MESSAGE_LINE_DETECTION_MAX_BYTES,
  CODEX_TRANSCRIPT_INDEXED_LINE_HINT_BYTES,
  CODEX_TRANSCRIPT_LINE_RETENTION_MAX_BYTES,
  CODEX_TRANSCRIPT_LINE_OFFSET_BLOCK_SIZE
} from "../codexTranscriptReadLimits.ts";
import {
  classifyIndexedTranscriptActivityLine,
  readCodexTranscriptLineTypeHint,
  resolveKnownCompactTranscriptLineDecision,
  shouldKeepIndexedTranscriptLineExact
} from "../projection/codexTranscriptCompactProjection.ts";
import type { CodexTranscriptLineTypeHint } from "../projection/codexTranscriptCompactProjection.ts";
import {
  appendCodexTranscriptJsonObjectBytes,
  createCodexTranscriptJsonObjectScan,
  isCompleteCodexTranscriptJsonObject,
  isValidCodexTranscriptJsonObjectText
} from "../projection/codexTranscriptJsonObjectScan.ts";
import type { CodexTranscriptJsonObjectScan } from "../projection/codexTranscriptJsonObjectScan.ts";

type TranscriptLineSnapshotScan = {
  byteOffset: number;
  chatMessageLineOffsets: TranscriptLineOffset[] | undefined;
  compactLineSpans: TranscriptCompactLineSpan[] | undefined;
  currentLineByteOffset: number;
  exactLineOffsets: TranscriptLineOffset[] | undefined;
  lastByte: number | null;
  lineHintsComplete: boolean | undefined;
  lineBreakCount: number;
  lineOffsets: TranscriptLineOffset[] | undefined;
  pendingLineBytes: number;
  pendingLineChunks: Buffer[];
  pendingLineJsonObjectScan: CodexTranscriptJsonObjectScan;
  pendingLineTruncated: boolean;
  pendingLineValidationBytes: number;
  pendingLineValidationChunks: Buffer[];
  pendingLineValidationTruncated: boolean;
};

const UNKNOWN_TRANSCRIPT_TIMESTAMP = new Date(0).toISOString();

function createTranscriptLineSnapshotScan(options: {
  chatMessageLineOffsets?: TranscriptLineOffset[];
  compactLineSpans?: TranscriptCompactLineSpan[];
  exactLineOffsets?: TranscriptLineOffset[];
  includeChatMessageOffsets: boolean;
  includeLineHints: boolean;
  includeOffsets: boolean;
  initialByteOffset: number;
  initialLineBreakCount: number;
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
    pendingLineJsonObjectScan: createCodexTranscriptJsonObjectScan(),
    pendingLineTruncated: false,
    pendingLineValidationBytes: 0,
    pendingLineValidationChunks: [],
    pendingLineValidationTruncated: false
  };
}

function appendPendingTranscriptLineChunk(
  scan: TranscriptLineSnapshotScan,
  chunk: Buffer
) {
  if (chunk.length === 0) return;

  if (scan.lineHintsComplete !== undefined || scan.chatMessageLineOffsets) {
    appendCodexTranscriptJsonObjectBytes(scan.pendingLineJsonObjectScan, chunk);

    if (!scan.pendingLineValidationTruncated) {
      const remainingBytes =
        CODEX_TRANSCRIPT_LINE_RETENTION_MAX_BYTES - scan.pendingLineValidationBytes;
      const retainedChunk = chunk.length > remainingBytes
        ? chunk.subarray(0, remainingBytes)
        : chunk;

      if (retainedChunk.length > 0) {
        scan.pendingLineValidationChunks.push(retainedChunk);
        scan.pendingLineValidationBytes += retainedChunk.length;
      }

      if (retainedChunk.length < chunk.length) scan.pendingLineValidationTruncated = true;
    }
  }

  if (!scan.chatMessageLineOffsets && scan.lineHintsComplete === undefined) return;

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

function readValidatedPendingTranscriptLine(scan: TranscriptLineSnapshotScan) {
  if (!isCompleteCodexTranscriptJsonObject(scan.pendingLineJsonObjectScan)) return null;
  if (scan.pendingLineValidationTruncated) return null;

  const validationLine = Buffer.concat(
    scan.pendingLineValidationChunks,
    scan.pendingLineValidationBytes
  ).toString("utf8").trim();

  return isValidCodexTranscriptJsonObjectText(validationLine) ? validationLine : null;
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
  lineOffset: TranscriptLineOffset,
  validationLine: string
) {
  const linePrefix = readTranscriptLineHintPrefix(lineBuffer).trim();

  if (!linePrefix) {
    return;
  }

  let typeHint = readCodexTranscriptLineTypeHint(linePrefix);
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

  const fullTypeHint = !decision || typeHint.timestamp === UNKNOWN_TRANSCRIPT_TIMESTAMP
    ? readCodexTranscriptLineTypeHint(validationLine)
    : null;

  if (fullTypeHint && decision) {
    typeHint = {
      ...typeHint,
      timestamp: fullTypeHint.timestamp
    };
  }

  if (!decision && fullTypeHint) {
    typeHint = fullTypeHint;

    if (shouldKeepIndexedTranscriptLineExact(validationLine, fullTypeHint)) {
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
  scan.pendingLineJsonObjectScan = createCodexTranscriptJsonObjectScan();
  scan.pendingLineTruncated = false;
  scan.pendingLineValidationBytes = 0;
  scan.pendingLineValidationChunks = [];
  scan.pendingLineValidationTruncated = false;
}

function isCodexChatMessageLineBuffer(lineBuffer: Buffer) {
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

  const shouldCheckChatMessage = Boolean(
    lineBuffer &&
    scan.chatMessageLineOffsets &&
    (
      scan.pendingLineTruncated ||
      isCodexChatMessageLineBuffer(lineBuffer)
    )
  );
  const needsValidation = shouldCheckChatMessage || scan.lineHintsComplete === true;
  const validationLine = needsValidation ? readValidatedPendingTranscriptLine(scan) : null;

  if (
    shouldCheckChatMessage &&
    validationLine &&
    scan.chatMessageLineOffsets &&
    isCodexChatMessageLine(validationLine)
  ) {
    scan.chatMessageLineOffsets.push(lineOffset);
  }

  if (lineBuffer && validationLine && scan.lineHintsComplete === true) {
    recordTranscriptLineHint(
      scan,
      lineBuffer,
      lineOffset,
      validationLine
    );
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
    initialLineBreakCount: 0
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

  return {
    chatMessageLineOffsets: scan.chatMessageLineOffsets,
    compactLineSpans: scan.compactLineSpans,
    endsWithLineBreak: scan.lastByte === 10,
    exactLineOffsets: scan.exactLineOffsets,
    lineHintsComplete: scan.lineHintsComplete,
    lineBreakCount: scan.lineBreakCount,
    lineOffsets: scan.lineOffsets,
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size
  };
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

  return {
    chatMessageLineOffsets: scan.chatMessageLineOffsets,
    compactLineSpans: scan.compactLineSpans,
    endsWithLineBreak: scan.lastByte === 10,
    exactLineOffsets: scan.exactLineOffsets,
    lineHintsComplete: scan.lineHintsComplete,
    lineBreakCount: scan.lineBreakCount,
    lineOffsets: scan.lineOffsets,
    mtimeMs: options.mtimeMs,
    size: options.size
  };
}
