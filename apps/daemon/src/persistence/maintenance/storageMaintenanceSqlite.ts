import type Database from "better-sqlite3";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";

import { daemonConfig } from "#config/daemonConfig";

import {
  readDataDirectoryBytes,
  readFileSize,
  readLocalChatLibraryStats,
  readLogBytes,
  readMigrationBackupStats
} from "./storageMaintenanceFilesystem.ts";
import {
  countOldAttachedSessions,
  listDuplicateAttachedGroups,
  readInactiveAttachedJsonBytes,
  readInactiveManagedJsonBytes
} from "./storageMaintenanceSessions.ts";
import type {
  StorageMaintenanceResult,
  StorageMaintenanceStats,
  StorageMaintenanceWarning
} from "./storageMaintenanceTypes.ts";
import { openDeskCueSqliteDatabase } from "../connection/sqliteConnection.ts";
import { migrateSqliteDatabase } from "../migrations/sqliteMigrations.ts";

type SessionStatusRow = {
  status: string;
  count: number;
  jsonBytes: number | null;
  maxJsonBytes: number | null;
};

const DEFAULT_AUTO_VACUUM_COOLDOWN_MS = 10 * 60 * 1000;
const MIN_AUTO_VACUUM_FREE_BYTES = 64 * 1024;
const lastAutomaticVacuumAtByDatabase = new Map<string, number>();

export function withMaintenanceDatabase<T>(
  databaseFilePath: string,
  callback: (database: Database.Database) => T
) {
  const database = openDeskCueSqliteDatabase(databaseFilePath);
  migrateSqliteDatabase(database, databaseFilePath);
  try {
    return callback(database);
  } finally {
    database.close();
  }
}

export function calculateAttachedSessionCacheBudget(stats: StorageMaintenanceStats) {
  return Math.max(
    0,
    stats.database.storageLimitBytes -
      Math.max(0, stats.database.serviceUsageBytes - stats.sessions.inactiveAttachedJsonBytes)
  );
}

export function calculateManagedSessionCacheBudget(stats: StorageMaintenanceStats) {
  return Math.max(
    0,
    stats.database.storageLimitBytes -
      Math.max(0, stats.database.serviceUsageBytes - stats.sessions.inactiveManagedJsonBytes)
  );
}

export function shouldRunAutomaticVacuum(
  result: StorageMaintenanceResult,
  databaseFilePath: string,
  nowMs = Date.now()
) {
  if (result.after.database.freeBytes < MIN_AUTO_VACUUM_FREE_BYTES) {
    return false;
  }
  const lastAutomaticVacuumAt = lastAutomaticVacuumAtByDatabase.get(databaseFilePath) ?? 0;
  return nowMs - lastAutomaticVacuumAt >= DEFAULT_AUTO_VACUUM_COOLDOWN_MS;
}

export function recordAutomaticVacuum(databaseFilePath: string, nowMs = Date.now()) {
  lastAutomaticVacuumAtByDatabase.set(databaseFilePath, nowMs);
}

