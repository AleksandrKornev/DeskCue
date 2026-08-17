import { makeAutoObservable, observable, runInAction } from "mobx";

import type { DaemonSettingsResponse } from "@deskcue/protocol";
import type { StorageMaintenanceStatsResponse } from "@api/endpoint/daemon/types";

import { storageSettingsController } from "./controller";
import type { StorageSettingsController } from "./controller";
import { formatBytes } from "./helpers";

type StorageSettingsDependencies = {
  daemonSettings: DaemonSettingsResponse | null;
  syncDaemonSettings: (settings: DaemonSettingsResponse) => void;
};

const noop = () => {};

export class StorageSettingsStore {
  clearingMigrationBackups = false;
  compactingStorage = false;
  customStorageMaxMb = "";
  daemonSettings: DaemonSettingsResponse | null = null;
  isCustomStorageLimitDialogOpen = false;
  loadingStorageStats = false;
  savingStorageBudget = false;
  storageStats: StorageMaintenanceStatsResponse | null = null;
  syncDaemonSettings: StorageSettingsDependencies["syncDaemonSettings"] = noop;
  private readonly controller: StorageSettingsController;
  private requestGeneration = 0;

  constructor(controller: StorageSettingsController = storageSettingsController) {
    this.controller = controller;
    makeAutoObservable<this, "controller" | "requestGeneration">(
      this,
      {
        controller: false,
        daemonSettings: observable.ref,
        storageStats: observable.ref,
        requestGeneration: false,
        syncDaemonSettings: false
      },
      {
        autoBind: true
      }
    );
  }

  updateDependencies(dependencies: StorageSettingsDependencies) {
    const previousStorageMaxMb = this.daemonSettings?.storageMaxMb;
    this.daemonSettings = dependencies.daemonSettings;
    this.syncDaemonSettings = dependencies.syncDaemonSettings;

    if (
      dependencies.daemonSettings &&
      dependencies.daemonSettings.storageMaxMb !== previousStorageMaxMb
    ) {
      this.customStorageMaxMb = String(dependencies.daemonSettings.storageMaxMb);
    }
  }

  loadStorageStats() {
    if (this.storageStats || this.loadingStorageStats) {
      return;
    }

    void this.refreshStorageStats();
  }

  async refreshStorageStats() {
    const generation = this.requestGeneration;
    this.loadingStorageStats = true;

    try {
      const storageStats = await this.controller.getStorageStats();
      if (generation !== this.requestGeneration) return;
      runInAction(() => {
        this.storageStats = storageStats;
      });
    } catch (error) {
      if (generation !== this.requestGeneration) return;
      this.controller.notifyError(
        error instanceof Error ? error.message : "Failed to load storage maintenance stats"
      );
    } finally {
      if (generation === this.requestGeneration) {
        runInAction(() => {
          this.loadingStorageStats = false;
        });
      }
    }
  }

  async compactStorage() {
    if (this.compactingStorage) {
      return;
    }

    const generation = this.requestGeneration;
    this.compactingStorage = true;
    try {
      const result = await this.controller.compactStorage();
      if (generation !== this.requestGeneration) return;

      if (!result.ok) {
        this.controller.notifyError(result.data.error ?? "Storage compaction failed");
        return;
      }

      runInAction(() => {
        this.storageStats = result.data.after;
      });
      const releasedBytes = Math.max(
        0,
        result.data.before.database.serviceUsageBytes - result.data.after.database.serviceUsageBytes
      );
      const migrationBackupNotice = result.data.after.migrationBackups.count > 0
        ? ` Protected migration backups remain: ${result.data.after.migrationBackups.count} · ${formatBytes(result.data.after.migrationBackups.bytes)}.`
        : "";
      this.controller.notifySuccess(
        `Service storage cleared: ${result.data.deletedTerminalSessions} terminal session card${result.data.deletedTerminalSessions === 1 ? "" : "s"} and ${formatBytes(result.data.clearedLogBytes)} of DeskCue logs removed. ${formatBytes(releasedBytes)} reclaimed.${migrationBackupNotice}`
      );
    } catch (error) {
      if (generation !== this.requestGeneration) return;
      this.controller.notifyError(error instanceof Error ? error.message : "Storage compaction failed");
    } finally {
      if (generation === this.requestGeneration) {
        runInAction(() => {
          this.compactingStorage = false;
        });
      }
    }
  }

