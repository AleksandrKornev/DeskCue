import { dirname } from "node:path";
import { performance } from "node:perf_hooks";

import { daemonConfig } from "#config/daemonConfig";
import { logger } from "#infrastructure/logging/logger";

import {
  clearDaemonLogs,
  clearMigrationBackupFiles,
  pruneDaemonLogFiles,
  readPositiveIntegerEnv
} from "./storageMaintenanceFilesystem.ts";
import { pruneExpiredMaintenanceRecords } from "./storageMaintenanceRecords.ts";
import { startStorageMaintenanceSchedulerLoop } from "./storageMaintenanceScheduler.ts";
import {
  compactInactiveAttachedSessionCache,
  compactInactiveManagedSessionCache,
  pruneDuplicateAttachedSessions,
  pruneOldAttachedSessions,
  pruneRevokedAccessDevices,
  pruneTerminalSessions,
  purgeTerminalSessions
} from "./storageMaintenanceSessions.ts";
import {
  calculateAttachedSessionCacheBudget,
  calculateManagedSessionCacheBudget,
  compactMaintenanceDatabase,
  mergeStorageMaintenanceResults,
  readStorageStats,
  recordAutomaticVacuum,
  shouldRunAutomaticVacuum,
  withMaintenanceDatabase
} from "./storageMaintenanceSqlite.ts";
import type {
  MigrationBackupCleanupResult,
  StorageMaintenanceOptions,
  StorageMaintenanceResult,
  StorageMaintenanceStats
} from "./storageMaintenanceTypes.ts";
import { runStorageMaintenanceInWorker } from "./storageMaintenanceWorkerClient.ts";

export type {
  MigrationBackupCleanupResult,
  StorageMaintenanceOptions,
  StorageMaintenanceResult,
  StorageMaintenanceStats,
  StorageMaintenanceWarning
} from "./storageMaintenanceTypes.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REVOKED_ACCESS_DEVICE_RETENTION_MS = 30 * DAY_MS;
const DEFAULT_OLD_ATTACHED_SESSION_RETENTION_MS = 30 * DAY_MS;
const DEFAULT_TERMINAL_SESSION_RETENTION_MS = 7 * DAY_MS;
const DEFAULT_MAX_TERMINAL_SESSIONS = 1_000;
const DEFAULT_STORAGE_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_LIGHTWEIGHT_MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function startStorageMaintenanceScheduler(
  options: StorageMaintenanceOptions = {},
  runtime: { isQuiescent?: () => boolean } = {}
) {
  return startStorageMaintenanceSchedulerLoop({
    intervalMs: readPositiveIntegerEnv(
      "DESKCUE_STORAGE_MAINTENANCE_INTERVAL_MS",
      DEFAULT_LIGHTWEIGHT_MAINTENANCE_INTERVAL_MS
    ),
    runMaintenance: () => runStorageMaintenanceInWorker(options, {
      allowAutomaticVacuum: runtime.isQuiescent?.() ?? false
    })
  });
}

function logMaintenanceCompleted(result: StorageMaintenanceResult, databaseFilePath: string) {
  logger.info("Storage maintenance completed", {
    compacted: result.compacted,
    compactedAttachedSessionBytes: result.compactedAttachedSessionBytes,
    compactedAttachedSessions: result.compactedAttachedSessions,
    compactedManagedSessionBytes: result.compactedManagedSessionBytes,
    compactedManagedSessions: result.compactedManagedSessions,
    databaseFile: databaseFilePath,
    deletedDuplicateAttachedSessions: result.deletedDuplicateAttachedSessions,
    deletedLogFiles: result.deletedLogFiles,
    deletedOldAttachedSessions: result.deletedOldAttachedSessions,
    deletedRevokedAccessDevices: result.deletedRevokedAccessDevices,
    deletedTerminalSessions: result.deletedTerminalSessions,
    clearedLogBytes: result.clearedLogBytes,
    freeBytesBefore: result.before.database.freeBytes,
    freeBytesAfter: result.after.database.freeBytes,
    totalBytesAfter: result.after.database.totalBytes,
    totalMs: result.durations.totalMs
  });
}

