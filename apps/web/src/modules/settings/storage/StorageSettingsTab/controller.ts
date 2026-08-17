import { toast } from "sonner";

import { daemonApi } from "@api/endpoint/daemon/endpoints";
import { updateDaemonSettings } from "@modules/settings/daemonSettings/daemonSettingsService";

export const storageSettingsController = {
  clearMigrationBackups: () => daemonApi.clearMigrationBackups(),
  compactStorage: () => daemonApi.compactStorage(),
  getStorageStats: () => daemonApi.getStorageStats(),
  notifyError: (message: string) => toast.error(message),
  notifySuccess: (message: string) => toast.success(message),
  updateStorageBudget: (storageMaxMb: number) => updateDaemonSettings({ storageMaxMb })
};

export type StorageSettingsController = typeof storageSettingsController;
