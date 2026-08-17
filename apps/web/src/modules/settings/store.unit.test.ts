import { afterEach, describe, expect, it, vi } from "vitest";

import { DaemonSettingsStore } from "./daemonSettings";
import { SettingsPageStore } from "./store";

describe("SettingsPageStore connection lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves store identity and resets connection-scoped state when the daemon identity changes", () => {
    vi.spyOn(DaemonSettingsStore.prototype, "loadDaemonSettings")
      .mockImplementation(() => undefined);
    const store = new SettingsPageStore("notifications");
    const previousAccessStore = store.accessStore;
    const previousNotificationStore = store.notificationStore;
    store.load();

    store.resetForConnectionChange();

    expect(store.accessStore).toBe(previousAccessStore);
    expect(store.notificationStore).toBe(previousNotificationStore);
    store.accessStore.selectAccessSettingsTab();
    expect(store.activeTab).toBe("access");
    store.dispose();
  });

  it("does not replace child stores when disposed", () => {
    vi.spyOn(DaemonSettingsStore.prototype, "loadDaemonSettings")
      .mockImplementation(() => undefined);
    const store = new SettingsPageStore("access");
    store.load();
    store.dispose();
    const accessStore = store.accessStore;

    expect(store.accessStore).toBe(accessStore);
  });
});
