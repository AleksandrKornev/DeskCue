import { readFile, stat } from "node:fs/promises";

import type {
  AgentSessionSourceVersion,
  AgentTranscriptEntry,
  CodexSessionDetail,
  CodexSessionSummary
} from "@deskcue/protocol";
import { logger } from "#infrastructure/logging/logger";

import { createCodexTranscriptReaderCache } from "./cache/codexTranscriptReaderCache.ts";
import type { CodexSessionDetailReadOptions } from "./cache/codexTranscriptReaderCache.ts";
import { CodexTranscriptLifecycle } from "./codexTranscriptLifecycle.ts";
import { CODEX_TRANSCRIPT_EXPANDED_TAIL_READ_BYTES } from "./codexTranscriptReadLimits.ts";
import { createCodexTranscriptTailReader } from "./codexTranscriptTailReader.ts";
import {
  CodexTranscriptLineIndex,
  findNearestTranscriptLineOffset,
  snapshotLineCount
} from "./index/codexTranscriptLineIndex.ts";
import {
  readFullTranscriptLineBreakSnapshot,
  readLineBreakSnapshotFromAppendRange
} from "./index/codexTranscriptLineSnapshot.ts";
import {
  buildCodexTranscriptWindowSessionId,
  extractCodexRuntimeContextFromTranscriptSlice,
  parseTranscript,
  readCodexSourceEntryLineIndex,
  readCodexTranscriptEntryRefs,
  readCodexTranscriptWindowEntryRef,
  readTranscriptEntryLineIndex
} from "./projection/codexTranscriptProjection.ts";
import {
  markSourceAgentDetailMetadata,
  readSourceAgentDetailMetadata
} from "../../../sourceAgentDetailMetadata.ts";
import type { SourceAgentDetailReadMode } from "../../../sourceAgentDetailMetadata.ts";
import { listDiscoveredCodexSessions, loadCodexDiscovery } from "../../discovery/codexDiscovery.ts";
import type { CodexSessionRuntimeContext } from "../../runtime/codexRuntimeContext.ts";
import {
  dedupeCodexTranscriptEntries,
  parseCodexTranscriptSelectedLines
} from "../parsing/codexTranscript.ts";

export type { CodexSessionRuntimeContext };

type CodexSessionSourceVersion = Omit<AgentSessionSourceVersion, "summary"> & {
  summary: CodexSessionSummary;
};

export type CodexSessionDetailReadMode = SourceAgentDetailReadMode;

const transcriptLineIndex = new CodexTranscriptLineIndex({
  readAppendSnapshot: readLineBreakSnapshotFromAppendRange,
  readFullSnapshot: readFullTranscriptLineBreakSnapshot
});
const transcriptLifecycle = new CodexTranscriptLifecycle(transcriptLineIndex);
const transcriptTailReader = createCodexTranscriptTailReader(
  transcriptLineIndex,
  transcriptLifecycle
);
const transcriptReadCache = createCodexTranscriptReaderCache(
  transcriptTailReader,
  transcriptLifecycle
);

export function readCodexSessionDetailReadMode(
  detail: CodexSessionDetail | null | undefined
): CodexSessionDetailReadMode | null {
  return readSourceAgentDetailMetadata(detail)?.readMode ?? null;
}

export async function listCodexSessions(limit = 12, force = false) {
  return listDiscoveredCodexSessions(limit, force);
}

export async function getCodexSessionVersion(
  sessionId: string,
  force = false
): Promise<CodexSessionSourceVersion | null> {
  const discovery = await loadCodexDiscovery(force);
  const summary = discovery.summaries.find((item) => item.id === sessionId);
  const filePath = discovery.filesById.get(sessionId);
  if (!summary || !filePath) {
    return null;
  }

  const fileStat = await stat(filePath);
  const sourceFileMtimeMs = fileStat.mtimeMs;
  const sourceFileSizeBytes = fileStat.size;
  const contextCompactionCount = await transcriptLifecycle.readKnownContextCompactionCount(
    filePath,
    fileStat,
    summary.contextCompactionCount ?? 0
  );
  const versionSummary = {
    ...summary,
    contextCompactionCount
  };

  return {
    summary: versionSummary,
    sourceFileMtimeMs,
    sourceFileSizeBytes,
    sourceVersion: JSON.stringify({
      filePath,
      contextCompactionCount,
      sourceFileMtimeMs,
      sourceFileSizeBytes
    })
  };
}

