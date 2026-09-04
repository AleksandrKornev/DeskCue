import assert from "node:assert/strict";
import type { Stats } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { daemonConfig } from "#config/daemonConfig";

import {
  CodexTranscriptLineIndex,
  findNearestTranscriptByteOffset,
  findNearestTranscriptLineOffset,
  snapshotLineCount
} from "./codexTranscriptLineIndex.ts";
import type { TranscriptLineIndexSnapshot } from "./codexTranscriptLineIndex.ts";

function fileStat(size: number, mtimeMs: number): Stats {
  return { size, mtimeMs } as Stats;
}

function snapshot(size: number, mtimeMs: number): TranscriptLineIndexSnapshot {
  return {
    endsWithLineBreak: true,
    lineBreakCount: size,
    mtimeMs,
    size
  };
}

test("owns append, truncate, concurrent request, offset, and durable v13 semantics", async () => {
  const originalDatabaseFilePath = daemonConfig.databaseFilePath;
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-line-index-"));

  daemonConfig.databaseFilePath = path.join(tempDir, "data", "deskcue.sqlite");

  let fullScans = 0;
  let appendScans = 0;
  let releaseFirstScan: (() => void) | undefined;
  const firstScanGate = new Promise<void>((resolve) => {
    releaseFirstScan = resolve;
  });
  const index = new CodexTranscriptLineIndex({
    async readAppendSnapshot(cached, _filePath, options) {
      appendScans += 1;
      assert.equal(options.appendStartByteOffset, cached.size);
      return snapshot(options.size, options.mtimeMs);
    },
    async readFullSnapshot(_filePath, stat) {
      fullScans += 1;
      if (fullScans === 1) await firstScanGate;

      return snapshot(stat.size, stat.mtimeMs);
    }
  });

  try {
    const initialStat = fileStat(4, 1);
    const first = index.readSnapshot("session.jsonl", initialStat, { requireOffsets: false });
    const concurrent = index.readSnapshot("session.jsonl", initialStat, { requireOffsets: false });

    releaseFirstScan?.();

    assert.deepEqual(await Promise.all([first, concurrent]), [snapshot(4, 1), snapshot(4, 1)]);
    assert.equal(fullScans, 1);

    assert.deepEqual(await index.readSnapshot("session.jsonl", fileStat(7, 2)), snapshot(7, 2));
    assert.equal(appendScans, 1);

    assert.deepEqual(await index.readSnapshot("session.jsonl", fileStat(3, 3)), snapshot(3, 3));
    assert.equal(fullScans, 2);

    assert.equal(snapshotLineCount({ endsWithLineBreak: true, lineBreakCount: 3 }), 3);
    assert.equal(snapshotLineCount({ endsWithLineBreak: false, lineBreakCount: 3 }), 4);
    const offsets = [
      { byteOffset: 0, lineIndex: 0 },
      { byteOffset: 40, lineIndex: 4 },
      { byteOffset: 90, lineIndex: 9 }
    ];

    assert.deepEqual(findNearestTranscriptLineOffset(offsets, 7), offsets[1]);
    assert.deepEqual(findNearestTranscriptByteOffset(offsets, 89), offsets[1]);

    const persisted = JSON.parse(
      await readFile(path.join(tempDir, "data", "codex-transcript-line-counts.json"), "utf8")
    ) as { snapshots?: Array<{ filePath?: string; size?: number }>; version?: number };

    assert.equal(persisted.version, 13);
    assert.deepEqual(persisted.snapshots, [
      {
        endsWithLineBreak: true,
        filePath: "session.jsonl",
        lineBreakCount: 3,
        mtimeMs: 3,
        size: 3
      }
    ]);
  } finally {
    daemonConfig.databaseFilePath = originalDatabaseFilePath;
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("caches full-history hints beyond the legacy 64-entry limit", async () => {
  const originalDatabaseFilePath = daemonConfig.databaseFilePath;
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-line-index-hints-"));
  const compactLineSpans = Array.from({ length: 65 }, (_, index) => ({
    end: index * 2,
    kind: index % 2 === 0 ? "changes" as const : "tools" as const,
    start: index * 2,
    timestamp: `2026-09-02T12:00:${String(index % 60).padStart(2, "0")}.000Z`
  }));
  const exactLineOffsets = Array.from({ length: 65 }, (_, index) => ({
    byteOffset: index * 100,
    lineIndex: index * 2 + 1
  }));

  daemonConfig.databaseFilePath = path.join(tempDir, "data", "deskcue.sqlite");

  let fullScans = 0;
  const index = new CodexTranscriptLineIndex({
    async readAppendSnapshot(cached) {
      return cached;
    },
    async readFullSnapshot(_filePath, stat) {
      fullScans += 1;
      return {
        chatMessageLineOffsets: [],
        compactLineSpans,
        endsWithLineBreak: true,
        exactLineOffsets,
        lineHintsComplete: true,
        lineBreakCount: 130,
        mtimeMs: stat.mtimeMs,
        size: stat.size
      };
    }
  });
  const options = { requireLineHints: true };

  try {
    const first = await index.readSnapshot("long-session.jsonl", fileStat(10_000, 1), options);
    const second = await index.readSnapshot("long-session.jsonl", fileStat(10_000, 1), options);

    assert.equal(fullScans, 1);
    assert.equal(first.compactLineSpans?.length, 65);
    assert.equal(second.exactLineOffsets?.length, 65);

    const persisted = JSON.parse(
      await readFile(path.join(tempDir, "data", "codex-transcript-line-counts.json"), "utf8")
    ) as { snapshots?: Array<TranscriptLineIndexSnapshot> };

    assert.equal(persisted.snapshots?.[0]?.compactLineSpans?.length, 65);
    assert.equal(persisted.snapshots?.[0]?.lineHintsComplete, true);
  } finally {
    daemonConfig.databaseFilePath = originalDatabaseFilePath;
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("rebuilds version 12 indexes with incomplete large-chat offsets", async () => {
  const originalDatabaseFilePath = daemonConfig.databaseFilePath;
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-line-index-upgrade-"));
  const dataDir = path.join(tempDir, "data");

  daemonConfig.databaseFilePath = path.join(dataDir, "deskcue.sqlite");
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    path.join(dataDir, "codex-transcript-line-counts.json"),
    JSON.stringify({
      snapshots: [{
        endsWithLineBreak: true,
        filePath: "session.jsonl",
        lineBreakCount: 4,
        mtimeMs: 1,
        size: 4
      }],
      updatedAt: "2026-09-02T10:00:00.000Z",
      version: 12
    }),
    "utf8"
  );

  let fullScans = 0;
  const index = new CodexTranscriptLineIndex({
    async readAppendSnapshot(_cached, _filePath, options) {
      return snapshot(options.size, options.mtimeMs);
    },
    async readFullSnapshot(_filePath, stat) {
      fullScans += 1;
      return snapshot(stat.size, stat.mtimeMs);
    }
  });

  try {
    assert.deepEqual(
      await index.readSnapshot("session.jsonl", fileStat(4, 1)),
      snapshot(4, 1)
    );

    assert.equal(fullScans, 1);

    const persisted = JSON.parse(
      await readFile(path.join(dataDir, "codex-transcript-line-counts.json"), "utf8")
    ) as { version?: number };

    assert.equal(persisted.version, 13);
  } finally {
    daemonConfig.databaseFilePath = originalDatabaseFilePath;
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("rebuilds line hints when a previously partial final line grows", async () => {
  const originalDatabaseFilePath = daemonConfig.databaseFilePath;
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-line-index-"));

  daemonConfig.databaseFilePath = path.join(tempDir, "data", "deskcue.sqlite");

  let fullScans = 0;
  let appendScans = 0;
  const index = new CodexTranscriptLineIndex({
    async readAppendSnapshot(_cached, _filePath, options) {
      appendScans += 1;
      return snapshot(options.size, options.mtimeMs);
    },
    async readFullSnapshot(_filePath, stat) {
      fullScans += 1;
      if (fullScans === 1) {
        return {
          chatMessageLineOffsets: [],
          compactLineSpans: [],
          endsWithLineBreak: false,
          exactLineOffsets: [],
          lineHintsComplete: true,
          lineBreakCount: 1,
          mtimeMs: stat.mtimeMs,
          size: stat.size
        };
      }

      return {
        ...snapshot(stat.size, stat.mtimeMs),
        chatMessageLineOffsets: [{ byteOffset: 10, lineIndex: 1 }],
        compactLineSpans: [],
        exactLineOffsets: [],
        lineHintsComplete: true
      };
    }
  });

  try {
    const options = {
      requireChatMessageOffsets: true,
      requireLineHints: true
    };

    const partial = await index.readSnapshot("partial-final.jsonl", fileStat(10, 1), options);
    const completed = await index.readSnapshot("partial-final.jsonl", fileStat(20, 2), options);

    assert.equal(partial.endsWithLineBreak, false);
    assert.equal(completed.endsWithLineBreak, true);
    assert.equal(fullScans, 2);
    assert.equal(appendScans, 0);
  } finally {
    daemonConfig.databaseFilePath = originalDatabaseFilePath;
    await rm(tempDir, { force: true, recursive: true });
  }
});
