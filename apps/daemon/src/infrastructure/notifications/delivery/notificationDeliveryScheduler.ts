import type {
  NotificationDeliveryAttemptDiagnostic,
  NotificationEventKind,
  NotificationProviderKind
} from "@deskcue/protocol";
import { logger } from "#infrastructure/logging/logger";
import type { SqliteNotificationStateStore } from "#persistence/journals/notificationStateStore";

import { resolveExternalNotificationRetryDelay } from "../providers/externalNotificationProviders.ts";
import {
  buildNotificationRetryKey,
  persistNotificationOutboxRetry
} from "../state/notificationOutbox.ts";
import { isFileNotFound } from "../state/notificationState.ts";
import type {
  NotificationDeliveryOptions,
  NotificationDeliveryResult,
  NotificationPayload,
  QueuedNotificationRetry,
  StoredNotificationRetry,
  StoredNotificationSettings,
  StoredPushState
} from "../state/notificationTypes.ts";

type NotificationDeliverySchedulerOptions = {
  getState: () => StoredPushState;
  outboxMaxRecords: number;
  persistState: () => Promise<void>;
  recordDeliveryDiagnostic: (attempt: NotificationDeliveryAttemptDiagnostic) => void;
  recoveryRetryDelayMs: number;
  retryDelaysMs: number[];
  sendToProvider: (
    provider: NotificationProviderKind,
    payload: NotificationPayload,
    settings?: StoredNotificationSettings,
    options?: NotificationDeliveryOptions
  ) => Promise<NotificationDeliveryResult>;
  setState: (state: StoredPushState) => void;
  stateStore: SqliteNotificationStateStore;
  getSettings: () => StoredNotificationSettings;
};

