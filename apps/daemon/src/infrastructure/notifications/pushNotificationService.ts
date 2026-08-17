import { dirname, join } from "node:path";
import webPush from "web-push";

import type { UpdateNotificationSettingsInput } from "@deskcue/protocol";
import { daemonConfig } from "#config/daemonConfig";
import { logger } from "#infrastructure/logging/logger";
import { SqliteNotificationStateStore } from "#persistence/journals/notificationStateStore";

import { createNotificationDeliveryCoordinator } from "./delivery/notificationDeliveryCoordinator.ts";
import { createNotificationTestDelivery } from "./delivery/notificationTestDelivery.ts";
import { resolveLegacySessionWebhookSettings } from "./providers/sessionWebhookNotifier.ts";
import {
  createTelegramApiClient,
  fetchTelegramOverIpv4
} from "./providers/telegramNotifications.ts";
import { createTelegramPairingCoordinator } from "./providers/telegramPairingCoordinator.ts";
import { configureWebPush } from "./providers/webPushNotifications.ts";
import { createPushSubscriptionRegistry } from "./pushSubscriptionRegistry.ts";
import { applyNotificationSettingsUpdate, toPublicSettings } from "./state/notificationSettings.ts";
import {
  DEFAULT_EXTERNAL_NOTIFICATION_RECOVERY_RETRY_DELAY_MS,
  DEFAULT_EXTERNAL_NOTIFICATION_RETRY_DELAYS_MS,
  DEFAULT_NOTIFICATION_DELIVERY_CONCURRENCY,
  DEFAULT_NOTIFICATION_DELIVERY_QUEUE_CAPACITY,
  DEFAULT_NOTIFICATION_OUTBOX_MAX_RECORDS,
  DEFAULT_NOTIFICATION_OUTBOX_TTL_MS,
  DEFAULT_WEB_PUSH_DELIVERY_CONCURRENCY,
  DEFAULT_WEB_PUSH_MAX_SUBSCRIPTIONS,
  DEFAULT_WEB_PUSH_SUBSCRIPTION_RETENTION_MS,
  DEFAULT_TELEGRAM_PAIRING_MAX_SESSIONS
} from "./state/notificationTypes.ts";
import type { PushNotificationServiceOptions } from "./state/notificationTypes.ts";
import {
  createPushNotificationStatePersistence,
  loadPushNotificationState
} from "./state/pushNotificationStateLifecycle.ts";

const PUSH_STATE_FILE = "push-notifications.json";

export type PushNotificationService = Awaited<ReturnType<typeof createPushNotificationService>>;

