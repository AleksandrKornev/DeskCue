import type {
  MigrationBackupCleanupResponse,
  StorageMaintenanceResultResponse,
  StorageMaintenanceStatsResponse,
  StorageMaintenanceWarning as ProtocolStorageMaintenanceWarning
} from "@deskcue/protocol";

export type StorageMaintenanceWarning = ProtocolStorageMaintenanceWarning;
export type StorageMaintenanceStats = StorageMaintenanceStatsResponse;
export type StorageMaintenanceResult = StorageMaintenanceResultResponse;
export type MigrationBackupCleanupResult = MigrationBackupCleanupResponse;

export type StorageMaintenanceOptions = {
  compact?: boolean;
  databaseFilePath?: string;
  now?: Date;
  pruneOldAttachedSessions?: boolean;
  pruneDuplicateAttachedSessions?: boolean;
  pruneLogs?: boolean;
  pruneRevokedAccessDevices?: boolean;
  pruneTerminalSessions?: boolean;
  purgeTerminalSessions?: boolean;
  clearLogs?: boolean;
  oldAttachedSessionRetentionMs?: number;
  terminalSessionRetentionMs?: number;
  maxTerminalSessions?: number;
  storageMaxBytes?: number;
  revokedAccessDeviceRetentionMs?: number;
};