export async function getCodexSessionRuntimeContext(
  sessionId: string
): Promise<CodexSessionRuntimeContext | null> {
  const discovery = await loadCodexDiscovery();
  const filePath = discovery.filesById.get(sessionId);

  if (!filePath) {
    return null;
  }

  try {
    return await transcriptTailReader.readCodexRuntimeContext(filePath);
  } catch (error) {
    logger.warn("Failed to read Codex runtime context", {
      sessionId,
      filePath,
      message: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

export async function getCodexTranscriptEntries(
  sessionId: string,
  entryIds: string[],
  force = false
): Promise<AgentTranscriptEntry[]> {
  const discovery = await loadCodexDiscovery(force);
  const filePath = discovery.filesById.get(sessionId);
  if (!filePath) {
    return [];
  }

  const entryRefs = readCodexTranscriptEntryRefs(sessionId, entryIds);
  const transcriptEntries: AgentTranscriptEntry[] = [];

  if (entryRefs.exactLineIndexes.size > 0) {
    const lines = await transcriptTailReader.readTranscriptLinesByIndexes(filePath, entryRefs.exactLineIndexes);
    transcriptEntries.push(...parseCodexTranscriptSelectedLines(lines, sessionId));
  }

  for (const [byteOffset, lineIndexes] of entryRefs.windowLineIndexesByByteOffset) {
    const windowSessionId = buildCodexTranscriptWindowSessionId(sessionId, byteOffset);
    const lines = await transcriptTailReader.readTranscriptLinesByWindowIndexes(filePath, byteOffset, lineIndexes);
    transcriptEntries.push(...parseCodexTranscriptSelectedLines(lines, windowSessionId));
  }

  return dedupeCodexTranscriptEntries(transcriptEntries);
}

export async function getCodexTranscriptWindow(
  sessionId: string,
  baseSourceEntryId: string,
  options: {
    force?: boolean;
    maxLineCount?: number;
    overlapLineCount?: number;
  } = {}
): Promise<AgentTranscriptEntry[] | null> {
  const discovery = await loadCodexDiscovery(options.force ?? false);
  const filePath = discovery.filesById.get(sessionId);
  if (!filePath) {
    return null;
  }

  const windowRef = readCodexTranscriptWindowEntryRef(sessionId, baseSourceEntryId);
  if (windowRef) {
    return transcriptTailReader.getCodexTranscriptWindowFromByteOffset(filePath, windowRef, options);
  }

  const baseLineIndex = readCodexSourceEntryLineIndex(sessionId, baseSourceEntryId);
  if (baseLineIndex === null) {
    return null;
  }

  const fileStat = await stat(filePath);
  const lineIndexSnapshot = await transcriptTailReader.readTranscriptLineIndexSnapshot(filePath, fileStat, {
    requireOffsets: true
  });
  const knownLineCount = snapshotLineCount(lineIndexSnapshot);
  if (baseLineIndex >= knownLineCount) {
    return null;
  }

  const overlapLineCount = Math.max(0, options.overlapLineCount ?? 96);
  const startLineIndex = Math.max(0, baseLineIndex - overlapLineCount);
  const maxLineCount = Math.max(1, options.maxLineCount ?? 1024);
  if (knownLineCount - startLineIndex > maxLineCount) {
    return null;
  }

  const transcriptSlice = await transcriptTailReader.readCompactTranscriptLinesFromLineOffset(
    filePath,
    findNearestTranscriptLineOffset(lineIndexSnapshot.lineOffsets, startLineIndex),
    sessionId
  );
  const entries = parseTranscript(transcriptSlice, sessionId);
  return entries.filter((entry) => {
    const lineIndex = readTranscriptEntryLineIndex(entry);
    return lineIndex === null || lineIndex >= startLineIndex;
  });
}

export async function getCodexTranscriptTailWindow(
  sessionId: string,
  options: {
    chatMessageTail?: number;
    force?: boolean;
  } = {}
): Promise<AgentTranscriptEntry[] | null> {
  const discovery = await loadCodexDiscovery(options.force ?? false);
  const filePath = discovery.filesById.get(sessionId);
  if (!filePath) {
    return null;
  }

  const fileStat = await stat(filePath);
  const cacheKey = transcriptReadCache.buildTranscriptTailWindowCacheKey(
    filePath,
    options.chatMessageTail
  );
  const cached = options.force ? null : transcriptReadCache.readTranscriptTailWindowCache(cacheKey, fileStat);
  if (cached) {
    return cached;
  }
  const tailWindow = await transcriptTailReader.readCompactTranscriptTailWindowForLimits(
    filePath,
    fileStat,
    sessionId,
    {
      chatMessageTail: options.chatMessageTail
    }
  );
  if (!tailWindow) {
    return null;
  }

  const transcript = parseTranscript(tailWindow.transcriptSlice, sessionId, {
    chatMessageTail: options.chatMessageTail
  });
  transcriptReadCache.setTranscriptTailWindowCache(cacheKey, fileStat, transcript);
  return transcript;
}

export async function getCodexTranscriptPreviousWindow(
  sessionId: string,
  beforeEntryId: string,
  options: {
    force?: boolean;
  } = {}
): Promise<{ entries: AgentTranscriptEntry[]; hasMore: boolean } | null> {
  const discovery = await loadCodexDiscovery(options.force ?? false);
  const filePath = discovery.filesById.get(sessionId);
  const windowRef = filePath
    ? readCodexTranscriptWindowEntryRef(sessionId, beforeEntryId)
    : null;
  const directLineIndex = filePath
    ? readCodexSourceEntryLineIndex(sessionId, beforeEntryId)
    : null;
  if (!filePath) {
    return null;
  }

  const fileStat = await stat(filePath);
  const endByteOffset = windowRef?.byteOffset ?? await transcriptTailReader.readCodexTranscriptLineByteOffset(
    filePath,
    fileStat,
    directLineIndex
  );
  if (endByteOffset === null || endByteOffset <= 0 || endByteOffset >= fileStat.size) {
    return null;
  }
  const historyWindow = await transcriptTailReader.readCompactTranscriptWindowBeforeByteOffset(
    filePath,
    sessionId,
    endByteOffset
  );
  if (!historyWindow) {
    return null;
  }

  return {
    entries: parseTranscript(historyWindow.transcriptSlice, historyWindow.windowSessionId),
    hasMore: historyWindow.windowStartByteOffset > 0
  };
}

function markCodexSessionDetailReadMode(
  detail: CodexSessionDetail,
  readMode: CodexSessionDetailReadMode
) {
  return markSourceAgentDetailMetadata(detail, { readMode });
}

function hasUserTranscriptEntry(transcript: CodexSessionDetail["transcript"]) {
  return transcript.some((entry) => entry.role === "user");
}

function isPositiveLimit(value: number | undefined) {
  return value !== undefined && value > 0;
}

export async function getCodexSessionDetail(
  sessionId: string,
  force = false,
  transcriptTail?: number,
  chatMessageTail?: number,
  options: CodexSessionDetailReadOptions = {}
): Promise<CodexSessionDetail | null> {
  const discovery = await loadCodexDiscovery(force);
  const summary = discovery.summaries.find((item) => item.id === sessionId);
  const filePath = discovery.filesById.get(sessionId);

  if (!summary || !filePath) {
    return null;
  }

  const shouldReadTail = isPositiveLimit(transcriptTail) || isPositiveLimit(chatMessageTail);
  const fileStat = shouldReadTail ? await stat(filePath) : null;
  const shouldUseIndexedLightweightDetail = transcriptReadCache.shouldUseAppendableDetailCache(
    shouldReadTail,
    options
  );
  const detailCacheKey = shouldReadTail && fileStat && !shouldUseIndexedLightweightDetail
    ? transcriptReadCache.buildDetailCacheKey(filePath, fileStat, transcriptTail, chatMessageTail, options)
    : null;
  const cachedDetail = detailCacheKey && !force
    ? transcriptReadCache.readDetailCache(detailCacheKey)
    : null;
  if (cachedDetail) {
    return markCodexSessionDetailReadMode(
      cachedDetail,
      "detail-cache"
    );
  }

  const appendableDetailCacheKey = shouldUseIndexedLightweightDetail
    ? transcriptReadCache.buildAppendableDetailCacheKey(filePath, transcriptTail, chatMessageTail)
    : null;
  const appendableDetail = appendableDetailCacheKey && fileStat && !force
    ? await transcriptReadCache.readAppendableDetailCache(appendableDetailCacheKey, {
        chatMessageTail,
        filePath,
        fileStat,
        sessionId,
        summary,
        transcriptTail
      })
    : null;
  if (appendableDetail) {
    return markCodexSessionDetailReadMode(appendableDetail, "append-cache");
  }

  let transcriptSlice = shouldReadTail
    ? await transcriptTailReader.readTranscriptTailForLimits(filePath, {
        allowIndexedTail: options.preferBoundedTail !== true,
        chatMessageTail,
        compactActivityLines: shouldUseIndexedLightweightDetail,
        fileStat: fileStat ?? undefined,
        lineIndexOffset: options.lineIndexOffset ?? "exact",
        sessionId
      })
    : {
        lineIndexOffset: 0,
        raw: await readFile(filePath, "utf-8")
      };
  let transcript = parseTranscript(transcriptSlice, sessionId, {
    chatMessageTail,
    transcriptTail
  });
  if (
    shouldReadTail &&
    options.readExpandedTailWhenMissingUser !== false &&
    !hasUserTranscriptEntry(transcript)
  ) {
    transcriptSlice = await transcriptTailReader.readTranscriptTail(
      filePath,
      CODEX_TRANSCRIPT_EXPANDED_TAIL_READ_BYTES,
      fileStat ?? undefined,
      {
        lineIndexOffset: options.lineIndexOffset ?? "exact"
      }
    );
    transcript = parseTranscript(transcriptSlice, sessionId, {
      chatMessageTail,
      transcriptTail
    });
  }
  const runtimeContext = extractCodexRuntimeContextFromTranscriptSlice(transcriptSlice);
  const contextCompactionCount =
    options.includeContextCompactionCount === false
      ? shouldReadTail && fileStat
        ? await transcriptLifecycle.readKnownContextCompactionCount(
            filePath,
            fileStat,
            summary.contextCompactionCount ?? 0
          )
        : summary.contextCompactionCount ?? 0
      : shouldReadTail
        ? await transcriptLifecycle.countContextCompactionMarkers(filePath, fileStat ?? undefined)
        : transcript.filter((entry) => entry.phase === "context_compacted").length;

  const detail = {
    ...summary,
    approvalPolicy: runtimeContext?.approvalPolicy ?? summary.approvalPolicy,
    contextCompactionCount,
    model: runtimeContext?.model ?? summary.model,
    sandboxMode: runtimeContext?.sandboxMode ?? summary.sandboxMode,
    transcript
  };

  if (detailCacheKey && !force) {
    transcriptReadCache.setDetailCache(detailCacheKey, detail);
  }

  if (appendableDetailCacheKey && fileStat && !force) {
    await transcriptReadCache.setAppendableDetailCache(appendableDetailCacheKey, filePath, fileStat, detail);
  }

  return markCodexSessionDetailReadMode(
    detail,
    transcriptSlice.indexed ? "indexed-detail" : "bounded-detail"
  );
}
