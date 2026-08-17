import type { DaemonLogsResponse } from "@deskcue/protocol";
import { getJson, postApi } from "@api/transport/requests";

import type {
  MigrationBackupCleanupResponse,
  StorageMaintenanceResultResponse,
  StorageMaintenanceStatsResponse
} from "./types";

export const daemonApi = {
  getLogs(limit = 120) {
    return getJson<DaemonLogsResponse>(
      `/api/daemon/logs?limit=${limit}`,
      "Failed to load daemon logs"
    );
  },

  getStorageStats() {
    return getJson<StorageMaintenanceStatsResponse>(
      "/api/maintenance/storage",
      "Failed to load storage maintenance stats"
    );
  },

  compactStorage() {
    return postApi<StorageMaintenanceResultResponse>("/api/maintenance/storage/compact");
  },

  clearMigrationBackups() {
    return postApi<MigrationBackupCleanupResponse>(
      "/api/maintenance/storage/migration-backups/clear"
    );
  }
};
