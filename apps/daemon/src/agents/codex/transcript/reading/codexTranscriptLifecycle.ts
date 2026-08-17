import { createReadStream } from "node:fs";
import type { Stats } from "node:fs";
import { open, stat } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

import { logger } from "#infrastructure/logging/logger";

import { isContextCompactedLine, isTurnContextLine } from "../parsing/codexTranscript.ts";
import { setBoundedCache } from "./cache/codexTranscriptCache.ts";
import type { CodexTranscriptLineIndex } from "./index/codexTranscriptLineIndex.ts";

const CODEX_LIFECYCLE_CACHE_LIMIT = 16;
const CODEX_RETAINED_LIFECYCLE_LINES = 8;

type TranscriptLifecycleSnapshot = {
  compactionCount: number;
  mtimeMs: number;
  retainedLines: string[];
  size: number;
};

export class CodexTranscriptLifecycle {
  private readonly snapshotCache = new Map<string, TranscriptLifecycleSnapshot>();
  private readonly snapshotRequests = new Map<string, Promise<void>>();

  constructor(private readonly lineIndex: CodexTranscriptLineIndex) {}

  async countContextCompactionMarkers(filePath: string, fileStat?: Stats) {
    return (await this.readSnapshot(filePath, fileStat)).compactionCount;
  }

  async readKnownContextCompactionCount(
    filePath: string,
    fileStat: Stats,
    fallback: number
  ) {
    const lifecycleSnapshot = this.snapshotCache.get(filePath);
    if (lifecycleSnapshot && lifecycleSnapshot.size <= fileStat.size) {
      this.scheduleRefresh(filePath, fileStat);
      return lifecycleSnapshot.compactionCount;
    }

    const lineBreakSnapshot = await this.lineIndex.readCachedSnapshot(filePath);
    if (
      lineBreakSnapshot &&
      lineBreakSnapshot.size <= fileStat.size &&
      Number.isFinite(lineBreakSnapshot.contextCompactionCount)
    ) {
      const snapshot = {
        compactionCount: lineBreakSnapshot.contextCompactionCount ?? fallback,
        mtimeMs: lineBreakSnapshot.mtimeMs,
        retainedLines: [],
        size: lineBreakSnapshot.size
      } satisfies TranscriptLifecycleSnapshot;
      setBoundedCache(this.snapshotCache, filePath, snapshot, CODEX_LIFECYCLE_CACHE_LIMIT);
      this.scheduleRefresh(filePath, fileStat);
      return snapshot.compactionCount;
    }

    this.scheduleRefresh(filePath, fileStat);
    return fallback;
  }

  async readRangeBuffer(filePath: string, start: number, length: number) {
    if (length <= 0) return Buffer.alloc(0);

    const handle = await open(filePath, "r");
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  private scheduleRefresh(filePath: string, fileStat: Stats) {
    if (this.snapshotRequests.has(filePath)) return;

    const request = this.readSnapshot(filePath, fileStat)
      .then(async (snapshot) => {
        await this.lineIndex.updateContextCompactionCount(filePath, snapshot);
      })
      .catch((error) => {
        logger.warn("Failed to refresh Codex context compaction index", {
          filePath,
          message: error instanceof Error ? error.message : String(error)
        });
      })
      .finally(() => {
        this.snapshotRequests.delete(filePath);
      });
    this.snapshotRequests.set(filePath, request);
  }

  private async readSnapshot(
    filePath: string,
    providedStat?: Stats
  ): Promise<TranscriptLifecycleSnapshot> {
    const fileStat = providedStat ?? await stat(filePath);
    const cached = this.snapshotCache.get(filePath);

    if (cached && cached.size === fileStat.size) {
      if (cached.mtimeMs !== fileStat.mtimeMs) {
        const updated = { ...cached, mtimeMs: fileStat.mtimeMs };
        setBoundedCache(this.snapshotCache, filePath, updated, CODEX_LIFECYCLE_CACHE_LIMIT);
        return updated;
      }
      return cached;
    }

    if (cached && cached.size < fileStat.size) {
      const rawAppend = await this.readRange(
        filePath,
        cached.size,
        fileStat.size - cached.size
      );
      const appendSnapshot = this.readSnapshotFromRaw(rawAppend, {
        compactionCount: cached.compactionCount,
        retainedLines: cached.retainedLines
      });
      const nextSnapshot = {
        compactionCount: appendSnapshot.compactionCount,
        mtimeMs: fileStat.mtimeMs,
        retainedLines: appendSnapshot.retainedLines,
        size: fileStat.size
      } satisfies TranscriptLifecycleSnapshot;
      setBoundedCache(this.snapshotCache, filePath, nextSnapshot, CODEX_LIFECYCLE_CACHE_LIMIT);
      return nextSnapshot;
    }

    const nextSnapshot = await this.readFullSnapshot(filePath, fileStat);
    setBoundedCache(this.snapshotCache, filePath, nextSnapshot, CODEX_LIFECYCLE_CACHE_LIMIT);
    return nextSnapshot;
  }

  private async readFullSnapshot(filePath: string, fileStat: Stats) {
    let count = 0;
    let retainedLines: string[] = [];
    const lines = createInterface({
      crlfDelay: Infinity,
      input: createReadStream(filePath, { encoding: "utf-8" })
    });

    try {
      for await (const line of lines) {
        const trimmed = line.trim();
        if (isContextCompactedLine(trimmed)) count += 1;
        if (isContextCompactedLine(trimmed) || isTurnContextLine(trimmed)) {
          retainedLines = this.retainRecentLines([...retainedLines, trimmed]);
        }
      }
    } finally {
      lines.close();
    }

    return {
      compactionCount: count,
      mtimeMs: fileStat.mtimeMs,
      retainedLines,
      size: fileStat.size
    } satisfies TranscriptLifecycleSnapshot;
  }

  private readSnapshotFromRaw(
    raw: string,
    seed: Pick<TranscriptLifecycleSnapshot, "compactionCount" | "retainedLines">
  ) {
    let compactionCount = seed.compactionCount;
    let retainedLines = seed.retainedLines;

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (isContextCompactedLine(trimmed)) compactionCount += 1;
      if (isContextCompactedLine(trimmed) || isTurnContextLine(trimmed)) {
        retainedLines = this.retainRecentLines([...retainedLines, trimmed]);
      }
    }

    return { compactionCount, retainedLines };
  }

  private retainRecentLines(lines: string[]) {
    return lines.slice(-CODEX_RETAINED_LIFECYCLE_LINES);
  }

  private async readRange(filePath: string, start: number, length: number) {
    if (length <= 0) return "";

    const handle = await open(filePath, "r");
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      return buffer.subarray(0, bytesRead).toString("utf-8");
    } finally {
      await handle.close();
    }
  }
}
