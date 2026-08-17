import type {
  NotificationEventKind,
  NotificationProviderKind,
  ServerEvent
} from "@deskcue/protocol";
import { logger } from "#infrastructure/logging/logger";
import type { SqliteNotificationStateStore } from "#persistence/journals/notificationStateStore";

import { NotificationDeliveryGate } from "./notificationDeliveryGate.ts";
import { createNotificationDeliveryScheduler } from "./notificationDeliveryScheduler.ts";
import { classifyNotificationServerEvent } from "./notificationEventClassifier.ts";
import { createNotificationProviderDispatcher } from "../providers/notificationProviderDispatcher.ts";
import { toNotificationOutboxRecord } from "../state/notificationOutbox.ts";
import { resolveProvidersForEvent } from "../state/notificationSettings.ts";
import { appendBoundedDedupeKey, serializeNotificationState } from "../state/notificationState.ts";
import type {
  NotificationDedupeClaim,
  NotificationDeliveryOptions,
  NotificationPayload,
  StoredNotificationDedupe,
  StoredNotificationSettings,
  StoredPushState
} from "../state/notificationTypes.ts";

type EffectiveNotificationSettings = {
  legacySessionWebhookActive: boolean;
  settings: StoredNotificationSettings;
};

type NotificationDeliveryCoordinatorOptions = {
  fetchImpl: typeof fetch;
  deliveryConcurrency: number;
  deliveryQueueCapacity: number;
  getEffectiveSettings: () => EffectiveNotificationSettings;
  getState: () => StoredPushState;
  outboxMaxRecords: number;
  persistState: () => Promise<void>;
  recoveryRetryDelayMs: number;
  retryDelaysMs: number[];
  sendNotification: (
    subscription: StoredPushState["subscriptions"][number]["subscription"],
    payload: string,
    options: { TTL: number; timeout: number }
  ) => Promise<unknown>;
  setState: (state: StoredPushState) => void;
  stateStore: SqliteNotificationStateStore;
  telegramFetchImpl: typeof fetch;
  externalProviderTimeoutMs: number;
  webPushDeliveryConcurrency: number;
  webPushDeliveryTimeoutMs: number;
};

export function createNotificationDeliveryCoordinator(
  options: NotificationDeliveryCoordinatorOptions
) {
  const notifiedSessionKeys = new Set<string>(options.getState().dedupe.sessionKeys);
  const notifiedAgentSessionKeys = new Set<string>(options.getState().dedupe.agentSessionKeys);
  const notifiedActionRequestKeys = new Set<string>(options.getState().dedupe.actionRequestKeys);
  let readPendingRetryCount = () => 0;
  let closed = false;
  let closing = false;
  const deliveryGate = new NotificationDeliveryGate(
    options.deliveryConcurrency,
    options.deliveryQueueCapacity
  );

  const dispatcher = createNotificationProviderDispatcher({
    deliveryGate,
    fetchImpl: options.fetchImpl,
    getPendingRetryCount: () => readPendingRetryCount(),
    getSettings: () => options.getEffectiveSettings().settings,
    getState: options.getState,
    persistState: options.persistState,
    sendNotification: options.sendNotification,
    setState: options.setState,
    telegramFetchImpl: options.telegramFetchImpl,
    externalProviderTimeoutMs: options.externalProviderTimeoutMs,
    webPushDeliveryConcurrency: options.webPushDeliveryConcurrency,
    webPushDeliveryTimeoutMs: options.webPushDeliveryTimeoutMs
  });
  const scheduler = createNotificationDeliveryScheduler({
    getSettings: () => options.getEffectiveSettings().settings,
    getState: options.getState,
    outboxMaxRecords: options.outboxMaxRecords,
    persistState: options.persistState,
    recordDeliveryDiagnostic: dispatcher.recordDeliveryDiagnostic,
    recoveryRetryDelayMs: options.recoveryRetryDelayMs,
    retryDelaysMs: options.retryDelaysMs,
    sendToProvider: dispatcher.sendToProvider,
    setState: options.setState,
    stateStore: options.stateStore
  });
  readPendingRetryCount = scheduler.getPendingRetryCount;

  const readDedupeKeySet = (bucket: keyof StoredNotificationDedupe) => {
    if (bucket === "agentSessionKeys") {
      return notifiedAgentSessionKeys;
    }
    if (bucket === "actionRequestKeys") {
      return notifiedActionRequestKeys;
    }
    return notifiedSessionKeys;
  };

  const sendEvent = async (
    event: NotificationEventKind,
    payload: NotificationPayload,
    claim: NotificationDedupeClaim,
    providersOverride?: NotificationProviderKind[]
  ) => {
    const keySet = readDedupeKeySet(claim.bucket);
    if (keySet.has(claim.key)) {
      return;
    }

    keySet.add(claim.key);
    const state = options.getState();
    options.setState({
      ...state,
      dedupe: {
        ...state.dedupe,
        [claim.bucket]: appendBoundedDedupeKey(state.dedupe[claim.bucket], claim.key)
      }
    });

    const effectiveSettings = options.getEffectiveSettings().settings;
    const providers = effectiveSettings.enabled
      ? providersOverride ?? resolveProvidersForEvent(effectiveSettings, event)
      : [];
    const retries = scheduler.createInitialRetries(event, payload, providers);
    try {
      options.stateStore.saveStateAndOutbox(
        serializeNotificationState(options.getState()),
        retries.map(toNotificationOutboxRecord)
      );
    } catch (error) {
      keySet.delete(claim.key);
      const currentState = options.getState();
      options.setState({
        ...currentState,
        dedupe: {
          ...currentState.dedupe,
          [claim.bucket]: currentState.dedupe[claim.bucket].filter((item) => item !== claim.key)
        }
      });
      logger.warn("Skipped notification because its durable dispatch could not be persisted", {
        bucket: claim.bucket,
        message: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    await scheduler.dispatchPersistedRetries(retries);
  };

  const handleServerEventAsync = async (event: ServerEvent) => {
    const effectiveSettings = options.getEffectiveSettings();
    for (const classified of classifyNotificationServerEvent(
      event,
      effectiveSettings.legacySessionWebhookActive
    )) {
      await sendEvent(
        classified.event,
        classified.payload,
        classified.claim,
        classified.providersOverride
      );
    }
  };

  return {
    beginClosing() {
      closing = true;
      deliveryGate.beginClosing();
      scheduler.beginClosing();
    },
    async drain() {
      await scheduler.drain();
      await deliveryGate.drain();
    },
    finishClosing() {
      closed = true;
      scheduler.finishClosing();
      notifiedSessionKeys.clear();
      notifiedAgentSessionKeys.clear();
      notifiedActionRequestKeys.clear();
    },
    handleServerEvent(event: ServerEvent) {
      if (closing || closed) {
        return;
      }
      scheduler.trackDelivery(handleServerEventAsync(event));
    },
    resumePendingRetries: scheduler.resumePendingRetries,
    sendToProvider(
      provider: NotificationProviderKind,
      payload: NotificationPayload,
      settings?: StoredNotificationSettings,
      deliveryOptions?: NotificationDeliveryOptions
    ) {
      return dispatcher.sendToProvider(provider, payload, settings, deliveryOptions);
    }
  };
}
