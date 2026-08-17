import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";

import type { AgentTranscriptEntry } from "@deskcue/protocol";

import { isTurnContextLine } from "../parsing/codexTranscript.ts";
import { snapshotLineCount } from "./index/codexTranscriptLineIndex.ts";
import type {
  TranscriptLineIndexSnapshot,
  TranscriptLineOffset
} from "./index/codexTranscriptLineIndex.ts";
import {
  appendCompactTranscriptLineBytes,
  createCompactIndexedTranscriptEntryRange,
  createCompactTranscriptLineAccumulator,
  finishCompactTranscriptLine,
  hasPendingCompactTranscriptLine,
  upsertCompactIndexedTranscriptEntry
} from "./projection/codexTranscriptCompactProjection.ts";
import type { TranscriptSlice } from "./projection/codexTranscriptProjection.ts";

async function readTranscriptLineAtOffset(
  handle: Awaited<ReturnType<typeof open>>,
  byteOffset: number
) {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let position = byteOffset;

  while (true) {
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) {
      break;
    }

    const chunk = buffer.subarray(0, bytesRead);
    const lineBreakIndex = chunk.indexOf(10);
    if (lineBreakIndex >= 0) {
      const lineChunk = chunk.subarray(0, lineBreakIndex);
      chunks.push(lineChunk);
      totalBytes += lineChunk.length;
      break;
    }

    chunks.push(chunk);
    totalBytes += chunk.length;
    position += bytesRead;
  }

  const line = Buffer.concat(chunks, totalBytes).toString("utf8");
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

async function readTranscriptLinesByOffsets(
  filePath: string,
  offsets: TranscriptLineOffset[]
) {
  const selectedLines: Array<{ index: number; line: string }> = [];
  if (offsets.length === 0) {
    return selectedLines;
  }

  const handle = await open(filePath, "r");

  try {
    for (const offset of offsets) {
      selectedLines.push({
        index: offset.lineIndex,
        line: await readTranscriptLineAtOffset(handle, offset.byteOffset)
      });
    }
  } finally {
    await handle.close();
  }

  return selectedLines;
}

export async function readCompactTranscriptLinesFromIndexedHints(
  filePath: string,
  snapshot: TranscriptLineIndexSnapshot,
  offset: TranscriptLineOffset,
  sessionId: string
): Promise<TranscriptSlice | null> {
  if (
    snapshot.lineHintsComplete !== true ||
    !snapshot.chatMessageLineOffsets ||
    !snapshot.compactLineSpans ||
    !snapshot.exactLineOffsets
  ) {
    return null;
  }

  const knownLineCount = snapshotLineCount(snapshot);
  const exactLineOffsetsByIndex = new Map<number, TranscriptLineOffset>();
  for (const exactOffset of [
    ...snapshot.chatMessageLineOffsets,
    ...snapshot.exactLineOffsets
  ]) {
    if (
      exactOffset.lineIndex >= offset.lineIndex &&
      exactOffset.lineIndex < knownLineCount
    ) {
      exactLineOffsetsByIndex.set(exactOffset.lineIndex, exactOffset);
    }
  }

  const selectedLines = await readTranscriptLinesByOffsets(
    filePath,
    Array.from(exactLineOffsetsByIndex.values())
      .sort((left, right) => left.lineIndex - right.lineIndex)
  );
  const compactEntries = snapshot.compactLineSpans
    .filter((span) => span.end >= offset.lineIndex)
    .map((span) =>
      createCompactIndexedTranscriptEntryRange({
        endLineIndex: span.end,
        kind: span.kind,
        sessionId,
        startLineIndex: Math.max(span.start, offset.lineIndex),
        timestamp: span.timestamp
      })
    );

  return {
    containsTurnContextLine: selectedLines.some(({ line }) => isTurnContextLine(line.trim())),
    entries: compactEntries,
    indexed: true,
    lineIndexOffset: offset.lineIndex,
    lines: selectedLines,
    readLineCount: Math.max(0, knownLineCount - offset.lineIndex)
  };
}

export async function readCompactTranscriptLinesFromLineOffset(
  filePath: string,
  offset: TranscriptLineOffset,
  sessionId: string,
  endByteOffset?: number
): Promise<TranscriptSlice> {
  const selectedLines: Array<{ index: number; line: string }> = [];
  const compactEntries: AgentTranscriptEntry[] = [];
  let containsTurnContextLine = false;
  let lineIndex = offset.lineIndex;
  let readLineCount = 0;
  let line = createCompactTranscriptLineAccumulator();
  const stream = createReadStream(filePath, {
    start: offset.byteOffset,
    ...(endByteOffset === undefined ? {} : { end: endByteOffset - 1 })
  });

  try {
    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      let lineStart = 0;

      for (let index = 0; index < buffer.length; index += 1) {
        if (buffer[index] !== 10) {
          continue;
        }

        appendCompactTranscriptLineBytes(line, buffer.subarray(lineStart, index));
        const result = finishCompactTranscriptLine(line, sessionId, lineIndex);
        if (result.containsTurnContextLine) {
          containsTurnContextLine = true;
        }
        if (result.selectedLine) {
          selectedLines.push(result.selectedLine);
        }
        if (result.compactEntry) {
          upsertCompactIndexedTranscriptEntry(compactEntries, result.compactEntry);
        }

        line = createCompactTranscriptLineAccumulator();
        lineIndex += 1;
        readLineCount += 1;
        lineStart = index + 1;
      }

      appendCompactTranscriptLineBytes(line, buffer.subarray(lineStart));
    }

    if (hasPendingCompactTranscriptLine(line)) {
      const result = finishCompactTranscriptLine(line, sessionId, lineIndex);
      if (result.containsTurnContextLine) {
        containsTurnContextLine = true;
      }
      if (result.selectedLine) {
        selectedLines.push(result.selectedLine);
      }
      if (result.compactEntry) {
        upsertCompactIndexedTranscriptEntry(compactEntries, result.compactEntry);
      }
      readLineCount += 1;
    }
  } finally {
    stream.destroy();
  }

  return {
    containsTurnContextLine,
    entries: compactEntries,
    indexed: true,
    lineIndexOffset: offset.lineIndex,
    lines: selectedLines,
    readLineCount
  };
}

export {
  readFullTranscriptLineBreakSnapshot,
  readLineBreakSnapshotFromAppendRange
} from "./index/codexTranscriptLineSnapshot.ts";
