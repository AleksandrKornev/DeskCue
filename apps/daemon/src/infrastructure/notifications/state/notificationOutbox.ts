import type { NotificationEventKind, NotificationProviderKind } from "@deskcue/protocol";
import { logger } from "#infrastructure/logging/logger";
import type { SqliteNotificationStateStore } from "#persistence/journals/notificationStateStore";

import { normalizeStoredNotificationRetries } from "./notificationState.ts";
import type { NotificationPayload, StoredNotificationRetry } from "./notificationTypes.ts";

export function toNotificationOutboxRecord(retry: StoredNotificationRetry) {
  return {
    attempt: retry.attempt,
    createdAt: retry.createdAt,
    event: retry.event,
    key: retry.key,
    maxAttempts: retry.maxAttempts,
    nextRetryAt: retry.nextRetryAt,
    payloadJson: JSON.stringify(retry.payload),
    provider: retry.provider
  };
}

function discardInvalidOutboxRecord(
  stateStore: SqliteNotificationStateStore,
  key: string,
  provider: string
) {
  stateStore.deleteOutbox(key);
  logger.warn("Discarded invalid notification outbox record", { key, provider });
}

export function loadStoredNotificationOutbox(
  stateStore: SqliteNotificationStateStore
): StoredNotificationRetry[] {
  const retries: StoredNotificationRetry[] = [];
  for (const record of stateStore.listOutbox()) {
    let candidate: unknown;
    try {
      candidate = {
        attempt: record.attempt,
        createdAt: record.createdAt,
        event: record.event,
        key: record.key,
        maxAttempts: record.maxAttempts,
        nextRetryAt: record.nextRetryAt,
        payload: JSON.parse(record.payloadJson) as unknown,
        provider: record.provider
      };
    } catch {
      discardInvalidOutboxRecord(stateStore, record.key, record.provider);
      continue;
    }

    const [retry] = normalizeStoredNotificationRetries([candidate]);
    if (!retry) {
      discardInvalidOutboxRecord(stateStore, record.key, record.provider);
      continue;
    }
    retries.push(retry);
  }
  return retries;
}

export function persistNotificationOutboxRetry(
  stateStore: SqliteNotificationStateStore,
  retry: StoredNotificationRetry
) {
  stateStore.upsertOutbox(toNotificationOutboxRecord(retry));
}

export function buildNotificationRetryKey(
  event: NotificationEventKind,
  provider: NotificationProviderKind,
  payload: NotificationPayload
) {
  return `${event}:${provider}:${payload.tag}`;
}
