import { logger } from "#infrastructure/logging/logger";

import type {
  StorageMaintenanceResult,
  StorageMaintenanceWarning
} from "./storageMaintenanceTypes.ts";

function isDaemonStorageMaintenanceWarning(warning: StorageMaintenanceWarning) {
  return warning.code !== "sessions.old-attached";
}

export function startStorageMaintenanceSchedulerLoop(options: {
  intervalMs: number;
  runMaintenance: () => Promise<StorageMaintenanceResult> | StorageMaintenanceResult;
}) {
  let closed = false;
  let activeRun: Promise<void> | null = null;

  const run = (reason: string) => {
    if (closed || activeRun) {
      return activeRun ?? Promise.resolve();
    }

    activeRun = Promise.resolve()
      .then(options.runMaintenance)
      .then((result) => {
        const daemonWarnings = result.after.warnings.filter(isDaemonStorageMaintenanceWarning);
        if (daemonWarnings.length > 0) {
          logger.warn("Storage maintenance reported warnings", {
            reason,
            warningCodes: daemonWarnings.map((warning) => warning.code),
            warningMessages: daemonWarnings.map((warning) => warning.message),
            warningCount: daemonWarnings.length,
            totalBytes: result.after.database.totalBytes
          });
        }
      })
      .catch((error) => {
        logger.warn("Storage maintenance failed", {
          reason,
          error: error instanceof Error ? error.message : String(error)
        });
      })
      .finally(() => {
        activeRun = null;
      });
    return activeRun;
  };

  queueMicrotask(() => {
    if (!closed) {
      void run("startup");
    }
  });
  const timer = setInterval(() => void run("interval"), options.intervalMs);
  timer.unref?.();

  return {
    async close() {
      closed = true;
      clearInterval(timer);
      await activeRun;
    }
  };
}
