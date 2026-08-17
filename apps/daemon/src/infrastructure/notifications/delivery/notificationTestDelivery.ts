import type {
  NotificationProviderKind,
  NotificationTestResponse,
  UpdateNotificationSettingsInput
} from "@deskcue/protocol";

import { applyNotificationSettingsUpdate } from "../state/notificationSettings.ts";
import type {
  NotificationDeliveryResult,
  StoredNotificationSettings
} from "../state/notificationTypes.ts";

type NotificationProviderSender = {
  sendToProvider(
    provider: NotificationProviderKind,
    payload: {
      body: string;
      tag: string;
      title: string;
      url: string;
    },
    settings: StoredNotificationSettings,
    options: {
      attempt: number;
      event: "test";
      maxAttempts: number;
    }
  ): Promise<NotificationDeliveryResult>;
};

type NotificationTestDeliveryOptions = {
  getEffectiveSettings: () => StoredNotificationSettings;
  getSettings: () => StoredNotificationSettings;
  providerSender: NotificationProviderSender;
};

function toNotificationTestResponse(
  result: NotificationDeliveryResult
): NotificationTestResponse {
  const { retryable: _retryable, ...response } = result;
  return response;
}

export function createNotificationTestDelivery({
  getEffectiveSettings,
  getSettings,
  providerSender
}: NotificationTestDeliveryOptions) {
  async function sendTestNotification(
    provider: NotificationProviderKind,
    settingsOverride?: UpdateNotificationSettingsInput
  ) {
    const settings = settingsOverride
      ? applyNotificationSettingsUpdate(getSettings(), settingsOverride)
      : getEffectiveSettings();
    const result = await providerSender.sendToProvider(provider, {
      body: "DeskCue notifications are configured.",
      tag: `deskcue-notification-test-${provider}`,
      title: "DeskCue test notification",
      url: "/"
    }, settings, {
      attempt: 1,
      event: "test",
      maxAttempts: 1
    });
    return toNotificationTestResponse(result);
  }

  async function sendTestPush() {
    const result = await providerSender.sendToProvider("web_push", {
      body: "DeskCue push notifications are configured.",
      tag: "deskcue-push-test",
      title: "DeskCue test notification",
      url: "/"
    }, getSettings(), {
      attempt: 1,
      event: "test",
      maxAttempts: 1
    });
    return {
      attempted: result.attempted,
      delivered: result.delivered,
      failed: result.failed
    };
  }

  return {
    sendTestNotification,
    sendTestPush
  };
}
