export interface StorageMaintenanceWarning {
  code:
    | "storage.size"
    | "storage.free-pages"
    | "sessions.duplicate-attached"
    | "sessions.old-attached";
  message: string;
}

export interface StorageMaintenanceStatsResponse {
  database: {
    path: string;
    bytes: number;
    walBytes: number;
    shmBytes: number;
    logBytes: number;
    serviceUsageBytes: number;
    totalBytes: number;
    storageLimitBytes: number;
    pageCount: number;
    pageSize: number;
    freelistCount: number;
    freeBytes: number;
  };
  localChats: {
    path: string;
    bytes: number;
    chatCount: number;
  };
  migrationBackups: {
    bytes: number;
    count: number;
  };
  sessions: {
    total: number;
    jsonBytes: number;
    duplicateAttachedGroups: number;
    duplicateAttachedSessions: number;
    inactiveAttachedJsonBytes: number;
    inactiveManagedJsonBytes: number;
    oldAttachedSessions: number;
    byStatus: Array<{
      status: string;
      count: number;
      jsonBytes: number;
      maxJsonBytes: number;
    }>;
    duplicateGroups: Array<{
      adapterId: string;
      sourceSessionId: string;
      count: number;
      jsonBytes: number;
    }>;
  };
  accessDevices: {
    total: number;
    active: number;
    revoked: number;
  };
  warnings: StorageMaintenanceWarning[];
}

export interface StorageMaintenanceResultResponse {
  before: StorageMaintenanceStatsResponse;
  after: StorageMaintenanceStatsResponse;
  compacted: boolean;
  compactedAttachedSessionBytes: number;
  compactedAttachedSessions: number;
  compactedManagedSessionBytes: number;
  compactedManagedSessions: number;
  deletedDuplicateAttachedSessions: number;
  deletedLogFiles: number;
  deletedOldAttachedSessions: number;
  deletedRevokedAccessDevices: number;
  deletedTerminalSessions: number;
  clearedLogBytes: number;
  durations: {
    checkpointBeforeMs: number;
    checkpointAfterMs: number;
    optimizeMs: number;
    pruneLogsMs: number;
    pruneMs: number;
    vacuumMs: number;
    totalMs: number;
  };
}

export interface MigrationBackupCleanupResponse {
  deletedBackups: number;
  deletedBytes: number;
  after: StorageMaintenanceStatsResponse;
}
