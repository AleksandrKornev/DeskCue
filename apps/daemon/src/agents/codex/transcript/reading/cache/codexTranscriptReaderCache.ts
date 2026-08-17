import type { Stats } from "node:fs";

import type {
  AgentTranscriptEntry,
  CodexSessionDetail,
  CodexSessionSummary
} from "@deskcue/protocol";

import {
  ByteBoundedCache,
  cloneCodexSessionDetail,
  estimateCodexSessionDetailBytes,
  estimateTranscriptEntriesBytes
} from "./codexTranscriptCache.ts";
import { dedupeCodexTranscriptEntries } from "../../parsing/codexTranscript.ts";
import { readCompactTranscriptLinesFromLineOffset } from "../codexTranscriptCompactReader.ts";
import type { CodexTranscriptLifecycle } from "../codexTranscriptLifecycle.ts";
import type { CodexTranscriptTailReader } from "../codexTranscriptTailReader.ts";
import { snapshotLineCount } from "../index/codexTranscriptLineIndex.ts";
import {
  extractRuntimeContextFromLines,
  mergeCodexDetailSummary,
  parseTranscript,
  trimIncrementalTranscript
} from "../projection/codexTranscriptProjection.ts";

interface AppendableDetailCacheEntry {
  detail: CodexSessionDetail;
  endsWithLineBreak: boolean;
  lineCount: number;
  mtimeMs: number;
  size: number;
}

interface TranscriptTailWindowCacheEntry {
  entries: AgentTranscriptEntry[];
  mtimeMs: number;
  size: number;
}

export type CodexSessionDetailReadOptions = {
  includeContextCompactionCount?: boolean;
  lineIndexOffset?: "exact" | "tail-relative";
  preferBoundedTail?: boolean;
  readExpandedTailWhenMissingUser?: boolean;
};

const CODEX_DETAIL_CACHE_LIMIT = 8;
const CODEX_DETAIL_CACHE_MAX_BYTES = 8 * 1024 * 1024;
const CODEX_DETAIL_CACHE_MAX_ITEM_BYTES = 2 * 1024 * 1024;
const CODEX_APPENDABLE_DETAIL_CACHE_LIMIT = 4;
const CODEX_APPENDABLE_DETAIL_CACHE_MAX_BYTES = 16 * 1024 * 1024;
const CODEX_APPENDABLE_DETAIL_CACHE_MAX_ITEM_BYTES = 8 * 1024 * 1024;
const CODEX_TRANSCRIPT_TAIL_WINDOW_CACHE_LIMIT = 4;
const CODEX_TRANSCRIPT_TAIL_WINDOW_CACHE_MAX_BYTES = 4 * 1024 * 1024;
const CODEX_TRANSCRIPT_TAIL_WINDOW_CACHE_MAX_ITEM_BYTES = 1 * 1024 * 1024;