export async function createPushNotificationService(
  options: PushNotificationServiceOptions
) {
  const {
    events,
    fetchImpl = fetch,
    outboxMaxRecords = DEFAULT_NOTIFICATION_OUTBOX_MAX_RECORDS,
    outboxTtlMs = DEFAULT_NOTIFICATION_OUTBOX_TTL_MS,
    recoveryRetryDelayMs = DEFAULT_EXTERNAL_NOTIFICATION_RECOVERY_RETRY_DELAY_MS,
    retryDelaysMs = DEFAULT_EXTERNAL_NOTIFICATION_RETRY_DELAYS_MS,
    sendNotification = webPush.sendNotification.bind(webPush),
    telegramIpv4FetchImpl = fetchTelegramOverIpv4,
    externalProviderTimeoutMs = daemonConfig.notificationProviderTimeoutMs,
    deliveryConcurrency = DEFAULT_NOTIFICATION_DELIVERY_CONCURRENCY,
    deliveryQueueCapacity = DEFAULT_NOTIFICATION_DELIVERY_QUEUE_CAPACITY,
    telegramPairingMaxSessions = DEFAULT_TELEGRAM_PAIRING_MAX_SESSIONS,
    telegramPairingTimeoutMs = externalProviderTimeoutMs,
    webPushDeliveryConcurrency = DEFAULT_WEB_PUSH_DELIVERY_CONCURRENCY,
    webPushDeliveryTimeoutMs = externalProviderTimeoutMs,
    webPushMaxSubscriptions = DEFAULT_WEB_PUSH_MAX_SUBSCRIPTIONS,
    webPushSubscriptionRetentionMs = DEFAULT_WEB_PUSH_SUBSCRIPTION_RETENTION_MS
  } = options;
  const legacySessionWebhookUrl = options.legacySessionWebhookUrl === undefined
    ? daemonConfig.notificationWebhookUrl
    : options.legacySessionWebhookUrl;
  const storagePath = options.storagePath ?? join(
    dirname(daemonConfig.databaseFilePath),
    PUSH_STATE_FILE
  );
  const stateStore = options.stateStore ?? (
    options.databaseFilePath || options.storagePath
      ? new SqliteNotificationStateStore(
          options.databaseFilePath ?? `${storagePath}.sqlite`
        )
      : new SqliteNotificationStateStore()
  );
  let state = await loadPushNotificationState({
    outboxMaxRecords,
    outboxTtlMs,
    stateStore,
    storagePath,
    webPushMaxSubscriptions,
    webPushSubscriptionRetentionMs
  });
  const statePersistence = createPushNotificationStatePersistence(
    stateStore,
    () => state
  );
  const persistState = statePersistence.persistState;
  const telegramApi = createTelegramApiClient(fetchImpl, telegramIpv4FetchImpl);
  let closePromise: Promise<void> | null = null;

  const getEffectiveNotificationSettings = () =>
    resolveLegacySessionWebhookSettings(state.settings, legacySessionWebhookUrl);

  configureWebPush(state.vapid);

  const notificationCoordinator = createNotificationDeliveryCoordinator({
    deliveryConcurrency,
    deliveryQueueCapacity,
    fetchImpl,
    getEffectiveSettings: getEffectiveNotificationSettings,
    getState: () => state,
    outboxMaxRecords,
    persistState,
    recoveryRetryDelayMs,
    retryDelaysMs,
    sendNotification,
    setState: (nextState) => {
      state = nextState;
    },
    stateStore,
    telegramFetchImpl: telegramApi.fetchWithIpv4Fallback,
    externalProviderTimeoutMs,
    webPushDeliveryConcurrency,
    webPushDeliveryTimeoutMs
  });
  const subscriptionRegistry = createPushSubscriptionRegistry({
    getState: () => state,
    maxSubscriptions: webPushMaxSubscriptions,
    persistState,
    setState: (nextState) => {
      state = nextState;
    }
  });
  const telegramPairing = createTelegramPairingCoordinator({
    getSettings: () => state.settings,
    maxSessions: telegramPairingMaxSessions,
    requestTimeoutMs: telegramPairingTimeoutMs,
    telegramApi
  });
  const testDelivery = createNotificationTestDelivery({
    getEffectiveSettings: () => getEffectiveNotificationSettings().settings,
    getSettings: () => state.settings,
    providerSender: notificationCoordinator
  });

  const handleServerEvent = notificationCoordinator.handleServerEvent;
  const close = () => {
    if (closePromise) {
      return closePromise;
    }

    notificationCoordinator.beginClosing();
    const closeTelegramPairing = telegramPairing.close();
    events.off?.("event", handleServerEvent);
    closePromise = (async () => {
      try {
        await Promise.all([
          notificationCoordinator.drain(),
          closeTelegramPairing
        ]);
        await statePersistence.flushPendingSaves().catch((error) => {
          logger.warn("Failed to flush notification state during shutdown", {
            message: error instanceof Error ? error.message : String(error)
          });
        });
      } finally {
        notificationCoordinator.finishClosing();
        stateStore.close();
      }
    })();
    return closePromise;
  };

  events.on("event", handleServerEvent);
  try {
    notificationCoordinator.resumePendingRetries();
    await persistState();
  } catch (startupError) {
    try {
      await close();
    } catch (rollbackError) {
      throw new AggregateError(
        [startupError, rollbackError],
        "Notification service startup failed and its rollback was incomplete."
      );
    }
    throw startupError;
  }

  return {
    close,
    getPublicKey() {
      return state.vapid.publicKey;
    },
    getNotificationSettings() {
      return toPublicSettings(
        getEffectiveNotificationSettings().settings,
        state.diagnostics
      );
    },
    getStatus() {
      return {
        publicKey: state.vapid.publicKey,
        subscriptionCount: state.subscriptions.length,
        supported: true
      };
    },
    listSubscriptions: subscriptionRegistry.listSubscriptions,
    registerSubscription: subscriptionRegistry.registerSubscription,
    resolveTelegramPairing: telegramPairing.resolveTelegramPairing,
    startTelegramPairing: telegramPairing.startTelegramPairing,
    removeSubscription: subscriptionRegistry.removeSubscription,
    removeSubscriptionById: subscriptionRegistry.removeSubscriptionById,
    sendTestNotification: testDelivery.sendTestNotification,
    sendTestPush: testDelivery.sendTestPush,
    async updateNotificationSettings(input: UpdateNotificationSettingsInput) {
      state = {
        ...state,
        settings: applyNotificationSettingsUpdate(state.settings, input)
      };
      await persistState();
      return toPublicSettings(
        getEffectiveNotificationSettings().settings,
        state.diagnostics
      );
    }
  };
}