export function createNotificationDeliveryScheduler(
  options: NotificationDeliverySchedulerOptions
) {
  const pendingRetries = new Map<string, QueuedNotificationRetry>();
  const activeDeliveries = new Set<Promise<void>>();
  let closed = false;
  let closing = false;

  const updatePendingRetryDiagnostics = () => {
    const state = options.getState();
    options.setState({
      ...state,
      diagnostics: {
        ...state.diagnostics,
        pendingRetries: pendingRetries.size
      }
    });
    void options.persistState().catch((error) => {
      if (isFileNotFound(error)) {
        return;
      }
      logger.warn("Failed to persist notification delivery diagnostics", {
        message: error instanceof Error ? error.message : String(error)
      });
    });
  };

  const queueRetry = (
    retry: StoredNotificationRetry,
    { persist = true }: { persist?: boolean } = {}
  ) => {
    const existing = pendingRetries.get(retry.key);
    if (existing?.timer) {
      clearTimeout(existing.timer);
    }

    pendingRetries.set(retry.key, { ...retry });
    const state = options.getState();
    options.setState({
      ...state,
      pendingRetries: [
        ...state.pendingRetries.filter((item) => item.key !== retry.key),
        retry
      ]
    });
    if (persist) {
      persistNotificationOutboxRetry(options.stateStore, retry);
    }

    while (pendingRetries.size > Math.max(1, options.outboxMaxRecords)) {
      const oldest = [...pendingRetries.values()].sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.key.localeCompare(right.key)
      )[0];
      if (!oldest) {
        break;
      }
      if (oldest.timer) {
        clearTimeout(oldest.timer);
      }
      pendingRetries.delete(oldest.key);
      options.stateStore.deleteOutbox(oldest.key);
      const currentState = options.getState();
      options.setState({
        ...currentState,
        pendingRetries: currentState.pendingRetries.filter((item) => item.key !== oldest.key)
      });
      logger.warn("Dropped oldest notification retry because the outbox is full", {
        event: oldest.event,
        provider: oldest.provider
      });
    }
  };

  const trackDelivery = (delivery: Promise<void>) => {
    const observed = delivery.catch((error) => {
      logger.warn("Notification event delivery failed unexpectedly", {
        message: error instanceof Error ? error.message : String(error)
      });
    });
    activeDeliveries.add(observed);
    void observed.finally(() => {
      activeDeliveries.delete(observed);
    });
  };

  let runRetry: (key: string) => Promise<void>;

  const armRetry = (retry: StoredNotificationRetry, retryDelayMs: number) => {
    if (closed || closing) {
      return;
    }

    const existing = pendingRetries.get(retry.key);
    if (existing?.timer) {
      clearTimeout(existing.timer);
    }
    const timer = setTimeout(() => {
      trackDelivery(runRetry(retry.key));
    }, Math.max(0, retryDelayMs));
    timer.unref?.();
    pendingRetries.set(retry.key, { ...retry, timer });
  };

  const scheduleRetry = async (
    event: NotificationEventKind,
    provider: Exclude<NotificationProviderKind, "web_push">,
    payload: NotificationPayload,
    attempt: number,
    maxAttempts: number,
    retryDelayMs = resolveExternalNotificationRetryDelay(
      attempt,
      options.retryDelaysMs,
      options.recoveryRetryDelayMs
    ),
    createdAt = new Date().toISOString()
  ) => {
    if (closed) {
      return;
    }

    const retry: StoredNotificationRetry = {
      attempt,
      createdAt,
      event,
      key: buildNotificationRetryKey(event, provider, payload),
      maxAttempts,
      nextRetryAt: new Date(Date.now() + retryDelayMs).toISOString(),
      payload,
      provider
    };
    queueRetry(retry);
    await options.persistState();
    if (!pendingRetries.has(retry.key)) {
      updatePendingRetryDiagnostics();
      return;
    }

    options.recordDeliveryDiagnostic({
      attempt,
      attemptedAt: new Date().toISOString(),
      completedAt: null,
      delivered: 0,
      error: null,
      event,
      failed: 0,
      maxAttempts,
      nextRetryAt: retry.nextRetryAt,
      provider,
      status: "scheduled",
      tag: payload.tag
    });
    logger.info("Notification provider retry scheduled", {
      attempt,
      event,
      maxAttempts,
      nextRetryAt: retry.nextRetryAt,
      provider
    });
    await options.persistState();
    armRetry(retry, retryDelayMs);
  };

  runRetry = async (key: string) => {
    if (closed) {
      return;
    }
    const retry = pendingRetries.get(key);
    if (!retry) {
      return;
    }

    const result = await options.sendToProvider(
      retry.provider,
      retry.payload,
      options.getSettings(),
      {
        attempt: retry.attempt,
        event: retry.event,
        maxAttempts: retry.maxAttempts
      }
    );
    if (closed) {
      return;
    }

    if (
      retry.provider !== "web_push" &&
      result.failed > 0 &&
      result.retryable &&
      retry.attempt < retry.maxAttempts
    ) {
      await scheduleRetry(
        retry.event,
        retry.provider,
        retry.payload,
        retry.attempt + 1,
        retry.maxAttempts,
        undefined,
        retry.createdAt
      );
      return;
    }

    pendingRetries.delete(key);
    options.stateStore.deleteOutbox(key);
    const state = options.getState();
    options.setState({
      ...state,
      pendingRetries: state.pendingRetries.filter((item) => item.key !== key)
    });
    updatePendingRetryDiagnostics();
    await options.persistState();
  };

  return {
    beginClosing() {
      closing = true;
      for (const retry of pendingRetries.values()) {
        if (retry.timer) {
          clearTimeout(retry.timer);
        }
      }
    },
    createInitialRetries(
      event: NotificationEventKind,
      payload: NotificationPayload,
      providers: NotificationProviderKind[]
    ): StoredNotificationRetry[] {
      const createdAt = new Date().toISOString();
      return providers.map((provider) => ({
        attempt: 1,
        createdAt,
        event,
        key: buildNotificationRetryKey(event, provider, payload),
        maxAttempts: provider === "web_push" ? 1 : options.retryDelaysMs.length + 1,
        nextRetryAt: createdAt,
        payload,
        provider
      }));
    },
    async dispatchPersistedRetries(retries: StoredNotificationRetry[]) {
      for (const retry of retries) {
        queueRetry(retry, { persist: false });
      }
      updatePendingRetryDiagnostics();
      await Promise.allSettled(retries.map(async (retry) => {
        await runRetry(retry.key);
        logger.info("Notification provider delivery completed", {
          event: retry.event,
          provider: retry.provider
        });
      }));
    },
    async drain() {
      while (activeDeliveries.size > 0) {
        await Promise.allSettled([...activeDeliveries]);
      }
    },
    finishClosing() {
      closed = true;
      pendingRetries.clear();
    },
    getPendingRetryCount() {
      return pendingRetries.size;
    },
    resumePendingRetries() {
      const now = Date.now();
      for (const retry of options.getState().pendingRetries) {
        armRetry(retry, Math.max(0, Date.parse(retry.nextRetryAt) - now));
      }
      updatePendingRetryDiagnostics();
    },
    trackDelivery
  };
}
