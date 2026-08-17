import { createReadStream } from "node:fs";
import type { Stats } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

import {
  CODEX_TRANSCRIPT_EXPANDED_TAIL_READ_BYTES,
  CODEX_TRANSCRIPT_TAIL_READ_BYTES
} from "./codexTranscriptReadLimits.ts";
import type { CodexTranscriptLineIndex } from "./index/codexTranscriptLineIndex.ts";
import type { TranscriptSlice } from "./projection/codexTranscriptProjection.ts";
import {
  extractCodexRuntimeContext,
  extractCodexRuntimeContextLine
} from "../../runtime/codexRuntimeContext.ts";
import type { CodexSessionRuntimeContext } from "../../runtime/codexRuntimeContext.ts";

export type TranscriptLineIndexOffsetMode = "exact" | "tail-relative";

type TranscriptRawTailLineIndex = Pick<
  CodexTranscriptLineIndex,
  "countLineBreaks"
>;

export type CodexTranscriptRawTailIo = ReturnType<typeof createCodexTranscriptRawTailIo>;

function countLineBreaks(value: string) {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) {
      count += 1;
    }
  }
  return count;
}

export function createCodexTranscriptRawTailIo(
  transcriptLineIndex: TranscriptRawTailLineIndex
) {

  async function readTranscriptRawTail(filePath: string, readBytes: number) {
    const fileStat = await stat(filePath);
    if (fileStat.size <= readBytes) {
      return readFile(filePath, "utf-8");
    }

    const start = Math.max(0, fileStat.size - readBytes);
    const length = fileStat.size - start;
    const handle = await open(filePath, "r");

    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      const chunk = buffer.subarray(0, bytesRead).toString("utf-8");
      const firstLineBreak = chunk.search(/\r?\n/);
      if (firstLineBreak < 0) {
        return chunk;
      }

      const skippedPartialLineLength =
        firstLineBreak +
        (chunk[firstLineBreak] === "\r" && chunk[firstLineBreak + 1] === "\n" ? 2 : 1);
      return chunk.slice(skippedPartialLineLength);
    } finally {
      await handle.close();
    }
  }
  async function readCodexRuntimeContext(filePath: string) {
    const tailContext = extractCodexRuntimeContext(
      await readTranscriptRawTail(filePath, CODEX_TRANSCRIPT_EXPANDED_TAIL_READ_BYTES)
    );
    if (tailContext) {
      return tailContext;
    }

    let latestContext: CodexSessionRuntimeContext | null = null;
    const lines = createInterface({
      crlfDelay: Infinity,
      input: createReadStream(filePath, {
        encoding: "utf-8"
      })
    });

    try {
      for await (const line of lines) {
        const context = extractCodexRuntimeContextLine(line);
        if (context) {
          latestContext = context;
        }
      }
    } finally {
      lines.close();
    }

    return latestContext;
  }

  async function readTranscriptTail(
    filePath: string,
    readBytes = CODEX_TRANSCRIPT_TAIL_READ_BYTES,
    providedStat?: Stats,
    options: {
      lineIndexOffset?: TranscriptLineIndexOffsetMode;
    } = {}
  ): Promise<TranscriptSlice> {
    const fileStat = providedStat ?? await stat(filePath);
    if (fileStat.size <= readBytes) {
      return {
        lineIndexOffset: 0,
        raw: await readFile(filePath, "utf-8")
      };
    }

    const start = Math.max(0, fileStat.size - readBytes);
    const length = fileStat.size - start;
    const handle = await open(filePath, "r");

    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      const chunk = buffer.subarray(0, bytesRead).toString("utf-8");
      const firstLineBreak = chunk.search(/\r?\n/);
      const skippedPartialLine =
        firstLineBreak >= 0
          ? chunk.slice(
              0,
              firstLineBreak +
                (chunk[firstLineBreak] === "\r" && chunk[firstLineBreak + 1] === "\n" ? 2 : 1)
            )
          : "";
      const raw = firstLineBreak >= 0
        ? chunk.slice(skippedPartialLine.length)
        : chunk;
      const lineIndexOffset =
        options.lineIndexOffset === "tail-relative"
          ? 0
          : Math.max(
              0,
              (await transcriptLineIndex.countLineBreaks(filePath, fileStat)) -
                countLineBreaks(raw)
            );

      return {
        lineIndexOffset,
        raw
      };
    } finally {
      await handle.close();
    }
  }

  return {
    readCodexRuntimeContext,
    readTranscriptRawTail,
    readTranscriptTail
  };
}
