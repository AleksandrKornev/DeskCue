import { makeAutoObservable, observable, runInAction } from "mobx";

import type {
  NotificationEventKind,
  NotificationProviderKind,
  NotificationSettingsResponse
} from "@deskcue/protocol";

import { notificationSettingsController } from "./controller";
import type { NotificationSettingsController } from "./controller";
import {
  buildNotificationSettingsInput,
  formatNotificationProviderLabel,
  notificationEventOptions,
  notificationProviderOptions,
  updateNotificationProviderDraft
} from "./helpers";
import { NotificationPushStore } from "./pushStore";
import type {
  NotificationSettingsDraft,
  TelegramPairingState,
  VisibleNotificationSecrets
} from "./types";

const notificationProviderSecretKeys: Partial<
  Record<NotificationProviderKind, keyof VisibleNotificationSecrets>
> = {
  gotify: "gotifyToken",
  telegram: "telegramBotToken",
  webhook: "webhookHeaders"
};

function serializeNotificationSettingsDraft(draft: NotificationSettingsDraft) {
  const input = buildNotificationSettingsInput(draft);

  return JSON.stringify({
    ...input,
    routes: input.routes?.map((route) => ({
      ...route,
      providers: [...route.providers].sort()
    }))
  });
}

function readNotificationOperationError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export class NotificationSettingsStore {
  connectionRevision = 0;
  draft: NotificationSettingsDraft | null = null;
  loadingNotificationSettings = false;
  notificationSettingsDirty = false;
  notificationSettingsSaveSuccessRevision = 0;
  notificationSettings: NotificationSettingsResponse | null = null;
  resolvingTelegramPairing = false;
  refreshingNotificationDiagnostics = false;
  savingNotificationSettings = false;
  settingsLoaded = false;
  startingTelegramPairing = false;
  telegramPairing: TelegramPairingState = null;
  testingNotificationProvider: NotificationProviderKind | null = null;
  visibleNotificationSecrets: VisibleNotificationSecrets = {
    gotifyToken: false,
    telegramBotToken: false,
    webhookHeaders: false
  };

  readonly pushStore = new NotificationPushStore();
  private readonly controller: NotificationSettingsController;
  private notificationSettingsBaseline: string | null = null;
  private requestGeneration = 0;

  constructor(controller: NotificationSettingsController = notificationSettingsController) {
    this.controller = controller;
    makeAutoObservable<this, "controller" | "notificationSettingsBaseline" | "requestGeneration">(
      this,
      {
        draft: observable.ref,
        notificationSettings: observable.ref,
        controller: false,
        notificationSettingsBaseline: false,
        pushStore: false,
        requestGeneration: false,
        telegramPairing: observable.ref
      },
      {
        autoBind: true
      }
    );
  }

  get eventOptions() {
    return notificationEventOptions;
  }

  get providerOptions() {
    return notificationProviderOptions;
  }

  get deliveryDiagnostics() {
    return this.notificationSettings?.diagnostics ?? null;
  }

  get notificationSettingsOperationPending() {
    return this.savingNotificationSettings ||
      this.resolvingTelegramPairing ||
      this.startingTelegramPairing ||
      this.testingNotificationProvider !== null;
  }

  get notificationSettingsOperationStatus() {
    if (this.savingNotificationSettings) return "Saving notification settings";
    if (this.resolvingTelegramPairing) return "Finding Telegram chat and saving notification settings";
    if (this.startingTelegramPairing) return "Opening Telegram pairing";

    if (this.testingNotificationProvider) {
      return `Sending ${formatNotificationProviderLabel(this.testingNotificationProvider)} test notification`;
    }

    return "";
  }

  get currentPushSubscribed() {
    return this.pushStore.currentPushSubscribed;
  }

  get disablingPush() {
    return this.pushStore.disablingPush;
  }

  get enablingPush() {
    return this.pushStore.enablingPush;
  }

  get loadingPushStatus() {
    return this.pushStore.loadingPushStatus;
  }

  get pushPermission() {
    return this.pushStore.pushPermission;
  }

  get pushStatus() {
    return this.pushStore.pushStatus;
  }

  get pushSummary() {
    return this.pushStore.pushSummary;
  }

  get otherPushSubscriptions() {
    return this.pushStore.otherPushSubscriptions;
  }

  get removingPushSubscriptionId() {
    return this.pushStore.removingPushSubscriptionId;
  }

  get pushSupport() {
    return this.pushStore.pushSupport;
  }

  get reenablingPush() {
    return this.pushStore.reenablingPush;
  }

  load() {
    void this.loadNotificationSettings();
    void this.pushStore.loadPushStatus();
  }

  async loadNotificationSettings() {
    if (this.settingsLoaded || this.loadingNotificationSettings) {
      return;
    }

    const generation = this.requestGeneration;

    this.loadingNotificationSettings = true;

    try {
      const settings = await this.controller.getSettings();

      if (generation !== this.requestGeneration) return;

      runInAction(() => {
        this.syncNotificationSettings(settings);
        this.settingsLoaded = true;
      });
    } catch (error) {
      if (generation !== this.requestGeneration) return;

      this.controller.notifyError(error instanceof Error ? error.message : "Failed to load notification settings");
    } finally {
      if (generation === this.requestGeneration) {
        runInAction(() => {
          this.loadingNotificationSettings = false;
        });
      }
    }
  }

  syncNotificationSettings(settings: NotificationSettingsResponse) {
    this.notificationSettings = settings;
    const draft: NotificationSettingsDraft = {
      enabled: settings.enabled,
      providers: {
        ...settings.providers,
        gotify: {
          ...settings.providers.gotify,
          token: settings.providers.gotify.token ?? ""
        },
        telegram: {
          ...settings.providers.telegram,
          botToken: settings.providers.telegram.botToken ?? ""
        }
      },
      routes: Object.fromEntries(
        notificationEventOptions.map(({ event }) => [
          event,
          settings.routes.find((route) => route.event === event)?.providers ?? []
        ])
      ) as Record<NotificationEventKind, NotificationProviderKind[]>
    };

    this.draft = draft;
    this.notificationSettingsBaseline = serializeNotificationSettingsDraft(draft);
    this.notificationSettingsDirty = false;
  }

  setEnabled(enabled: boolean) {
    this.updateDraft((current) => ({
      ...current,
      enabled
    }));
  }

  setProviderEnabled(provider: NotificationProviderKind, enabled: boolean) {
    const secretKey = notificationProviderSecretKeys[provider];

    if (!enabled && secretKey) {
      this.visibleNotificationSecrets = {
        ...this.visibleNotificationSecrets,
        [secretKey]: false
      };
    }

    this.updateDraft((current) => updateNotificationProviderDraft(
      current,
      provider,
      { enabled }
    ));
  }

  setProviderField(provider: NotificationProviderKind, field: string, value: string) {
    this.updateDraft((current) => updateNotificationProviderDraft(
      current,
      provider,
      { [field]: value }
    ));
  }

  toggleRoute(
    event: NotificationEventKind,
    provider: NotificationProviderKind,
    checked: boolean
  ) {
    this.updateDraft((current) => {
      const currentProviders = current.routes[event] ?? [];
      const nextProviders = checked
        ? [...new Set([...currentProviders, provider])]
        : currentProviders.filter((currentProvider) => currentProvider !== provider);

      return {
        ...current,
        routes: {
          ...current.routes,
          [event]: nextProviders
        }
      };
    });
  }

  toggleSecretVisibility(key: keyof VisibleNotificationSecrets) {
    this.visibleNotificationSecrets = {
      ...this.visibleNotificationSecrets,
      [key]: !this.visibleNotificationSecrets[key]
    };
  }

  async saveNotificationSettings() {
    if (!this.draft || !this.notificationSettingsDirty || this.notificationSettingsOperationPending) {
      return;
    }

    const generation = this.requestGeneration;

    this.savingNotificationSettings = true;

    try {
      const result = await this.controller.updateSettings(
        buildNotificationSettingsInput(this.draft)
      );

      if (generation !== this.requestGeneration) return;

      if (result.ok) {
        runInAction(() => {
          this.syncNotificationSettings(result.data);
          this.notificationSettingsSaveSuccessRevision += 1;
        });

        this.controller.notifySuccess("Notification settings saved");
        return;
      }

      this.controller.notifyError(result.data.error ?? "Failed to save notification settings");
    } catch (error) {
      if (generation !== this.requestGeneration) return;

      this.controller.notifyError(
        readNotificationOperationError(error, "Failed to save notification settings")
      );
    } finally {
      if (generation === this.requestGeneration) {
        runInAction(() => {
          this.savingNotificationSettings = false;
        });
      }
    }
  }

  async sendTest(provider: NotificationProviderKind) {
    if (!this.draft || this.notificationSettingsOperationPending) {
      return;
    }

    const generation = this.requestGeneration;

    this.testingNotificationProvider = provider;

    try {
      const result = await this.controller.sendTest(
        provider,
        buildNotificationSettingsInput(this.draft)
      );

      if (generation !== this.requestGeneration) return;

      if (result.ok) {
        const label = formatNotificationProviderLabel(provider);

        if (result.data.delivered > 0) {
          this.controller.notifySuccess(`${label} test delivered`);
          void this.refreshNotificationDiagnostics();
          return;
        }

        this.controller.notifyError(result.data.error ?? `${label} test was not delivered`);
        void this.refreshNotificationDiagnostics();
        return;
      }

      this.controller.notifyError(result.data.error ?? "Failed to send test notification");
      void this.refreshNotificationDiagnostics();
    } catch (error) {
      if (generation !== this.requestGeneration) return;

      this.controller.notifyError(
        readNotificationOperationError(error, "Failed to send test notification")
      );
    } finally {
      if (generation === this.requestGeneration) {
        runInAction(() => {
          this.testingNotificationProvider = null;
        });
      }
    }
  }

  async refreshNotificationDiagnostics() {
    if (this.refreshingNotificationDiagnostics) {
      return;
    }

    const generation = this.requestGeneration;

    this.refreshingNotificationDiagnostics = true;

    try {
      const settings = await this.controller.getSettings();

      if (generation !== this.requestGeneration) return;

      runInAction(() => {
        this.notificationSettings = settings;
        if (!this.draft) {
          this.syncNotificationSettings(settings);
        }
      });
    } catch (error) {
      if (generation !== this.requestGeneration) return;

      this.controller.notifyError(error instanceof Error ? error.message : "Failed to refresh notification diagnostics");
    } finally {
      if (generation === this.requestGeneration) {
        runInAction(() => {
          this.refreshingNotificationDiagnostics = false;
        });
      }
    }
  }

  enablePush() {
    return this.pushStore.enablePush();
  }

  reenablePush() {
    return this.pushStore.reenablePush();
  }

  disablePush() {
    return this.pushStore.disablePush();
  }

  removeOtherPushSubscription(id: string) {
    return this.pushStore.removeOtherPushSubscription(id);
  }

  async startTelegramPairing() {
    if (!this.draft || this.notificationSettingsOperationPending) {
      return;
    }

    const generation = this.requestGeneration;

    this.startingTelegramPairing = true;

    try {
      const result = await this.controller.startTelegramPairing(
        buildNotificationSettingsInput(this.draft)
      );

      if (generation !== this.requestGeneration) return;

      if (!result.ok) {
        this.controller.notifyError(result.data.error ?? "Failed to start Telegram pairing");
        return;
      }

      runInAction(() => {
        this.telegramPairing = result.data;
      });

      this.controller.openExternal(result.data.deepLink);
      this.controller.notifyInfo("Telegram opened. Press Start in the bot, then return and find the chat.");
    } catch (error) {
      if (generation !== this.requestGeneration) return;

      this.controller.notifyError(
        readNotificationOperationError(error, "Failed to start Telegram pairing")
      );
    } finally {
      if (generation === this.requestGeneration) {
        runInAction(() => {
          this.startingTelegramPairing = false;
        });
      }
    }
  }

  async resolveTelegramPairing() {
    if (!this.telegramPairing || !this.draft || this.notificationSettingsOperationPending) {
      return;
    }

    const generation = this.requestGeneration;

    this.resolvingTelegramPairing = true;

    try {
      const result = await this.controller.resolveTelegramPairing(this.telegramPairing.code);

      if (generation !== this.requestGeneration) return;

      if (!result.ok) {
        this.controller.notifyError(result.data.error ?? "Telegram chat was not found yet");
        return;
      }

      const nextDraft = updateNotificationProviderDraft(
        this.draft,
        "telegram",
        { chatId: result.data.chatId }
      );

      runInAction(() => {
        this.draft = nextDraft;
        this.notificationSettingsDirty = serializeNotificationSettingsDraft(nextDraft) !==
          this.notificationSettingsBaseline;
        this.telegramPairing = null;
      });

      const saveResult = await this.controller.updateSettings(buildNotificationSettingsInput(nextDraft));

      if (generation !== this.requestGeneration) return;

      if (saveResult.ok) {
        runInAction(() => {
          this.syncNotificationSettings(saveResult.data);
          this.notificationSettingsSaveSuccessRevision += 1;
        });
        this.controller.notifySuccess(result.data.chatTitle
          ? `Telegram chat connected and saved: ${result.data.chatTitle}`
          : "Telegram chat connected and saved");
        return;
      }

      this.controller.notifyError(saveResult.data.error ?? "Telegram chat found, but settings were not saved");
    } catch (error) {
      if (generation !== this.requestGeneration) return;

      this.controller.notifyError(
        readNotificationOperationError(error, "Failed to finish Telegram pairing")
      );
    } finally {
      if (generation === this.requestGeneration) {
        runInAction(() => {
          this.resolvingTelegramPairing = false;
        });
      }
    }
  }

  resetForConnectionChange() {
    this.requestGeneration += 1;
    this.connectionRevision += 1;
    this.pushStore.resetForConnectionChange();
    this.draft = null;
    this.loadingNotificationSettings = false;
    this.notificationSettingsBaseline = null;
    this.notificationSettingsDirty = false;
    this.notificationSettings = null;
    this.resolvingTelegramPairing = false;
    this.refreshingNotificationDiagnostics = false;
    this.savingNotificationSettings = false;
    this.settingsLoaded = false;
    this.startingTelegramPairing = false;
    this.telegramPairing = null;
    this.testingNotificationProvider = null;
    this.visibleNotificationSecrets = {
      gotifyToken: false,
      telegramBotToken: false,
      webhookHeaders: false
    };
  }

  private updateDraft(updater: (current: NotificationSettingsDraft) => NotificationSettingsDraft) {
    if (!this.draft) {
      return;
    }

    const nextDraft = updater(this.draft);

    this.draft = nextDraft;
    this.notificationSettingsDirty = serializeNotificationSettingsDraft(nextDraft) !==
      this.notificationSettingsBaseline;
  }
}
