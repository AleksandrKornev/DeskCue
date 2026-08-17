import type {
  NotificationProviderKind,
  NotificationSettingsResponse,
  NotificationTestResponse,
  PushNotificationStatusResponse,
  PushNotificationTestResponse,
  PushSubscriptionRegistrationResponse,
  PushSubscriptionRemovalResponse,
  TelegramNotificationPairingResolveResponse,
  TelegramNotificationPairingStartResponse,
  UpdateNotificationSettingsInput
} from "@deskcue/protocol";
import {
  deleteApi,
  getJson,
  patchApi,
  postApi
} from "@api/transport/requests";

import type {
  RegisterPushSubscriptionPayload,
  PushSubscriptionListResponse,
  PushSubscriptionRemovalByIdResponse,
  RemovePushSubscriptionPayload
} from "./types";

export const notificationsApi = {
  getSettings() {
    return getJson<NotificationSettingsResponse>(
      "/api/notifications/settings",
      "Failed to load notification settings"
    );
  },

  updateSettings(input: UpdateNotificationSettingsInput) {
    return patchApi<NotificationSettingsResponse>(
      "/api/notifications/settings",
      input
    );
  },

  startTelegramPairing(settings?: UpdateNotificationSettingsInput) {
    return postApi<TelegramNotificationPairingStartResponse>(
      "/api/notifications/telegram/pairing/start",
      {
        ...(settings ? { settings } : {})
      }
    );
  },

  resolveTelegramPairing(code: string) {
    return postApi<TelegramNotificationPairingResolveResponse>(
      "/api/notifications/telegram/pairing/resolve",
      {
        code
      }
    );
  },

  sendTest(provider: NotificationProviderKind, settings?: UpdateNotificationSettingsInput) {
    return postApi<NotificationTestResponse>("/api/notifications/test", {
      provider,
      ...(settings ? { settings } : {})
    });
  },

  getPushStatus() {
    return getJson<PushNotificationStatusResponse>(
      "/api/push/status",
      "Failed to load push notification status"
    );
  },

  listPushSubscriptions(pushClientId?: string) {
    const query = pushClientId
      ? `?${new URLSearchParams({ pushClientId }).toString()}`
      : "";

    return getJson<PushSubscriptionListResponse>(
      `/api/push/subscriptions${query}`,
      "Failed to load browser push subscriptions"
    );
  },

  registerPushSubscription(payload: RegisterPushSubscriptionPayload) {
    return postApi<PushSubscriptionRegistrationResponse>("/api/push/subscriptions", payload);
  },

  removePushSubscription(payload: RemovePushSubscriptionPayload) {
    return deleteApi<PushSubscriptionRemovalResponse>("/api/push/subscriptions", payload);
  },

  removePushSubscriptionById(id: string) {
    return deleteApi<PushSubscriptionRemovalByIdResponse>(
      `/api/push/subscriptions/${encodeURIComponent(id)}`
    );
  },

  sendTestPush() {
    return postApi<PushNotificationTestResponse>("/api/push/test");
  }
};
