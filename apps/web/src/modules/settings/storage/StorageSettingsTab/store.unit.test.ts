import { describe, expect, it, vi } from "vitest";

import { StorageSettingsStore } from "./store";

function createController() {
  return {
    clearMigrationBackups: vi.fn(),
    compactStorage: vi.fn(),
    getStorageStats: vi.fn(),
    notifyError: vi.fn(),
    notifySuccess: vi.fn(),
    updateStorageBudget: vi.fn()
  };
}

describe("StorageSettingsStore destructive operation results", () => {
  it("increments the connection epoch when runtime state resets", () => {
    const store = new StorageSettingsStore(createController());

    expect(store.connectionRevision).toBe(0);

    store.resetForConnectionChange();

    expect(store.connectionRevision).toBe(1);
  });

  it("reports a non-ok service cleanup as unsuccessful", async () => {
    const controller = createController();

    controller.compactStorage.mockResolvedValue({
      data: { error: "offline" },
      ok: false
    });
    const store = new StorageSettingsStore(controller);

    await expect(store.compactStorage()).resolves.toBe(false);

    expect(controller.notifyError).toHaveBeenCalledWith("offline");
    expect(store.compactingStorage).toBe(false);
  });

  it("reports a rejected recovery-copy cleanup as unsuccessful", async () => {
    const controller = createController();

    controller.clearMigrationBackups.mockRejectedValue(new Error("connection lost"));
    const store = new StorageSettingsStore(controller);

    await expect(store.clearMigrationBackups()).resolves.toBe(false);

    expect(controller.notifyError).toHaveBeenCalledWith("connection lost");
    expect(store.clearingMigrationBackups).toBe(false);
  });
});