export function mergeStorageMaintenanceResults(
  lightweight: StorageMaintenanceResult,
  compacted: StorageMaintenanceResult
): StorageMaintenanceResult {
  return {
    ...compacted,
    before: lightweight.before,
    compactedAttachedSessionBytes:
      lightweight.compactedAttachedSessionBytes + compacted.compactedAttachedSessionBytes,
    compactedAttachedSessions:
      lightweight.compactedAttachedSessions + compacted.compactedAttachedSessions,
    compactedManagedSessionBytes:
      lightweight.compactedManagedSessionBytes + compacted.compactedManagedSessionBytes,
    compactedManagedSessions:
      lightweight.compactedManagedSessions + compacted.compactedManagedSessions,
    deletedDuplicateAttachedSessions:
      lightweight.deletedDuplicateAttachedSessions + compacted.deletedDuplicateAttachedSessions,
    deletedLogFiles: lightweight.deletedLogFiles + compacted.deletedLogFiles,
    deletedOldAttachedSessions:
      lightweight.deletedOldAttachedSessions + compacted.deletedOldAttachedSessions,
    deletedRevokedAccessDevices:
      lightweight.deletedRevokedAccessDevices + compacted.deletedRevokedAccessDevices,
    deletedTerminalSessions:
      lightweight.deletedTerminalSessions + compacted.deletedTerminalSessions,
    clearedLogBytes: lightweight.clearedLogBytes + compacted.clearedLogBytes,
    durations: {
      checkpointBeforeMs:
        lightweight.durations.checkpointBeforeMs + compacted.durations.checkpointBeforeMs,
      checkpointAfterMs:
        lightweight.durations.checkpointAfterMs + compacted.durations.checkpointAfterMs,
      optimizeMs: lightweight.durations.optimizeMs + compacted.durations.optimizeMs,
      pruneLogsMs: lightweight.durations.pruneLogsMs + compacted.durations.pruneLogsMs,
      pruneMs: lightweight.durations.pruneMs + compacted.durations.pruneMs,
      vacuumMs: lightweight.durations.vacuumMs + compacted.durations.vacuumMs,
      totalMs: lightweight.durations.totalMs + compacted.durations.totalMs
    }
  };
}

