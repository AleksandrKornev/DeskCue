import type {
  NotificationDeliveryDiagnostics,
  NotificationEventKind,
  NotificationProviderKind,
  NotificationSettingsResponse,
  UpdateNotificationSettingsInput
} from "@deskcue/protocol";

import {
  isNotificationEvent,
  isNotificationProvider,
  NOTIFICATION_EVENTS
} from "./notificationTypes.ts";
import type { StoredNotificationSettings } from "./notificationTypes.ts";

export function createDefaultNotificationSettings(): StoredNotificationSettings {
  return {
    enabled: true,
    providers: {
      gotify: { enabled: false, serverUrl: "", token: "" },
      ntfy: { enabled: false, topicUrl: "" },
      telegram: { botToken: "", chatId: "", enabled: false },
      webhook: { enabled: false, headersText: "", url: "" },
      webPush: { enabled: true }
    },
    routes: NOTIFICATION_EVENTS.map((event) => ({ event, providers: ["web_push"] }))
  };
}

export function toPublicSettings(
  settings: StoredNotificationSettings,
  diagnostics: NotificationDeliveryDiagnostics
): NotificationSettingsResponse {
  return {
    diagnostics: {
      lastAttempt: diagnostics.lastAttempt,
      lastFailure: diagnostics.lastFailure,
      lastSuccess: diagnostics.lastSuccess,
      pendingRetries: diagnostics.pendingRetries
    },
    enabled: settings.enabled,
    events: NOTIFICATION_EVENTS,
    providers: {
      gotify: {
        enabled: settings.providers.gotify.enabled,
        serverUrl: settings.providers.gotify.serverUrl,
        token: settings.providers.gotify.token,
        tokenConfigured: Boolean(settings.providers.gotify.token)
      },
      ntfy: settings.providers.ntfy,
      telegram: {
        botToken: settings.providers.telegram.botToken,
        botTokenConfigured: Boolean(settings.providers.telegram.botToken),
        chatId: settings.providers.telegram.chatId,
        enabled: settings.providers.telegram.enabled
      },
      webhook: settings.providers.webhook,
      webPush: settings.providers.webPush
    },
    routes: settings.routes
  };
}

export function isProviderEnabled(
  settings: StoredNotificationSettings,
  provider: NotificationProviderKind
) {
  if (provider === "web_push") return settings.providers.webPush.enabled;
  if (provider === "ntfy") return settings.providers.ntfy.enabled;
  if (provider === "gotify") return settings.providers.gotify.enabled;
  if (provider === "telegram") return settings.providers.telegram.enabled;
  return settings.providers.webhook.enabled;
}

export function resolveProvidersForEvent(
  settings: StoredNotificationSettings,
  event: NotificationEventKind
) {
  const route = settings.routes.find((item) => item.event === event);
  return (route?.providers ?? []).filter((provider) => isProviderEnabled(settings, provider));
}

function readSecret(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function normalizeNotificationSettings(
  input: Partial<StoredNotificationSettings> | undefined
): StoredNotificationSettings {
  const defaults = createDefaultNotificationSettings();
  const routes = Array.isArray(input?.routes)
    ? input.routes
        .filter((route) => isNotificationEvent(route.event))
        .map((route) => ({
          event: route.event,
          providers: route.providers.filter(isNotificationProvider)
        }))
    : defaults.routes;

  return {
    enabled: input?.enabled ?? defaults.enabled,
    providers: {
      gotify: {
        enabled: input?.providers?.gotify?.enabled ?? defaults.providers.gotify.enabled,
        serverUrl: input?.providers?.gotify?.serverUrl ?? defaults.providers.gotify.serverUrl,
        token: readSecret(input?.providers?.gotify?.token)
      },
      ntfy: {
        enabled: input?.providers?.ntfy?.enabled ?? defaults.providers.ntfy.enabled,
        topicUrl: input?.providers?.ntfy?.topicUrl ?? defaults.providers.ntfy.topicUrl
      },
      telegram: {
        botToken: readSecret(input?.providers?.telegram?.botToken),
        chatId: input?.providers?.telegram?.chatId ?? defaults.providers.telegram.chatId,
        enabled: input?.providers?.telegram?.enabled ?? defaults.providers.telegram.enabled
      },
      webhook: {
        enabled: input?.providers?.webhook?.enabled ?? defaults.providers.webhook.enabled,
        headersText: input?.providers?.webhook?.headersText ?? defaults.providers.webhook.headersText,
        url: input?.providers?.webhook?.url ?? defaults.providers.webhook.url
      },
      webPush: {
        enabled: input?.providers?.webPush?.enabled ?? defaults.providers.webPush.enabled
      }
    },
    routes: NOTIFICATION_EVENTS.map((event) => ({
      event,
      providers: routes.find((route) => route.event === event)?.providers ?? []
    }))
  };
}

export function applyNotificationSettingsUpdate(
  current: StoredNotificationSettings,
  input: UpdateNotificationSettingsInput
): StoredNotificationSettings {
  return normalizeNotificationSettings({
    enabled: input.enabled ?? current.enabled,
    providers: {
      gotify: {
        ...current.providers.gotify,
        ...(input.providers?.gotify ?? {}),
        token: input.providers?.gotify?.clearToken
          ? ""
          : input.providers?.gotify?.token ?? current.providers.gotify.token
      },
      ntfy: { ...current.providers.ntfy, ...(input.providers?.ntfy ?? {}) },
      telegram: {
        ...current.providers.telegram,
        ...(input.providers?.telegram ?? {}),
        botToken: input.providers?.telegram?.clearBotToken
          ? ""
          : input.providers?.telegram?.botToken ?? current.providers.telegram.botToken
      },
      webhook: { ...current.providers.webhook, ...(input.providers?.webhook ?? {}) },
      webPush: { ...current.providers.webPush, ...(input.providers?.webPush ?? {}) }
    },
    routes: input.routes ?? current.routes
  });
}
