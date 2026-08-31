import { afterEach, describe, expect, it, vi } from "vitest";

import type { NotificationSettingsResponse } from "@deskcue/protocol";
import { notificationsApi } from "@api/endpoint/notifications/endpoints";

import { NotificationSettingsStore } from "./store";

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it.each([
    ["gotify", "gotifyToken"],
    ["telegram", "telegramBotToken"],
    ["webhook", "webhookHeaders"]
  ] as const)("hides the disclosed %s secret when its provider is disabled", (provider, secretKey) => {
    const store = new NotificationSettingsStore();

    store.syncNotificationSettings(createNotificationSettings());
    store.setProviderEnabled(provider, true);
    store.toggleSecretVisibility(secretKey);

    expect(store.visibleNotificationSecrets[secretKey]).toBe(true);

    store.setProviderEnabled(provider, false);

    expect(store.visibleNotificationSecrets[secretKey]).toBe(false);
  });

  it("skips clean and reverted saves and clears dirty state after a changed draft is saved", async () => {
    const savedSettings = createNotificationSettings();
    const updateSpy = vi.spyOn(notificationsApi, "updateSettings").mockResolvedValue({
      data: savedSettings,
      ok: true
    });
    const store = new NotificationSettingsStore();

    store.syncNotificationSettings(createNotificationSettings());

    expect(store.notificationSettingsDirty).toBe(false);

    await store.saveNotificationSettings();

    expect(updateSpy).not.toHaveBeenCalled();

    store.setEnabled(false);

    expect(store.notificationSettingsDirty).toBe(true);

    store.setEnabled(true);

    expect(store.notificationSettingsDirty).toBe(false);

    await store.saveNotificationSettings();

    expect(updateSpy).not.toHaveBeenCalled();

    store.setEnabled(false);
    savedSettings.enabled = false;

    expect(store.notificationSettingsDirty).toBe(true);

    await store.saveNotificationSettings();

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(store.notificationSettingsDirty).toBe(false);
    expect(store.notificationSettingsSaveSuccessRevision).toBe(1);
  });

  it("does not publish a save-success revision for a failed save or connection reset", async () => {
    const store = new NotificationSettingsStore();

    store.syncNotificationSettings(createNotificationSettings());
    store.setEnabled(false);
    vi.spyOn(notificationsApi, "updateSettings").mockResolvedValue({
      data: { error: "offline" },
      ok: false
    });

    await store.saveNotificationSettings();

    expect(store.notificationSettingsSaveSuccessRevision).toBe(0);
    expect(store.notificationSettingsDirty).toBe(true);

    const previousConnectionRevision = store.connectionRevision;

    store.resetForConnectionChange();

    expect(store.connectionRevision).toBe(previousConnectionRevision + 1);
    expect(store.notificationSettingsSaveSuccessRevision).toBe(0);
  });

  it("releases every notification operation after a transport rejection", async () => {
    const store = new NotificationSettingsStore();

    store.syncNotificationSettings(createNotificationSettings());
    store.setEnabled(false);
    vi.spyOn(notificationsApi, "updateSettings").mockRejectedValueOnce(new Error("save offline"));
    vi.spyOn(notificationsApi, "sendTest").mockRejectedValueOnce(new Error("test offline"));
    vi.spyOn(notificationsApi, "startTelegramPairing")
      .mockRejectedValueOnce(new Error("pairing offline"));

    await expect(store.saveNotificationSettings()).resolves.toBeUndefined();

    expect(store.savingNotificationSettings).toBe(false);
    expect(store.notificationSettingsOperationPending).toBe(false);

    await expect(store.sendTest("ntfy")).resolves.toBeUndefined();

    expect(store.testingNotificationProvider).toBeNull();
    expect(store.notificationSettingsOperationPending).toBe(false);

    await expect(store.startTelegramPairing()).resolves.toBeUndefined();

    expect(store.startingTelegramPairing).toBe(false);
    expect(store.notificationSettingsOperationPending).toBe(false);
  });

  it("serializes Save behind an in-flight Telegram resolve-and-save transaction", async () => {
    let finishResolve!: (
      value: Awaited<ReturnType<typeof notificationsApi.resolveTelegramPairing>>
    ) => void;
    const pendingResolve = new Promise<
      Awaited<ReturnType<typeof notificationsApi.resolveTelegramPairing>>
    >((resolve) => {
      finishResolve = resolve;
    });
    const savedSettings = createNotificationSettings();

    savedSettings.providers.telegram.chatId = "chat-42";
    const resolveSpy = vi.spyOn(notificationsApi, "resolveTelegramPairing").mockReturnValue(pendingResolve);
    const updateSpy = vi.spyOn(notificationsApi, "updateSettings").mockResolvedValue({
      data: savedSettings,
      ok: true
    });
    const store = new NotificationSettingsStore();

    store.syncNotificationSettings(createNotificationSettings());
    store.telegramPairing = {
      botUsername: "deskcue_test_bot",
      code: "pair-code",
      deepLink: "https://t.me/deskcue_test_bot",
      expiresAt: "2026-08-30T12:00:00.000Z"
    };

    const resolving = store.resolveTelegramPairing();

    await Promise.resolve();

    expect(store.resolvingTelegramPairing).toBe(true);
    expect(store.notificationSettingsOperationStatus).toMatch(/Finding Telegram chat/);

    await store.saveNotificationSettings();

    expect(updateSpy).not.toHaveBeenCalled();

    finishResolve({
      data: { chatId: "chat-42", chatTitle: "DeskCue test" },
      ok: true
    });
    await resolving;

    expect(resolveSpy).toHaveBeenCalledWith("pair-code");
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(store.draft?.providers.telegram.chatId).toBe("chat-42");
    expect(store.resolvingTelegramPairing).toBe(false);
    expect(store.notificationSettingsSaveSuccessRevision).toBe(1);
  });
});