  async clearMigrationBackups() {
    if (this.clearingMigrationBackups) {
      return;
    }

    const generation = this.requestGeneration;
    this.clearingMigrationBackups = true;
    try {
      const result = await this.controller.clearMigrationBackups();
      if (generation !== this.requestGeneration) return;

      if (!result.ok) {
        this.controller.notifyError(result.data.error ?? "Failed to delete migration backups");
        return;
      }

      runInAction(() => {
        this.storageStats = result.data.after;
      });
      this.controller.notifySuccess(
        `Deleted ${result.data.deletedBackups} migration backup${result.data.deletedBackups === 1 ? "" : "s"} (${formatBytes(result.data.deletedBytes)}).`
      );
    } catch (error) {
      if (generation !== this.requestGeneration) return;
      this.controller.notifyError(error instanceof Error ? error.message : "Failed to delete migration backups");
    } finally {
      if (generation === this.requestGeneration) {
        runInAction(() => {
          this.clearingMigrationBackups = false;
        });
      }
    }
  }

  openCustomStorageLimitDialog() {
    this.isCustomStorageLimitDialogOpen = true;
  }

  closeCustomStorageLimitDialog() {
    this.isCustomStorageLimitDialogOpen = false;
  }

  setCustomStorageMaxMb(value: string) {
    this.customStorageMaxMb = value;
  }

  async setStorageBudget(storageMaxMb: number) {
    if (this.savingStorageBudget || this.daemonSettings?.sources.storageMaxMb.source === "env") {
      return false;
    }

    const generation = this.requestGeneration;
    this.savingStorageBudget = true;
    try {
      const result = await this.controller.updateStorageBudget(storageMaxMb);
      if (generation !== this.requestGeneration) return false;

      if (!result.ok) {
        this.controller.notifyError(result.data.error ?? "Failed to update storage limit");
        return false;
      }

      this.syncDaemonSettings(result.data);
      void this.refreshStorageStats();
      this.controller.notifySuccess(`.deskcue-data limit set to ${storageMaxMb} MiB`);
      return true;
    } catch (error) {
      if (generation !== this.requestGeneration) return false;
      this.controller.notifyError(error instanceof Error ? error.message : "Failed to update storage limit");
      return false;
    } finally {
      if (generation === this.requestGeneration) {
        runInAction(() => {
          this.savingStorageBudget = false;
        });
      }
    }
  }

  setStorageBudgetFromPreset(storageMaxMb: number) {
    void this.setStorageBudget(storageMaxMb);
  }

  async submitCustomStorageLimit() {
    const storageMaxMb = Number(this.customStorageMaxMb);
    if (!Number.isInteger(storageMaxMb) || storageMaxMb < 20 || storageMaxMb > 500) {
      this.controller.notifyError("Enter a whole number between 20 and 500 MiB");
      return;
    }

    if (await this.setStorageBudget(storageMaxMb)) {
      runInAction(() => {
        this.closeCustomStorageLimitDialog();
      });
    }
  }

  resetForConnectionChange() {
    this.requestGeneration += 1;
    this.clearingMigrationBackups = false;
    this.compactingStorage = false;
    this.customStorageMaxMb = "";
    this.daemonSettings = null;
    this.isCustomStorageLimitDialogOpen = false;
    this.loadingStorageStats = false;
    this.savingStorageBudget = false;
    this.storageStats = null;
  }
}
