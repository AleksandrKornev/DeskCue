import { open, stat } from "node:fs/promises";

export type ClaudeTranscriptLine = {
  index: number | string;
  line: string;
};

const CLAUDE_TRANSCRIPT_READ_CHUNK_BYTES = 256 * 1024;
const CLAUDE_TRANSCRIPT_MAX_TAIL_BYTES = 8 * 1024 * 1024;
const CLAUDE_TRANSCRIPT_MAX_RECORD_BYTES = 2 * 1024 * 1024;
const CLAUDE_TRANSCRIPT_WINDOW_BYTES = 2 * 1024 * 1024;

async function readLineAtOffset(
  handle: Awaited<ReturnType<typeof open>>,
  offset: number,
  fileSize: number
): Promise<ClaudeTranscriptLine | null> {
  const length = Math.min(CLAUDE_TRANSCRIPT_MAX_RECORD_BYTES + 1, fileSize - offset);
  const buffer = Buffer.allocUnsafe(length);
  const { bytesRead } = await handle.read(buffer, 0, length, offset);
  const value = buffer.subarray(0, bytesRead);
  const newline = value.indexOf(10);
  const end = newline >= 0 ? newline : value.length;
  if (end === 0 || (newline < 0 && offset + bytesRead < fileSize)) return null;
  const lineEnd = value[end - 1] === 13 ? end - 1 : end;
  return {
    index: `b${offset}`,
    line: value.subarray(0, lineEnd).toString("utf8")
  } satisfies ClaudeTranscriptLine;
}

export async function readClaudeTranscriptLinesAtOffsets(
  filePath: string,
  byteOffsets: ReadonlySet<number>
) {
  if (byteOffsets.size === 0) return [];
  const fileSize = (await stat(filePath)).size;
  const handle = await open(filePath, "r");
  try {
    const lines = await Promise.all([...byteOffsets]
      .filter((offset) => offset >= 0 && offset < fileSize)
      .map(async (offset) => readLineAtOffset(handle, offset, fileSize)));
    return lines.filter((line): line is ClaudeTranscriptLine => line !== null);
  } finally {
    await handle.close();
  }
}

function splitCompleteLines(buffer: Buffer, baseOffset: number): ClaudeTranscriptLine[] {
  const lines: ClaudeTranscriptLine[] = [];
  let lineStart = 0;
  for (let index = 0; index <= buffer.length; index += 1) {
    if (index < buffer.length && buffer[index] !== 10) continue;
    let lineEnd = index;
    if (lineEnd > lineStart && buffer[lineEnd - 1] === 13) lineEnd -= 1;
    const byteLength = lineEnd - lineStart;
    if (byteLength > 0 && byteLength <= CLAUDE_TRANSCRIPT_MAX_RECORD_BYTES) {
      lines.push({
        index: `b${baseOffset + lineStart}`,
        line: buffer.subarray(lineStart, lineEnd).toString("utf8")
      });
    }
    lineStart = index + 1;
  }
  return lines;
}

export async function readClaudeTranscriptTailLines(
  filePath: string,
  isComplete: (lines: ClaudeTranscriptLine[]) => boolean
) {
  const fileSize = (await stat(filePath)).size;
  if (fileSize === 0) return [];

  const handle = await open(filePath, "r");
  let collected: ClaudeTranscriptLine[] = [];
  let position = fileSize;
  let remainder = Buffer.alloc(0);
  let scannedBytes = 0;
  try {
    while (position > 0 && scannedBytes < CLAUDE_TRANSCRIPT_MAX_TAIL_BYTES) {
      const readLength = Math.min(
        CLAUDE_TRANSCRIPT_READ_CHUNK_BYTES,
        position,
        CLAUDE_TRANSCRIPT_MAX_TAIL_BYTES - scannedBytes
      );
      const start = position - readLength;
      const chunk = Buffer.allocUnsafe(readLength);
      const { bytesRead } = await handle.read(chunk, 0, readLength, start);
      if (bytesRead === 0) break;
      scannedBytes += bytesRead;

      const combined = Buffer.concat([chunk.subarray(0, bytesRead), remainder]);
      const firstLineBreak = combined.indexOf(10);
      if (start === 0) {
        collected = [
          ...splitCompleteLines(combined, 0),
          ...collected
        ];
        remainder = Buffer.alloc(0);
      } else if (firstLineBreak >= 0) {
        collected = [
          ...splitCompleteLines(combined.subarray(firstLineBreak + 1), start + firstLineBreak + 1),
          ...collected
        ];
        remainder = combined.subarray(0, firstLineBreak);
      } else {
        remainder = combined;
      }
      position = start;

      if (collected.length > 0 && isComplete(collected)) break;
    }
  } finally {
    await handle.close();
  }

  return collected;
}

async function readRange(filePath: string, requestedStart: number, end: number) {
  const handle = await open(filePath, "r");
  try {
    const length = Math.max(0, end - requestedStart);
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, requestedStart);
    const value = buffer.subarray(0, bytesRead);
    let start = 0;
    let baseOffset = requestedStart;
    let startsAtLineBoundary = requestedStart === 0;
    if (requestedStart > 0) {
      const previousByte = Buffer.allocUnsafe(1);
      const previousRead = await handle.read(previousByte, 0, 1, requestedStart - 1);
      startsAtLineBoundary = previousRead.bytesRead === 1 && previousByte[0] === 10;
    }
    if (!startsAtLineBoundary) {
      const firstBreak = value.indexOf(10);
      if (firstBreak < 0) return [];
      start = firstBreak + 1;
      baseOffset += start;
    }
    return splitCompleteLines(value.subarray(start), baseOffset);
  } finally {
    await handle.close();
  }
}

export async function readClaudeTranscriptWindowLines(
  filePath: string,
  baseByteOffset: number,
  options: { maxLineCount?: number; overlapLineCount?: number } = {}
) {
  const fileSize = (await stat(filePath)).size;
  if (baseByteOffset < 0 || baseByteOffset >= fileSize) return null;
  const overlapLineCount = Math.max(0, options.overlapLineCount ?? 96);
  const maxLineCount = Math.max(1, options.maxLineCount ?? 1024);
  const start = Math.max(0, baseByteOffset - CLAUDE_TRANSCRIPT_WINDOW_BYTES);
  const end = Math.min(fileSize, baseByteOffset + CLAUDE_TRANSCRIPT_WINDOW_BYTES);
  const lines = await readRange(filePath, start, end);
  const baseIndex = lines.findIndex((line) => line.index === `b${baseByteOffset}`);
  if (baseIndex < 0) return null;
  const windowStart = Math.max(0, baseIndex - overlapLineCount);
  return lines.slice(windowStart, windowStart + maxLineCount);
}

export async function readClaudeTranscriptPreviousLines(
  filePath: string,
  beforeByteOffset: number
) {
  const fileSize = (await stat(filePath)).size;
  if (beforeByteOffset <= 0 || beforeByteOffset > fileSize) return null;
  const start = Math.max(0, beforeByteOffset - CLAUDE_TRANSCRIPT_WINDOW_BYTES);
  const lines = await readRange(filePath, start, beforeByteOffset);
  const maxLineCount = 1_024;
  const retained = lines.slice(-maxLineCount);
  return {
    hasMore: start > 0 || retained.length < lines.length,
    lines: retained
  };
}