function readStorageMaxBytes() {
  return daemonConfig.storageMaxBytes || DEFAULT_STORAGE_MAX_BYTES;
}

export function readStorageMaintenanceStats(
  databaseFilePath = daemonConfig.databaseFilePath,
  options: { localChatLibraryPath?: string } = {}
): StorageMaintenanceStats {
  const oldAttachedSessionRetentionMs =
    readPositiveIntegerEnv(
      "DESKCUE_ATTACHED_SESSION_RETENTION_DAYS",
      DEFAULT_OLD_ATTACHED_SESSION_RETENTION_MS / DAY_MS
    ) * DAY_MS;
  return withMaintenanceDatabase(databaseFilePath, (database) =>
    readStorageStats(database, databaseFilePath, {
      now: new Date(),
      storageMaxBytes: readStorageMaxBytes(),
      oldAttachedSessionRetentionMs,
      localChatLibraryPath: options.localChatLibraryPath ?? daemonConfig.localChatLibraryPath
    })
  );
}

export function clearMigrationBackups(
  databaseFilePath = daemonConfig.databaseFilePath
): MigrationBackupCleanupResult {
  const deleted = clearMigrationBackupFiles(dirname(databaseFilePath));
  return {
    ...deleted,
    after: readStorageMaintenanceStats(databaseFilePath)
  };
}

function elapsedMs(startedAt: number) {
  return Math.round(performance.now() - startedAt);
}

function runLogCleanup(options: {
  clearLogs: boolean;
  dataDirectory: string;
  pruneLogs: boolean;
  storageMaxBytes: number;
}) {
  const startedAt = performance.now();
  let deletedLogFiles = options.pruneLogs
    ? pruneDaemonLogFiles(options.dataDirectory, options.storageMaxBytes)
    : 0;
  let clearedLogBytes = 0;
  if (options.clearLogs) {
    const cleared = clearDaemonLogs(options.dataDirectory);
    deletedLogFiles += cleared.deletedFiles;
    clearedLogBytes = cleared.clearedBytes;
  }
  return {
    clearedLogBytes,
    deletedLogFiles,
    durationMs: options.pruneLogs || options.clearLogs ? elapsedMs(startedAt) : 0
  };
}

