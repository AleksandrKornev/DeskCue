import { describe, expect, it, vi } from "vitest";

import type { AccessDeviceSummary } from "@deskcue/protocol";

import type { AccessSettingsController } from "./controller";
import { AccessSettingsStore } from "./store";

function createAccessDevice(id: string, label: string): AccessDeviceSummary {
  return {
    createdAt: "2026-08-30T00:00:00.000Z",
    current: false,
    id,
    label,
    lastIp: "127.0.0.1",
    lastSeenAt: "2026-08-30T00:00:00.000Z",
    revokedAt: null,
    userAgent: "Chrome"
  };
}

describe("AccessSettingsStore pairing host focus requests", () => {
  it("lets each request be claimed once and clears the contract on connection reset", () => {
    const store = new AccessSettingsStore();

    expect(store.shouldHandlePairingHostsFocusRequest(store.pairingHostsFocusRequest)).toBe(false);

    store.focusPairingHostsEditor();

    expect(store.pairingHostsFocusRequest).toBe(1);
    expect(store.shouldHandlePairingHostsFocusRequest(store.pairingHostsFocusRequest)).toBe(true);

    store.acknowledgePairingHostsFocusRequest(store.pairingHostsFocusRequest);

    expect(store.shouldHandlePairingHostsFocusRequest(store.pairingHostsFocusRequest)).toBe(false);

    store.focusPairingHostsEditor();

    expect(store.pairingHostsFocusRequest).toBe(2);
    expect(store.shouldHandlePairingHostsFocusRequest(store.pairingHostsFocusRequest)).toBe(true);

    store.acknowledgePairingHostsFocusRequest(store.pairingHostsFocusRequest);

    store.resetForConnectionChange();

    expect(store.pairingHostsFocusRequest).toBe(0);
    expect(store.shouldHandlePairingHostsFocusRequest(store.pairingHostsFocusRequest)).toBe(false);
  });

  it("rejects an overlapping device rename", async () => {
    const firstDevice = createAccessDevice("device-a", "Device A");
    const secondDevice = createAccessDevice("device-b", "Device B");
    let resolveFirstRename: ((value: unknown) => void) | undefined;
    const renameDevice = vi.fn(() => new Promise((resolve) => {
      resolveFirstRename = resolve;
    }));
    const controller = {
      confirm: vi.fn(),
      forgetAccessToken: vi.fn(),
      getDevices: vi.fn(),
      renameDevice,
      revokeCurrentDevice: vi.fn(),
      revokeDevice: vi.fn(),
      revokeOtherDevices: vi.fn()
    } as unknown as AccessSettingsController;
    const store = new AccessSettingsStore(controller);

    const firstRename = store.renameAccessDevice(firstDevice, "Renamed A");
    const secondRename = await store.renameAccessDevice(secondDevice, "Renamed B");

    expect(secondRename).toBe(false);
    expect(renameDevice).toHaveBeenCalledTimes(1);

    resolveFirstRename?.({
      data: { device: { ...firstDevice, label: "Renamed A" } },
      ok: true
    });

    await expect(firstRename).resolves.toBe(true);
    expect(store.renamingAccessDeviceId).toBeNull();
  });
});