function readPageStats(database: Database.Database) {
  const pageCount = database.pragma("page_count", { simple: true }) as number;
  const pageSize = database.pragma("page_size", { simple: true }) as number;
  const freelistCount = database.pragma("freelist_count", { simple: true }) as number;
  return {
    pageCount,
    pageSize,
    freelistCount,
    freeBytes: freelistCount * pageSize
  };
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)}${units[unitIndex]}`;
}

export function buildStorageWarnings(
  stats: StorageMaintenanceStats,
  storageMaxBytes: number
): StorageMaintenanceWarning[] {
  const warnings: StorageMaintenanceWarning[] = [];
  if (stats.database.serviceUsageBytes > storageMaxBytes) {
    warnings.push({
      code: "storage.size",
      message: `DeskCue service data uses ${formatBytes(stats.database.serviceUsageBytes)} of its ${formatBytes(storageMaxBytes)} limit. Run storage compaction when no sessions are running.`
    });
  }
  if (stats.database.freeBytes > 10 * 1024 * 1024) {
    warnings.push({
      code: "storage.free-pages",
      message: `SQLite has ${formatBytes(stats.database.freeBytes)} of reclaimable pages.`
    });
  }
  if (stats.sessions.duplicateAttachedSessions > 0) {
    warnings.push({
      code: "sessions.duplicate-attached",
      message: `${stats.sessions.duplicateAttachedSessions} duplicate attached session shell${stats.sessions.duplicateAttachedSessions === 1 ? "" : "s"} can be pruned.`
    });
  }
  if (stats.sessions.oldAttachedSessions > 0) {
    warnings.push({
      code: "sessions.old-attached",
      message: `${stats.sessions.oldAttachedSessions} old attached session shell${stats.sessions.oldAttachedSessions === 1 ? "" : "s"} can be pruned.`
    });
  }
  return warnings;
}

export function readStorageStats(
  database: Database.Database,
  databaseFilePath: string,
  options: {
    now: Date;
    storageMaxBytes: number;
    oldAttachedSessionRetentionMs: number;
    localChatLibraryPath?: string;
  }
): StorageMaintenanceStats {
  const pageStats = readPageStats(database);
  const sessionTotals = database.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(LENGTH(json)), 0) AS jsonBytes
    FROM sessions
  `).get() as { count: number; jsonBytes: number | null };
  const sessionStatusRows = database.prepare(`
    SELECT
      status,
      COUNT(*) AS count,
      COALESCE(SUM(LENGTH(json)), 0) AS jsonBytes,
      COALESCE(MAX(LENGTH(json)), 0) AS maxJsonBytes
    FROM sessions
    GROUP BY status
    ORDER BY jsonBytes DESC, count DESC
  `).all() as SessionStatusRow[];
  const duplicateGroups = listDuplicateAttachedGroups(database);
  const inactiveAttachedJsonBytes = readInactiveAttachedJsonBytes(database);
  const inactiveManagedJsonBytes = readInactiveManagedJsonBytes(database);
  const dataDirectory = dirname(databaseFilePath);
  const migrationBackups = readMigrationBackupStats(dataDirectory);
  const totalBytes = readDataDirectoryBytes(dataDirectory);
  const oldAttachedSessions = countOldAttachedSessions(
    database,
    options.oldAttachedSessionRetentionMs,
    options.now
  );
  const accessDevices = database.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN revoked_at IS NOT NULL THEN 1 ELSE 0 END) AS revoked
    FROM access_devices
  `).get() as { total: number; active: number | null; revoked: number | null };

  const stats: StorageMaintenanceStats = {
    database: {
      path: databaseFilePath,
      bytes: readFileSize(databaseFilePath),
      walBytes: readFileSize(`${databaseFilePath}-wal`),
      shmBytes: readFileSize(`${databaseFilePath}-shm`),
      logBytes: readLogBytes(dataDirectory),
      serviceUsageBytes: Math.max(0, totalBytes - migrationBackups.bytes),
      totalBytes,
      storageLimitBytes: options.storageMaxBytes,
      pageCount: pageStats.pageCount,
      pageSize: pageStats.pageSize,
      freelistCount: pageStats.freelistCount,
      freeBytes: pageStats.freeBytes
    },
    localChats: readLocalChatLibraryStats(
      options.localChatLibraryPath ?? daemonConfig.localChatLibraryPath
    ),
    migrationBackups,
    sessions: {
      total: sessionTotals.count,
      jsonBytes: sessionTotals.jsonBytes ?? 0,
      duplicateAttachedGroups: duplicateGroups.length,
      duplicateAttachedSessions: duplicateGroups.reduce(
        (total, group) => total + Math.max(0, group.count - 1),
        0
      ),
      inactiveAttachedJsonBytes,
      inactiveManagedJsonBytes,
      oldAttachedSessions,
      byStatus: sessionStatusRows.map((row) => ({
        status: row.status,
        count: row.count,
        jsonBytes: row.jsonBytes ?? 0,
        maxJsonBytes: row.maxJsonBytes ?? 0
      })),
      duplicateGroups: duplicateGroups.map((row) => ({
        adapterId: row.adapterId,
        sourceSessionId: row.sourceSessionId,
        count: row.count,
        jsonBytes: row.jsonBytes ?? 0
      }))
    },
    accessDevices: {
      total: accessDevices.total,
      active: accessDevices.active ?? 0,
      revoked: accessDevices.revoked ?? 0
    },
    warnings: []
  };
  stats.warnings = buildStorageWarnings(stats, options.storageMaxBytes);
  return stats;
}

function elapsedMs(startedAt: number) {
  return Math.round(performance.now() - startedAt);
}

export function compactMaintenanceDatabase(database: Database.Database) {
  const checkpointBeforeStartedAt = performance.now();
  database.pragma("wal_checkpoint(TRUNCATE)");
  const checkpointBeforeMs = elapsedMs(checkpointBeforeStartedAt);

  const vacuumStartedAt = performance.now();
  database.exec("VACUUM");
  const vacuumMs = elapsedMs(vacuumStartedAt);

  const checkpointAfterStartedAt = performance.now();
  database.pragma("wal_checkpoint(TRUNCATE)");
  const checkpointAfterMs = elapsedMs(checkpointAfterStartedAt);

  const optimizeStartedAt = performance.now();
  database.pragma("optimize");
  const optimizeMs = elapsedMs(optimizeStartedAt);

  return { checkpointBeforeMs, checkpointAfterMs, optimizeMs, vacuumMs };
}
