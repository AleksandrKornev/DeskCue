import { createReadStream } from "node:fs";
import type { Stats } from "node:fs";
import { open, stat } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

import { findNearestTranscriptLineOffset } from "./index/codexTranscriptLineIndex.ts";
import type {
  CodexTranscriptLineIndex,
  TranscriptLineIndexReadOptions,
  TranscriptLineOffset
} from "./index/codexTranscriptLineIndex.ts";
import type { TranscriptSlice } from "./projection/codexTranscriptProjection.ts";

type TranscriptWindowLineIndex = Pick<
  CodexTranscriptLineIndex,
  "readSnapshot"
>;

export type CodexTranscriptWindowIo = ReturnType<typeof createCodexTranscriptWindowIo>;

export function createCodexTranscriptWindowIo(
  transcriptLineIndex: TranscriptWindowLineIndex
) {

  async function findTranscriptTailWindowStartByteOffset(
    filePath: string,
    targetStartByteOffset: number,
    maxBacktrackBytes: number
  ) {
    if (targetStartByteOffset <= 0) {
      return 0;
    }

    const handle = await open(filePath, "r");
    let searchEndByteOffset = targetStartByteOffset;
    let searchedBytes = 0;

    try {
      while (
        searchEndByteOffset > 0 &&
        searchedBytes < maxBacktrackBytes
      ) {
        const readLength = Math.min(64 * 1024, searchEndByteOffset);
        const chunkStartByteOffset = searchEndByteOffset - readLength;
        const buffer = Buffer.alloc(readLength);
        const { bytesRead } = await handle.read(
          buffer,
          0,
          readLength,
          chunkStartByteOffset
        );
        if (bytesRead <= 0) {
          break;
        }

        const chunk = buffer.subarray(0, bytesRead);
        const lineBreakIndex = chunk.lastIndexOf(10);
        if (lineBreakIndex >= 0) {
          return chunkStartByteOffset + lineBreakIndex + 1;
        }

        searchedBytes += bytesRead;
        searchEndByteOffset = chunkStartByteOffset;
      }
    } finally {
      await handle.close();
    }

    return targetStartByteOffset;
  }

  async function readTranscriptLinesByWindowIndexes(
    filePath: string,
    byteOffset: number,
    lineIndexes: Set<number>
  ) {
    const targetIndexes = Array.from(lineIndexes)
      .filter((lineIndex) => lineIndex >= 0)
      .sort((left, right) => left - right);
    const targetIndexSet = new Set(targetIndexes);
    const maxTargetIndex = targetIndexes.at(-1);
    const selectedLines: Array<{ index: number; line: string }> = [];

    if (maxTargetIndex === undefined) {
      return selectedLines;
    }

    const lines = createInterface({
      crlfDelay: Infinity,
      input: createReadStream(filePath, {
        encoding: "utf-8",
        start: byteOffset
      })
    });
    let lineIndex = 0;

    try {
      for await (const line of lines) {
        if (targetIndexSet.has(lineIndex)) {
          selectedLines.push({
            index: lineIndex,
            line
          });
        }

        if (lineIndex >= maxTargetIndex) {
          break;
        }

        lineIndex += 1;
      }
    } finally {
      lines.close();
    }

    return selectedLines;
  }

  async function readTranscriptLinesFromLineOffset(
    filePath: string,
    offset: TranscriptLineOffset
  ): Promise<TranscriptSlice> {
    const lines = createInterface({
      crlfDelay: Infinity,
      input: createReadStream(filePath, {
        encoding: "utf-8",
        start: offset.byteOffset
      })
    });
    const selectedLines: Array<{ index: number; line: string }> = [];
    let lineIndex = offset.lineIndex;

    try {
      for await (const line of lines) {
        selectedLines.push({
          index: lineIndex,
          line
        });
        lineIndex += 1;
      }
    } finally {
      lines.close();
    }

    return {
      lineIndexOffset: offset.lineIndex,
      lines: selectedLines
    };
  }

  function readTranscriptLineIndexSnapshot(
    filePath: string,
    fileStat: Stats,
    options: TranscriptLineIndexReadOptions = {}
  ) {
    return transcriptLineIndex.readSnapshot(filePath, fileStat, options);
  }
  async function readCodexTranscriptLineByteOffset(
    filePath: string,
    fileStat: Stats,
    lineIndex: number | null
  ) {
    if (lineIndex === null || lineIndex < 0) {
      return null;
    }

    const snapshot = await readTranscriptLineIndexSnapshot(filePath, fileStat, {
      requireOffsets: true
    });
    const nearestOffset = findNearestTranscriptLineOffset(snapshot.lineOffsets, lineIndex);
    if (nearestOffset.lineIndex === lineIndex) {
      return nearestOffset.byteOffset;
    }

    const handle = await open(filePath, "r");
    const buffer = Buffer.alloc(64 * 1024);
    let byteOffset = nearestOffset.byteOffset;
    let remainingLineBreaks = lineIndex - nearestOffset.lineIndex;

    try {
      while (remainingLineBreaks > 0 && byteOffset < fileStat.size) {
        const { bytesRead } = await handle.read(
          buffer,
          0,
          Math.min(buffer.length, fileStat.size - byteOffset),
          byteOffset
        );
        if (bytesRead <= 0) {
          return null;
        }

        for (let index = 0; index < bytesRead; index += 1) {
          if (buffer[index] !== 10) {
            continue;
          }

          remainingLineBreaks -= 1;
          if (remainingLineBreaks === 0) {
            return byteOffset + index + 1;
          }
        }

        byteOffset += bytesRead;
      }
    } finally {
      await handle.close();
    }

    return remainingLineBreaks === 0 ? byteOffset : null;
  }

  async function readTranscriptLinesByIndexes(
    filePath: string,
    lineIndexes: Set<number>
  ) {
    const fileStat = await stat(filePath);
    const lineIndexSnapshot = await readTranscriptLineIndexSnapshot(filePath, fileStat, {
      requireOffsets: true
    });
    const knownLineCount = lineIndexSnapshot.lineBreakCount + 1;
    const targetIndexes = Array.from(lineIndexes)
      .filter((lineIndex) => lineIndex >= 0 && lineIndex < knownLineCount)
      .sort((left, right) => left - right);
    const targetIndexSet = new Set(targetIndexes);
    const minTargetIndex = targetIndexes[0];
    const maxTargetIndex = targetIndexes.at(-1);
    const selectedLines: Array<{ index: number; line: string }> = [];

    if (minTargetIndex === undefined || maxTargetIndex === undefined) {
      return selectedLines;
    }

    const nearestOffset = findNearestTranscriptLineOffset(
      lineIndexSnapshot.lineOffsets,
      minTargetIndex
    );
    const lines = createInterface({
      crlfDelay: Infinity,
      input: createReadStream(filePath, {
        encoding: "utf-8",
        start: nearestOffset.byteOffset
      })
    });
    let lineIndex = nearestOffset.lineIndex;

    try {
      for await (const line of lines) {
        if (targetIndexSet.has(lineIndex)) {
          selectedLines.push({
            index: lineIndex,
            line
          });
        }

        if (lineIndex >= maxTargetIndex) {
          break;
        }

        lineIndex += 1;
      }
    } finally {
      lines.close();
    }

    return selectedLines;
  }

  return {
    findTranscriptTailWindowStartByteOffset,
    readCodexTranscriptLineByteOffset,
    readTranscriptLineIndexSnapshot,
    readTranscriptLinesByIndexes,
    readTranscriptLinesByWindowIndexes,
    readTranscriptLinesFromLineOffset
  };
}
