import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { clearDaemonLogs, pruneDaemonLogFiles } from "./storageMaintenanceFilesystem.ts";
import {
  buildStorageWarnings,
  mergeStorageMaintenanceResults,
  recordAutomaticVacuum,
  shouldRunAutomaticVacuum
} from "./storageMaintenanceSqlite.ts";
import type {
  StorageMaintenanceResult,
  StorageMaintenanceStats
} from "./storageMaintenanceTypes.ts";

test("log maintenance rotates an oversized current log and cleanup leaves unrelated files", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "deskcue-log-policy-"));
  const logDirectory = join(dataDirectory, "logs");
  const currentLog = join(logDirectory, "daemon.jsonl");
  const rotatedLog = join(logDirectory, "daemon.jsonl.1");
  const unrelated = join(logDirectory, "keep.txt");

  try {
    await mkdir(logDirectory, { recursive: true });
    await writeFile(currentLog, "x".repeat(3 * 1024 * 1024 + 1));
    await writeFile(rotatedLog, "old");
    await writeFile(unrelated, "keep");

    assert.equal(pruneDaemonLogFiles(dataDirectory, Number.MAX_SAFE_INTEGER), 0);
    assert.equal(existsSync(currentLog), false);
    assert.equal((await readFile(rotatedLog)).length, 3 * 1024 * 1024 + 1);

    await writeFile(currentLog, "new-current");
    const cleared = clearDaemonLogs(dataDirectory);
    assert.equal(cleared.deletedFiles, 1);
    assert.equal(cleared.clearedBytes, 3 * 1024 * 1024 + 1 + "new-current".length);
    assert.equal((await stat(currentLog)).size, 0);
    assert.equal(await readFile(unrelated, "utf8"), "keep");
  } finally {
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

function maintenanceStats(overrides: {
  duplicateAttachedSessions?: number;
  freeBytes?: number;
  oldAttachedSessions?: number;
  serviceUsageBytes?: number;
  storageLimitBytes?: number;
  totalBytes?: number;
} = {}): StorageMaintenanceStats {
  return {
    database: {
      path: "state.sqlite",
      bytes: overrides.totalBytes ?? 0,
      walBytes: 0,
      shmBytes: 0,
      logBytes: 0,
      serviceUsageBytes: overrides.serviceUsageBytes ?? overrides.totalBytes ?? 0,
      totalBytes: overrides.totalBytes ?? 0,
      storageLimitBytes: overrides.storageLimitBytes ?? 50 * 1024 * 1024,
      pageCount: 0,
      pageSize: 4096,
      freelistCount: 0,
      freeBytes: overrides.freeBytes ?? 0
    },
    localChats: { path: "chats", bytes: 0, chatCount: 0 },
    migrationBackups: { bytes: 0, count: 0 },
    sessions: {
      total: 0,
      jsonBytes: 0,
      duplicateAttachedGroups: 0,
      duplicateAttachedSessions: overrides.duplicateAttachedSessions ?? 0,
      inactiveAttachedJsonBytes: 0,
      inactiveManagedJsonBytes: 0,
      oldAttachedSessions: overrides.oldAttachedSessions ?? 0,
      byStatus: [],
      duplicateGroups: []
    },
    accessDevices: { total: 0, active: 0, revoked: 0 },
    warnings: []
  };
}

test("maintenance warnings preserve codes and user-facing text after stats extraction", () => {
  const stats = maintenanceStats({
    duplicateAttachedSessions: 1,
    freeBytes: 11 * 1024 * 1024,
    oldAttachedSessions: 2,
    serviceUsageBytes: 2 * 1024 * 1024,
    storageLimitBytes: 1024 * 1024
  });

  assert.deepEqual(buildStorageWarnings(stats, 1024 * 1024), [
    {
      code: "storage.size",
      message: "DeskCue service data uses 2.00MB of its 1.00MB limit. Run storage compaction when no sessions are running."
    },
    {
      code: "storage.free-pages",
      message: "SQLite has 11.0MB of reclaimable pages."
    },
    {
      code: "sessions.duplicate-attached",
      message: "1 duplicate attached session shell can be pruned."
    },
    {
      code: "sessions.old-attached",
      message: "2 old attached session shells can be pruned."
    }
  ]);
});

function maintenanceResult(overrides: {
  after?: StorageMaintenanceStats;
  before?: StorageMaintenanceStats;
  compacted?: boolean;
  compactedAttachedSessionBytes?: number;
  deletedLogFiles?: number;
  pruneMs?: number;
  totalMs?: number;
  vacuumMs?: number;
} = {}): StorageMaintenanceResult {
  return {
    before: overrides.before ?? maintenanceStats(),
    after: overrides.after ?? maintenanceStats(),
    compacted: overrides.compacted ?? false,
    compactedAttachedSessionBytes: overrides.compactedAttachedSessionBytes ?? 0,
    compactedAttachedSessions: 0,
    compactedManagedSessionBytes: 0,
    compactedManagedSessions: 0,
    deletedDuplicateAttachedSessions: 0,
    deletedLogFiles: overrides.deletedLogFiles ?? 0,
    deletedOldAttachedSessions: 0,
    deletedRevokedAccessDevices: 0,
    deletedTerminalSessions: 0,
    clearedLogBytes: 0,
    durations: {
      checkpointBeforeMs: 0,
      checkpointAfterMs: 0,
      optimizeMs: 0,
      pruneLogsMs: 0,
      pruneMs: overrides.pruneMs ?? 0,
      vacuumMs: overrides.vacuumMs ?? 0,
      totalMs: overrides.totalMs ?? 0
    }
  };
}

test("maintenance merge preserves first-pass baseline and combines counters and durations", () => {
  const lightweight = maintenanceResult({
    before: maintenanceStats({ totalBytes: 100 }),
    after: maintenanceStats({ totalBytes: 80 }),
    compactedAttachedSessionBytes: 11,
    deletedLogFiles: 2,
    pruneMs: 3,
    totalMs: 5
  });
  const compacted = maintenanceResult({
    before: maintenanceStats({ totalBytes: 80 }),
    after: maintenanceStats({ totalBytes: 60 }),
    compacted: true,
    compactedAttachedSessionBytes: 7,
    deletedLogFiles: 1,
    pruneMs: 4,
    totalMs: 9,
    vacuumMs: 6
  });

  const merged = mergeStorageMaintenanceResults(lightweight, compacted);

  assert.equal(merged.before.database.totalBytes, 100);
  assert.equal(merged.after.database.totalBytes, 60);
  assert.equal(merged.compacted, true);
  assert.equal(merged.compactedAttachedSessionBytes, 18);
  assert.equal(merged.deletedLogFiles, 3);
  assert.equal(merged.durations.pruneMs, 7);
  assert.equal(merged.durations.vacuumMs, 6);
  assert.equal(merged.durations.totalMs, 14);
});

test("automatic vacuum requires the free-page threshold and observes cooldown", () => {
  const databasePath = `vacuum-policy-${Date.now()}.sqlite`;
  const belowThreshold = maintenanceResult({
    after: maintenanceStats({ freeBytes: 64 * 1024 - 1 })
  });
  const atThreshold = maintenanceResult({
    after: maintenanceStats({ freeBytes: 64 * 1024 })
  });

  assert.equal(shouldRunAutomaticVacuum(belowThreshold, databasePath, 1_000_000), false);
  assert.equal(shouldRunAutomaticVacuum(atThreshold, databasePath, 1_000_000), true);
  recordAutomaticVacuum(databasePath, 1_000_000);
  assert.equal(shouldRunAutomaticVacuum(atThreshold, databasePath, 1_599_999), false);
  assert.equal(shouldRunAutomaticVacuum(atThreshold, databasePath, 1_600_000), true);
});