export function createCodexTranscriptReaderCache(
  transcriptTailReader: CodexTranscriptTailReader,
  transcriptLifecycle: CodexTranscriptLifecycle
) {
  const detailCache = new ByteBoundedCache<string, CodexSessionDetail>({
    clone: cloneCodexSessionDetail,
    maxBytes: CODEX_DETAIL_CACHE_MAX_BYTES,
    maxEntries: CODEX_DETAIL_CACHE_LIMIT,
    maxItemBytes: CODEX_DETAIL_CACHE_MAX_ITEM_BYTES,
    measure: estimateCodexSessionDetailBytes
  });
  const appendableDetailCache = new ByteBoundedCache<
    string,
    AppendableDetailCacheEntry
  >({
    clone: structuredClone,
    maxBytes: CODEX_APPENDABLE_DETAIL_CACHE_MAX_BYTES,
    maxEntries: CODEX_APPENDABLE_DETAIL_CACHE_LIMIT,
    maxItemBytes: CODEX_APPENDABLE_DETAIL_CACHE_MAX_ITEM_BYTES,
    measure: (entry) => estimateCodexSessionDetailBytes(entry.detail)
  });
  const transcriptTailWindowCache = new ByteBoundedCache<
    string,
    TranscriptTailWindowCacheEntry
  >({
    clone: structuredClone,
    maxBytes: CODEX_TRANSCRIPT_TAIL_WINDOW_CACHE_MAX_BYTES,
    maxEntries: CODEX_TRANSCRIPT_TAIL_WINDOW_CACHE_LIMIT,
    maxItemBytes: CODEX_TRANSCRIPT_TAIL_WINDOW_CACHE_MAX_ITEM_BYTES,
    measure: (entry) => estimateTranscriptEntriesBytes(entry.entries)
  });

  function shouldUseAppendableDetailCache(
    shouldReadTail: boolean,
    options: CodexSessionDetailReadOptions
  ) {
    return (
      shouldReadTail &&
      options.includeContextCompactionCount === false &&
      options.lineIndexOffset !== "tail-relative" &&
      options.preferBoundedTail !== true &&
      options.readExpandedTailWhenMissingUser === false
    );
  }

  async function fileEndsWithLineBreak(filePath: string, fileStat: Stats) {
    if (fileStat.size === 0) {
      return false;
    }

    const buffer = await transcriptLifecycle.readRangeBuffer(
      filePath,
      fileStat.size - 1,
      1
    );
    return buffer[0] === 0x0a;
  }

  async function setAppendableDetailCache(
    key: string,
    filePath: string,
    fileStat: Stats,
    detail: CodexSessionDetail,
    options: {
      lineCount?: number;
    } = {}
  ) {
    const snapshot =
      options.lineCount === undefined
        ? await transcriptTailReader.readTranscriptLineIndexSnapshot(filePath, fileStat)
        : null;
    const lineCount =
      options.lineCount ??
      snapshotLineCount(
        snapshot ?? {
          endsWithLineBreak: false,
          lineBreakCount: 0
        }
      );
    const endsWithLineBreak =
      snapshot?.endsWithLineBreak ??
      (lineCount > 0 && (await fileEndsWithLineBreak(filePath, fileStat)));
    appendableDetailCache.set(key, {
      detail: cloneCodexSessionDetail(detail),
      endsWithLineBreak,
      lineCount,
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size
    });
  }

  async function readAppendableDetailCache(
    key: string,
    {
      chatMessageTail,
      filePath,
      fileStat,
      sessionId,
      summary,
      transcriptTail
    }: {
      chatMessageTail?: number;
      filePath: string;
      fileStat: Stats;
      sessionId: string;
      summary: CodexSessionSummary;
      transcriptTail?: number;
    }
  ) {
    const cached = appendableDetailCache.get(key);
    if (!cached) {
      return null;
    }

    if (fileStat.size < cached.size) {
      appendableDetailCache.delete(key);
      return null;
    }

    if (fileStat.size === cached.size) {
      if (fileStat.mtimeMs !== cached.mtimeMs) {
        appendableDetailCache.delete(key);
        return null;
      }

      return cloneCodexSessionDetail(cached.detail);
    }

    if (!cached.endsWithLineBreak) {
      appendableDetailCache.delete(key);
      return null;
    }

    if (!(await fileEndsWithLineBreak(filePath, fileStat))) {
      appendableDetailCache.delete(key);
      return null;
    }

    const appendSlice = await readCompactTranscriptLinesFromLineOffset(
      filePath,
      {
        byteOffset: cached.size,
        lineIndex: cached.lineCount
      },
      sessionId
    );
    if (appendSlice.containsTurnContextLine) {
      appendableDetailCache.delete(key);
      return null;
    }

    const appendedTranscript = parseTranscript(appendSlice, sessionId);
    const runtimeContext = extractRuntimeContextFromLines(appendSlice.lines ?? []);
    const detail = mergeCodexDetailSummary(cached.detail, summary, runtimeContext);
    detail.transcript = trimIncrementalTranscript(
      dedupeCodexTranscriptEntries([
        ...cached.detail.transcript,
        ...appendedTranscript
      ]),
      {
        chatMessageTail,
        transcriptTail
      }
    );

    await setAppendableDetailCache(key, filePath, fileStat, detail, {
      lineCount: cached.lineCount + (appendSlice.readLineCount ?? 0)
    });
    return cloneCodexSessionDetail(detail);
  }

  function buildDetailCacheKey(
    filePath: string,
    fileStat: Stats,
    transcriptTail?: number,
    chatMessageTail?: number,
    options: CodexSessionDetailReadOptions = {}
  ) {
    return [
      filePath,
      fileStat.size,
      fileStat.mtimeMs,
      transcriptTail ?? "",
      chatMessageTail ?? "",
      options.includeContextCompactionCount === false
        ? "no-context-count"
        : "context-count",
      options.lineIndexOffset ?? "exact",
      options.readExpandedTailWhenMissingUser === false
        ? "no-expanded-tail"
        : "expanded-tail"
    ].join("\u0000");
  }

  function buildAppendableDetailCacheKey(
    filePath: string,
    transcriptTail?: number,
    chatMessageTail?: number
  ) {
    return [
      filePath,
      transcriptTail ?? "",
      chatMessageTail ?? "",
      "lightweight-exact"
    ].join("\u0000");
  }

  function buildTranscriptTailWindowCacheKey(
    filePath: string,
    chatMessageTail?: number
  ) {
    return [filePath, chatMessageTail ?? ""].join("\u0000");
  }

  function readTranscriptTailWindowCache(cacheKey: string, fileStat: Stats) {
    const cached = transcriptTailWindowCache.get(cacheKey);
    if (!cached) {
      return null;
    }

    if (cached.size !== fileStat.size || cached.mtimeMs !== fileStat.mtimeMs) {
      transcriptTailWindowCache.delete(cacheKey);
      return null;
    }

    return structuredClone(cached.entries);
  }

  function setTranscriptTailWindowCache(
    cacheKey: string,
    fileStat: Stats,
    entries: AgentTranscriptEntry[]
  ) {
    transcriptTailWindowCache.set(cacheKey, {
      entries: structuredClone(entries),
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size
    });
  }

  function setDetailCache(key: string, detail: CodexSessionDetail) {
    detailCache.set(key, detail);
  }

  function readDetailCache(key: string) {
    return detailCache.get(key);
  }

  return {
    buildAppendableDetailCacheKey,
    buildDetailCacheKey,
    buildTranscriptTailWindowCacheKey,
    readAppendableDetailCache,
    readDetailCache,
    readTranscriptTailWindowCache,
    setAppendableDetailCache,
    setDetailCache,
    setTranscriptTailWindowCache,
    shouldUseAppendableDetailCache
  };
}
