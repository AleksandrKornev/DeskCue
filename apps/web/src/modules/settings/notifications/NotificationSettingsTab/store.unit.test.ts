import { describe, expect, it, vi } from "vitest";

import type { NotificationSettingsResponse } from "@deskcue/protocol";
import { notificationsApi } from "@api/endpoint/notifications/endpoints";

import { NotificationSettingsStore } from "./store";

function createNotificationSettings(): NotificationSettingsResponse {
  return {
    diagnostics: null as never,
    enabled: true,
    events: [],
    providers: {
      gotify: { enabled: false, serverUrl: "", tokenConfigured: false },
      ntfy: { enabled: false, topicUrl: "" },
      telegram: { botTokenConfigured: false, chatId: "", enabled: false },
      webhook: { enabled: false, headersText: "", url: "" },
      webPush: { enabled: false }
    },
    routes: []
  };
}

describe("NotificationSettingsStore connection lifecycle", () => {
  it("ignores a response from the previous connection generation", async () => {
    let resolveSettings!: (value: NotificationSettingsResponse) => void;
    const pendingSettings = new Promise<NotificationSettingsResponse>((resolve) => {
      resolveSettings = resolve;
    });
    vi.spyOn(notificationsApi, "getSettings").mockReturnValue(pendingSettings);
    const store = new NotificationSettingsStore();

    const load = store.loadNotificationSettings();
    store.resetForConnectionChange();
    resolveSettings(createNotificationSettings());
    await load;

    expect(store.settingsLoaded).toBe(false);
    expect(store.notificationSettings).toBeNull();
    expect(store.draft).toBeNull();
    expect(store.loadingNotificationSettings).toBe(false);
  });
});
