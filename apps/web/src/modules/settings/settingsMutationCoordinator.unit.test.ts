import { describe, expect, it, vi } from "vitest";

import type { DaemonSettingsResponse } from "@deskcue/protocol";

import { DaemonSettingsStore } from "./daemonSettings/store";
import { SettingsMutationCoordinator } from "./settingsMutationCoordinator";
import { StorageSettingsStore } from "./storage/StorageSettingsTab/store";

function createSettings(): DaemonSettingsResponse {
  return {
    agentDataRoots: {
      claudeHome: "C:\\claude",
      codexHome: "C:\\codex",
      lmStudioHome: "C:\\lmstudio"
    },
    allowedOrigins: [],
    authRequired: true,
    pairingHosts: [],
    publicHost: null,
    runtimeEndpoints: {
      lmStudioEndpoint: "http://127.0.0.1:1234",
      ollamaEndpoint: "http://127.0.0.1:11434"
    },
    sources: {
      storageMaxMb: {
        source: "file"
      }
    },
    storageMaxMb: 50
  } as unknown as DaemonSettingsResponse;
}

function createDaemonController() {
  return {
    fetchSecurityStatus: vi.fn().mockResolvedValue({}),
    getDaemonSettings: vi.fn(),
    notifyReset: vi.fn(),
    notifySaved: vi.fn(),
    requestResetConfirmation: vi.fn(),
    resetDaemonSettings: vi.fn(),
    updateDaemonSettings: vi.fn()
  };
}

function createStorageController() {
  return {
    clearMigrationBackups: vi.fn(),
    compactStorage: vi.fn(),
    getStorageStats: vi.fn(),
    notifyError: vi.fn(),
    notifySuccess: vi.fn(),
    updateStorageBudget: vi.fn()
  };
}

describe("SettingsMutationCoordinator", () => {
  it("blocks a storage write while a full settings save is pending", async () => {
    let resolveSave!: (result: { data: ReturnType<typeof createSettings>; ok: true }) => void;
    const coordinator = new SettingsMutationCoordinator();
    const daemonController = createDaemonController();
    const storageController = createStorageController();
    const settings = createSettings();
    const pendingSave = new Promise<{ data: ReturnType<typeof createSettings>; ok: true }>((resolve) => {
      resolveSave = resolve;
    });
    const daemonStore = new DaemonSettingsStore(daemonController, coordinator);
    const storageStore = new StorageSettingsStore(storageController, coordinator);

    daemonStore.syncDaemonSettings(settings);
    storageStore.updateDependencies({
      daemonSettings: settings,
      syncDaemonSettings: daemonStore.syncDaemonSettingsPreservingDraft
    });

    daemonController.updateDaemonSettings.mockReturnValue(pendingSave);

    const saving = daemonStore.onSaveDaemonSettings();

    await expect(storageStore.setStorageBudget(100)).resolves.toBe(false);
    expect(storageController.updateStorageBudget).not.toHaveBeenCalled();

    resolveSave({ data: settings, ok: true });
    await saving;
  });

  it("blocks a full settings save while a storage write is pending", async () => {
    let resolveStorage!: (result: { data: ReturnType<typeof createSettings>; ok: true }) => void;
    const coordinator = new SettingsMutationCoordinator();
    const daemonController = createDaemonController();
    const storageController = createStorageController();
    const settings = createSettings();
    const pendingStorage = new Promise<{ data: ReturnType<typeof createSettings>; ok: true }>((resolve) => {
      resolveStorage = resolve;
    });
    const daemonStore = new DaemonSettingsStore(daemonController, coordinator);
    const storageStore = new StorageSettingsStore(storageController, coordinator);

    daemonStore.syncDaemonSettings(settings);
    storageStore.updateDependencies({
      daemonSettings: settings,
      syncDaemonSettings: daemonStore.syncDaemonSettingsPreservingDraft
    });

    storageController.updateStorageBudget.mockReturnValue(pendingStorage);

    const savingStorage = storageStore.setStorageBudget(100);

    await daemonStore.onSaveDaemonSettings();
    expect(daemonController.updateDaemonSettings).not.toHaveBeenCalled();

    resolveStorage({ data: settings, ok: true });
    await savingStorage;
  });
});
