import type { SessionSummary, SessionStatus } from "@deskcue/protocol";

import type { StoredNotificationSettings } from "../state/notificationTypes.ts";

export type LegacySessionWebhookPayload = {
  event: "session.finished";
  session: {
    command: string;
    exitCode: number | null;
    finishedAt: string | null;
    id: string;
    lastActivityAt: string;
    status: Extract<SessionStatus, "done" | "failed" | "stopped">;
    workspaceId: string;
    workspaceName: string;
  };
};

export type EffectiveNotificationSettings = {
  legacySessionWebhookActive: boolean;
  settings: StoredNotificationSettings;
};

export function buildLegacySessionWebhookPayload(
  session: SessionSummary
): LegacySessionWebhookPayload {
  if (
    session.status !== "done" &&
    session.status !== "failed" &&
    session.status !== "stopped"
  ) {
    throw new Error("Legacy session webhook payload requires a terminal session.");
  }

  return {
    event: "session.finished",
    session: {
      command: session.command,
      exitCode: session.exitCode,
      finishedAt: session.finishedAt,
      id: session.id,
      lastActivityAt: session.lastActivityAt,
      status: session.status,
      workspaceId: session.workspaceId,
      workspaceName: session.workspaceName
    }
  };
}

function isSupportedWebhookUrl(value: string) {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Treats DESKCUE_SESSION_WEBHOOK_URL as a default for the durable webhook
 * provider. A webhook explicitly saved through settings always wins.
 *
 * This intentionally does not register an event listener or perform network
 * delivery. The push notification service remains the sole coordinator and
 * persists the dispatch in its SQLite outbox before attempting delivery.
 */
export function resolveLegacySessionWebhookSettings(
  settings: StoredNotificationSettings,
  webhookUrl: string | null
): EffectiveNotificationSettings {
  const normalizedUrl = webhookUrl?.trim() ?? "";
  if (
    settings.providers.webhook.url.trim() ||
    !isSupportedWebhookUrl(normalizedUrl)
  ) {
    return {
      legacySessionWebhookActive: false,
      settings
    };
  }

  return {
    legacySessionWebhookActive: true,
    settings: {
      ...settings,
      providers: {
        ...settings.providers,
        webhook: {
          ...settings.providers.webhook,
          enabled: true,
          url: normalizedUrl
        }
      },
      routes: settings.routes.map((route) =>
        route.event === "session.finished" || route.event === "session.failed"
          ? {
              ...route,
              providers: route.providers.includes("webhook")
                ? route.providers
                : [...route.providers, "webhook"]
            }
          : route
      )
    }
  };
}
