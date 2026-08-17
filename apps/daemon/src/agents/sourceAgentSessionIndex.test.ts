import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AgentSessionSummary } from "@deskcue/protocol";

import { createSourceAgentSessionIndex } from "./sourceAgentSessionIndex.ts";

function agentSessionSummary(title: string): AgentSessionSummary {
  return {
    agentId: "codex",
    agentLabel: "Codex",
    attachMode: "resume",
    cliVersion: null,
    filePath: `${title}.jsonl`,
    id: `codex:${title}`,
    model: null,
    originator: null,
    source: "codex",
    sourceSessionId: title,
    title,
    updatedAt: "2026-07-25T00:00:00.000Z",
    workspaceName: "Workspace",
    workspacePath: "D:\\work\\project",
    workState: "idle"
  };
}

test("source agent index serves stale snapshot while refreshing in background", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-source-index-"));
  const cacheKey = `source-index-test-${Date.now()}`;
  const filePath = join(tempDir, "source-agent-index.json");
  const index = createSourceAgentSessionIndex({
    getFilePath: () => filePath,
    getSnapshotTtlMs: () => 1
  });

  let refreshCount = 0;
  const releaseRefreshCallbacks: Array<() => void> = [];

  try {
    const first = await index.readSnapshot({
      cacheKey,
      force: false,
      refresh: async () => {
        refreshCount += 1;
        return [[agentSessionSummary("first")]];
      }
    });
    assert.equal(first.indexSnapshot.readMode, "snapshot-miss");
    assert.equal(first.sessions.flat()[0]?.title, "first");

    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = await index.readSnapshot({
      cacheKey,
      force: false,
      refresh: async () => {
        refreshCount += 1;
        await new Promise<void>((resolve) => {
          releaseRefreshCallbacks.push(resolve);
        });
        return [[agentSessionSummary("second")]];
      }
    });

    assert.equal(second.indexSnapshot.readMode, "snapshot-stale");
    assert.equal(second.indexSnapshot.refreshing, true);
    assert.equal(second.sessions.flat()[0]?.title, "first");

    const third = await index.readSnapshot({
      cacheKey,
      force: false,
      refresh: async () => {
        refreshCount += 1;
        return [[agentSessionSummary("unexpected-third-refresh")]];
      }
    });
    assert.equal(third.indexSnapshot.readMode, "snapshot-stale");
    assert.equal(third.indexSnapshot.refreshing, true);
    assert.equal(refreshCount, 2);

    releaseRefreshCallbacks[0]?.();
    await new Promise((resolve) => setTimeout(resolve, 5));

    const persisted = JSON.parse(await readFile(filePath, "utf8")) as {
      snapshots: Array<{ cacheKey: string }>;
    };
    assert.equal(persisted.snapshots.some((snapshot) => snapshot.cacheKey === cacheKey), true);
    assert.equal(refreshCount, 2);

    const stats = index.readStats();
    assert.equal(stats.filePath, filePath);
    assert.equal(stats.snapshotCount >= 1, true);
  } finally {
    await index.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("source agent index removes disk snapshots stale for more than thirty days", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-source-index-"));
  const filePath = join(tempDir, "source-agent-index.json");
  const index = createSourceAgentSessionIndex({ getFilePath: () => filePath });

  try {
    await writeFile(filePath, JSON.stringify({
      version: 1,
      snapshots: [
        {
          cacheKey: "old",
          cachedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000).toISOString(),
          sessions: [[agentSessionSummary("old")]]
        },
        {
          cacheKey: "recent",
          cachedAt: new Date().toISOString(),
          sessions: [[agentSessionSummary("recent")]]
        }
      ]
    }));

    await index.readSnapshot({
      cacheKey: "new",
      force: false,
      refresh: async () => [[agentSessionSummary("new")]]
    });

    const persisted = JSON.parse(await readFile(filePath, "utf8")) as {
      snapshots: Array<{ cacheKey: string }>;
    };
    assert.deepEqual(
      persisted.snapshots.map((snapshot) => snapshot.cacheKey).sort(),
      ["new", "recent"]
    );
  } finally {
    await index.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("serializes concurrent source index writes and bounds runtime snapshots", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-source-index-"));
  const filePath = join(tempDir, "source-agent-index.json");
  const index = createSourceAgentSessionIndex({ getFilePath: () => filePath });

  try {
    await Promise.all(Array.from({ length: 140 }, (_, itemIndex) => {
      const cacheKey = `concurrent-${String(itemIndex).padStart(3, "0")}`;
      return index.readSnapshot({
        cacheKey,
        force: true,
        refresh: async () => [[agentSessionSummary(cacheKey)]]
      });
    }));

    const persisted = JSON.parse(await readFile(filePath, "utf8")) as {
      snapshots: Array<{ cacheKey: string }>;
      version: number;
    };
    assert.equal(persisted.version, 1);
    assert.equal(persisted.snapshots.length, 128);
    assert.equal(index.readStats().snapshotCount, 128);
  } finally {
    await index.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("evicts old source snapshots when the byte budget is exhausted", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-source-index-"));
  const filePath = join(tempDir, "source-agent-index.json");
  const index = createSourceAgentSessionIndex({
    getFilePath: () => filePath,
    getSnapshotByteLimit: () => 3_000
  });

  try {
    for (const cacheKey of ["first", "second", "third"]) {
      await index.readSnapshot({
        cacheKey,
        force: true,
        refresh: async () => [[agentSessionSummary(`${cacheKey}-${"x".repeat(350)}`)]]
      });
    }

    assert.equal(index.readStats().snapshotCount, 1);
    const persisted = JSON.parse(await readFile(filePath, "utf8")) as {
      snapshots: Array<{ cacheKey: string }>;
    };
    assert.deepEqual(persisted.snapshots.map((snapshot) => snapshot.cacheKey), ["third"]);
  } finally {
    await index.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("deduplicates concurrent cache-miss refreshes per index instance", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-source-index-"));
  const filePath = join(tempDir, "source-agent-index.json");
  const index = createSourceAgentSessionIndex({
    getFilePath: () => filePath,
    getSnapshotTtlMs: () => 60_000
  });
  let refreshCount = 0;
  let releaseRefresh: (() => void) | undefined;
  const refreshStarted = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  let continueRefresh: (() => void) | undefined;
  const refreshBlocked = new Promise<void>((resolve) => {
    continueRefresh = resolve;
  });

  try {
    const firstRead = index.readSnapshot({
      cacheKey: "shared-miss",
      force: false,
      refresh: async () => {
        refreshCount += 1;
        releaseRefresh?.();
        await refreshBlocked;
        return [[agentSessionSummary("deduplicated")]];
      }
    });
    await refreshStarted;
    const secondRead = index.readSnapshot({
      cacheKey: "shared-miss",
      force: false,
      refresh: async () => {
        refreshCount += 1;
        return [[agentSessionSummary("duplicate")]];
      }
    });

    assert.equal(refreshCount, 1);
    assert.equal(index.readStats().refreshingCount, 1);
    continueRefresh?.();
    const [first, second] = await Promise.all([firstRead, secondRead]);
    assert.equal(first.sessions.flat()[0]?.title, "deduplicated");
    assert.equal(second.sessions.flat()[0]?.title, "deduplicated");
    assert.equal(index.readStats().refreshingCount, 0);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("close drains an active refresh and rejects reads after shutdown", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-source-index-"));
  const index = createSourceAgentSessionIndex({
    getFilePath: () => join(tempDir, "source-agent-index.json")
  });
  let releaseRefresh: (() => void) | undefined;
  let markRefreshStarted: (() => void) | undefined;
  const refreshStarted = new Promise<void>((resolve) => {
    markRefreshStarted = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  const read = index.readSnapshot({
    cacheKey: "closing",
    force: true,
    refresh: async () => {
      markRefreshStarted?.();
      await blocked;
      return [[agentSessionSummary("closing")]];
    }
  });

  await refreshStarted;
  const close = index.close();
  releaseRefresh?.();
  await Promise.all([read, close]);

  await assert.rejects(
    index.readSnapshot({
      cacheKey: "after-close",
      force: true,
      refresh: async () => []
    }),
    /closed/
  );
  await rm(tempDir, { force: true, recursive: true });
});

test("keeps cache, load and save lifecycle isolated between instances", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-source-index-"));
  const firstFilePath = join(tempDir, "first.json");
  const secondFilePath = join(tempDir, "second.json");
  const options = (filePath: string) => ({
    getFilePath: () => filePath,
    getSnapshotTtlMs: () => 60_000
  });
  const firstIndex = createSourceAgentSessionIndex(options(firstFilePath));
  const secondIndex = createSourceAgentSessionIndex(options(secondFilePath));

  try {
    await Promise.all([
      firstIndex.readSnapshot({
        cacheKey: "same-key",
        force: false,
        refresh: async () => [[agentSessionSummary("first-instance")]]
      }),
      secondIndex.readSnapshot({
        cacheKey: "same-key",
        force: false,
        refresh: async () => [[agentSessionSummary("second-instance")]]
      })
    ]);
    await Promise.all([firstIndex.waitForIdle(), secondIndex.waitForIdle()]);

    assert.equal(firstIndex.readStats().snapshotCount, 1);
    assert.equal(secondIndex.readStats().snapshotCount, 1);
    const firstDiskState = JSON.parse(await readFile(firstFilePath, "utf8")) as {
      snapshots: Array<{ sessions: AgentSessionSummary[][] }>;
    };
    const secondDiskState = JSON.parse(await readFile(secondFilePath, "utf8")) as {
      snapshots: Array<{ sessions: AgentSessionSummary[][] }>;
    };
    assert.equal(firstDiskState.snapshots[0]?.sessions.flat()[0]?.title, "first-instance");
    assert.equal(secondDiskState.snapshots[0]?.sessions.flat()[0]?.title, "second-instance");

    firstIndex.reset();
    assert.equal(firstIndex.readStats().snapshotCount, 0);
    assert.equal(secondIndex.readStats().snapshotCount, 1);

    const restartedIndex = createSourceAgentSessionIndex(options(secondFilePath));
    const afterRestart = await restartedIndex.readSnapshot({
      cacheKey: "same-key",
      force: false,
      refresh: async () => {
        throw new Error("fresh persisted snapshot should avoid refresh");
      }
    });
    assert.equal(afterRestart.indexSnapshot.storage, "disk");
    assert.equal(afterRestart.sessions.flat()[0]?.title, "second-instance");
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("prunes old source index temp files beside a custom index path", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-source-index-"));
  const customDirectory = join(tempDir, "custom", "nested");
  const filePath = join(customDirectory, "custom-index.json");
  const index = createSourceAgentSessionIndex({ getFilePath: () => filePath });
  const oldTempPath = `${filePath}.123.old-orphan.tmp`;
  const freshTempPath = `${filePath}.456.active-write.tmp`;

  try {
    await mkdir(customDirectory, { recursive: true });
    await Promise.all([
      writeFile(oldTempPath, "old"),
      writeFile(freshTempPath, "fresh")
    ]);
    const oldTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1_000);
    await utimes(oldTempPath, oldTimestamp, oldTimestamp);

    await index.readSnapshot({
      cacheKey: "custom-path",
      force: false,
      refresh: async () => [[agentSessionSummary("custom-path")]]
    });

    await assert.rejects(access(oldTempPath), (error: NodeJS.ErrnoException) =>
      error.code === "ENOENT"
    );
    await access(freshTempPath);
  } finally {
    await index.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});
