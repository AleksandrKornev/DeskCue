import type {
  NotificationEventKind,
  NotificationProviderKind,
  UpdateNotificationSettingsInput
} from "@deskcue/protocol";

import type { NotificationSettingsDraft } from "./types";

export const notificationEventOptions: Array<{
  description: string;
  event: NotificationEventKind;
  label: string;
}> = [
  {
    description: "An agent is waiting for approve/reject",
    event: "approval.required",
    label: "Approval needed"
  },
  {
    description: "Managed DeskCue session completed successfully",
    event: "session.finished",
    label: "Session finished"
  },
  {
    description: "Managed DeskCue session exited with failure",
    event: "session.failed",
    label: "Session failed"
  },
  {
    description: "External source-agent turn completed or stopped",
    event: "agent.turn.finished",
    label: "Source-agent turn finished"
  }
];

export const notificationProviderOptions: Array<{
  provider: NotificationProviderKind;
  label: string;
}> = [
  { provider: "web_push", label: "Web Push" },
  { provider: "ntfy", label: "ntfy" },
  { provider: "gotify", label: "Gotify" },
  { provider: "telegram", label: "Telegram" },
  { provider: "webhook", label: "Webhook" }
];

export function readPushError(
  result: { data?: { error?: string }; error?: string },
  fallbackMessage: string
) {
  return result.error ?? result.data?.error ?? fallbackMessage;
}

export function updateNotificationProviderDraft(
  draft: NotificationSettingsDraft,
  provider: NotificationProviderKind,
  patch: Record<string, string | boolean>
): NotificationSettingsDraft {
  if (provider === "web_push") {
    return {
      ...draft,
      providers: {
        ...draft.providers,
        webPush: {
          ...draft.providers.webPush,
          ...patch
        }
      }
    };
  }

  if (provider === "ntfy") {
    return {
      ...draft,
      providers: {
        ...draft.providers,
        ntfy: {
          ...draft.providers.ntfy,
          ...patch
        }
      }
    };
  }

  if (provider === "gotify") {
    return {
      ...draft,
      providers: {
        ...draft.providers,
        gotify: {
          ...draft.providers.gotify,
          ...patch
        }
      }
    };
  }

  if (provider === "telegram") {
    return {
      ...draft,
      providers: {
        ...draft.providers,
        telegram: {
          ...draft.providers.telegram,
          ...patch
        }
      }
    };
  }

  return {
    ...draft,
    providers: {
      ...draft.providers,
      webhook: {
        ...draft.providers.webhook,
        ...patch
      }
    }
  };
}

export function buildNotificationSettingsInput(
  draft: NotificationSettingsDraft
): UpdateNotificationSettingsInput {
  return {
    enabled: draft.enabled,
    providers: {
      gotify: {
        enabled: draft.providers.gotify.enabled,
        serverUrl: draft.providers.gotify.serverUrl,
        ...(draft.providers.gotify.token.trim()
          ? { token: draft.providers.gotify.token.trim() }
          : {})
      },
      ntfy: {
        enabled: draft.providers.ntfy.enabled,
        topicUrl: draft.providers.ntfy.topicUrl
      },
      telegram: {
        chatId: draft.providers.telegram.chatId,
        enabled: draft.providers.telegram.enabled,
        ...(draft.providers.telegram.botToken.trim()
          ? { botToken: draft.providers.telegram.botToken.trim() }
          : {})
      },
      webhook: {
        enabled: draft.providers.webhook.enabled,
        headersText: draft.providers.webhook.headersText,
        url: draft.providers.webhook.url
      },
      webPush: {
        enabled: draft.providers.webPush.enabled
      }
    },
    routes: notificationEventOptions.map(({ event }) => ({
      event,
      providers: draft.routes[event] ?? []
    }))
  };
}

export function formatNotificationProviderLabel(provider: NotificationProviderKind) {
  return notificationProviderOptions.find((option) => option.provider === provider)?.label ?? provider;
}

export function formatPushSubscriptionCount(value: number) {
  if (value <= 0) {
    return "No devices are subscribed";
  }

  return `${value} device${value === 1 ? "" : "s"} subscribed`;
}

export function formatTelegramPairingExpiry(expiresAt: string) {
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return "soon";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(expiresAtMs);
}