export function runStorageMaintenance(
  options: StorageMaintenanceOptions = {}
): StorageMaintenanceResult {
  const databaseFilePath = options.databaseFilePath ?? daemonConfig.databaseFilePath;
  const startedAt = performance.now();
  const now = options.now ?? new Date();
  const oldAttachedSessionRetentionMs =
    options.oldAttachedSessionRetentionMs ?? DEFAULT_OLD_ATTACHED_SESSION_RETENTION_MS;
  const terminalSessionRetentionMs =
    options.terminalSessionRetentionMs ?? DEFAULT_TERMINAL_SESSION_RETENTION_MS;
  const storageMaxBytes = options.storageMaxBytes ?? readStorageMaxBytes();
  const shouldCompact = options.compact ?? true;

  return withMaintenanceDatabase(databaseFilePath, (database) => {
    const readCurrentStats = () => readStorageStats(database, databaseFilePath, {
      now,
      storageMaxBytes,
      oldAttachedSessionRetentionMs
    });
    const before = readCurrentStats();
    const pruneStartedAt = performance.now();
    const deletedDuplicateAttachedSessions = options.pruneDuplicateAttachedSessions ?? true
      ? pruneDuplicateAttachedSessions(database)
      : 0;
    const deletedOldAttachedSessions = options.pruneOldAttachedSessions ?? false
      ? pruneOldAttachedSessions(database, oldAttachedSessionRetentionMs, now)
      : 0;
    let deletedTerminalSessions = 0;
    if (options.purgeTerminalSessions ?? false) {
      deletedTerminalSessions = purgeTerminalSessions(database);
    } else if (options.pruneTerminalSessions ?? false) {
      deletedTerminalSessions = pruneTerminalSessions(
        database,
        terminalSessionRetentionMs,
        options.maxTerminalSessions ?? DEFAULT_MAX_TERMINAL_SESSIONS,
        now
      );
    }
    const deletedRevokedAccessDevices = options.pruneRevokedAccessDevices ?? true
      ? pruneRevokedAccessDevices(
          database,
          options.revokedAccessDeviceRetentionMs ?? DEFAULT_REVOKED_ACCESS_DEVICE_RETENTION_MS,
          now
        )
      : 0;
    pruneExpiredMaintenanceRecords(database, now);
    const pruneMs = elapsedMs(pruneStartedAt);

    const logCleanup = runLogCleanup({
      clearLogs: options.clearLogs ?? false,
      dataDirectory: dirname(databaseFilePath),
      pruneLogs: options.pruneLogs ?? true,
      storageMaxBytes
    });
    const storageAfterCleanup = readCurrentStats();
    const attachedCache = compactInactiveAttachedSessionCache(
      database,
      calculateAttachedSessionCacheBudget(storageAfterCleanup)
    );
    const storageAfterAttachedCache = readCurrentStats();
    const managedCache = compactInactiveManagedSessionCache(
      database,
      calculateManagedSessionCacheBudget(storageAfterAttachedCache)
    );
    const compactDurations = shouldCompact
      ? compactMaintenanceDatabase(database)
      : { checkpointBeforeMs: 0, checkpointAfterMs: 0, optimizeMs: 0, vacuumMs: 0 };
    const after = readCurrentStats();
    const result: StorageMaintenanceResult = {
      before,
      after,
      compacted: shouldCompact,
      compactedAttachedSessionBytes: attachedCache.compactedBytes,
      compactedAttachedSessions: attachedCache.compactedSessions,
      compactedManagedSessionBytes: managedCache.compactedBytes,
      compactedManagedSessions: managedCache.compactedSessions,
      deletedDuplicateAttachedSessions,
      deletedLogFiles: logCleanup.deletedLogFiles,
      deletedOldAttachedSessions,
      deletedRevokedAccessDevices,
      deletedTerminalSessions,
      clearedLogBytes: logCleanup.clearedLogBytes,
      durations: {
        ...compactDurations,
        pruneLogsMs: logCleanup.durationMs,
        pruneMs,
        totalMs: elapsedMs(startedAt)
      }
    };
    logMaintenanceCompleted(result, databaseFilePath);
    return result;
  });
}

export function runLightweightStorageMaintenance(
  options: StorageMaintenanceOptions = {},
  runtime: { allowAutomaticVacuum?: boolean } = {}
): StorageMaintenanceResult {
  const result = runStorageMaintenance({
    ...options,
    compact: false,
    pruneTerminalSessions: options.pruneTerminalSessions ?? true
  });
  const databaseFilePath = options.databaseFilePath ?? daemonConfig.databaseFilePath;
  if (
    runtime.allowAutomaticVacuum === false ||
    !shouldRunAutomaticVacuum(result, databaseFilePath)
  ) {
    return result;
  }

  try {
    const compacted = runStorageMaintenance({ ...options, compact: true });
    recordAutomaticVacuum(databaseFilePath);
    logger.info("Automatic storage compaction completed", {
      databaseFile: databaseFilePath,
      totalBytesAfter: compacted.after.database.totalBytes,
      totalBytesBefore: result.before.database.totalBytes,
      vacuumMs: compacted.durations.vacuumMs
    });
    return mergeStorageMaintenanceResults(result, compacted);
  } catch (error) {
    logger.warn("Automatic storage compaction deferred", {
      databaseFile: databaseFilePath,
      error: error instanceof Error ? error.message : String(error)
    });
    return result;
  }
}
