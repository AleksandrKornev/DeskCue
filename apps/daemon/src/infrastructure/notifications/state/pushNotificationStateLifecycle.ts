import { logger } from "#infrastructure/logging/logger";
import type { SqliteNotificationStateStore } from "#persistence/journals/notificationStateStore";

import {
  loadStoredNotificationOutbox,
  persistNotificationOutboxRetry
} from "./notificationOutbox.ts";
import {
  loadPushState,
  loadPushStateFromJson,
  pruneStalePushSubscriptions,
  retainNewestPushSubscriptions,
  serializeNotificationState
} from "./notificationState.ts";
import type { StoredPushState } from "./notificationTypes.ts";

type LoadPushNotificationStateOptions = {
  outboxMaxRecords: number;
  outboxTtlMs: number;
  stateStore: SqliteNotificationStateStore;
  storagePath: string;
  webPushSubscriptionRetentionMs: number;
  webPushMaxSubscriptions: number;
};

export async function loadPushNotificationState({
  outboxMaxRecords,
  outboxTtlMs,
  stateStore,
  storagePath,
  webPushMaxSubscriptions,
  webPushSubscriptionRetentionMs
}: LoadPushNotificationStateOptions) {
  const prunedOutboxKeys = stateStore.pruneOutbox({
    maxRecords: Math.max(1, outboxMaxRecords),
    oldestCreatedAt: new Date(Date.now() - Math.max(1, outboxTtlMs)).toISOString()
  });
  if (prunedOutboxKeys.length > 0) {
    logger.warn("Pruned stale or excess notification retries", {
      prunedRetries: prunedOutboxKeys.length
    });
  }

  const storedState = loadPushStateFromJson(stateStore.loadStateJson());
  let state = storedState ?? await loadPushState(storagePath);
  state = {
    ...state,
    subscriptions: retainNewestPushSubscriptions(
      pruneStalePushSubscriptions(
        state.subscriptions,
        Date.now() - Math.max(1, webPushSubscriptionRetentionMs)
      ),
      webPushMaxSubscriptions
    )
  };

  const storedOutbox = loadStoredNotificationOutbox(stateStore);
  if (storedOutbox.length === 0 && state.pendingRetries.length > 0) {
    for (const retry of state.pendingRetries) {
      persistNotificationOutboxRetry(stateStore, retry);
    }
  }
  state = {
    ...state,
    pendingRetries: storedOutbox.length > 0 ? storedOutbox : state.pendingRetries
  };

  return {
    ...state,
    diagnostics: {
      ...state.diagnostics,
      pendingRetries: state.pendingRetries.length
    }
  };
}

export function createPushNotificationStatePersistence(
  stateStore: SqliteNotificationStateStore,
  getState: () => StoredPushState
) {
  let stateSaveChain = Promise.resolve();

  const saveState = async () => {
    stateStore.saveStateJson(serializeNotificationState(getState()));
  };

  return {
    flushPendingSaves() {
      return stateSaveChain;
    },
    async persistState() {
      stateSaveChain = stateSaveChain
        .catch(() => undefined)
        .then(saveState);
      await stateSaveChain;
    }
  };
}
