import type {
  NotificationDeliveryAttemptDiagnostic,
  NotificationProviderKind,
  PushNotificationTestResponse
} from "@deskcue/protocol";
import { logger } from "#infrastructure/logging/logger";

import {
  isRetryableNotificationDeliveryError,
  sendExternalProvider
} from "./externalNotificationProviders.ts";
import { isStaleSubscriptionError } from "./webPushNotifications.ts";
import {
  NotificationDeliveryAdmissionError,
  NotificationDeliveryGate
} from "../delivery/notificationDeliveryGate.ts";
import { isProviderEnabled } from "../state/notificationSettings.ts";
import { isFileNotFound } from "../state/notificationState.ts";
import type {
  NotificationDeliveryOptions,
  NotificationDeliveryResult,
  NotificationPayload,
  StoredNotificationSettings,
  StoredPushState
} from "../state/notificationTypes.ts";

type NotificationProviderDispatcherOptions = {
  deliveryGate: NotificationDeliveryGate;
  fetchImpl: typeof fetch;
  getPendingRetryCount: () => number;
  getSettings: () => StoredNotificationSettings;
  getState: () => StoredPushState;
  persistState: () => Promise<void>;
  sendNotification: (
    subscription: StoredPushState["subscriptions"][number]["subscription"],
    payload: string,
    options: { TTL: number; timeout: number }
  ) => Promise<unknown>;
  setState: (state: StoredPushState) => void;
  telegramFetchImpl: typeof fetch;
  externalProviderTimeoutMs: number;
  webPushDeliveryConcurrency: number;
  webPushDeliveryTimeoutMs: number;
};

class WebPushDeliveryTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Web Push delivery exceeded ${timeoutMs}ms and its outcome is uncertain.`);
  }
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  requestedConcurrency: number,
  operation: (item: T) => Promise<void>
) {
  let nextIndex = 0;
  const concurrency = Math.min(
    items.length,
    Math.max(1, Number.isSafeInteger(requestedConcurrency) ? requestedConcurrency : 1)
  );
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      if (item !== undefined) await operation(item);
    }
  }));
}

function withDeadline<T>(operation: Promise<T>, timeoutMs: number) {
  let timeout: NodeJS.Timeout | null = null;
  const boundedTimeoutMs = Number.isFinite(timeoutMs) ? Math.max(1, timeoutMs) : 3_000;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new WebPushDeliveryTimeoutError(boundedTimeoutMs)), boundedTimeoutMs);
    timeout.unref?.();
  });
  return Promise.race([operation, deadline]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

export function createNotificationProviderDispatcher(
  options: NotificationProviderDispatcherOptions
) {
  const persistDiagnostics = () => {
    void options.persistState().catch((error) => {
      if (isFileNotFound(error)) {
        return;
      }

      logger.warn("Failed to persist notification delivery diagnostics", {
        message: error instanceof Error ? error.message : String(error)
      });
    });
  };

  const recordDeliveryDiagnostic = (attempt: NotificationDeliveryAttemptDiagnostic) => {
    const state = options.getState();
    const diagnostics = {
      ...state.diagnostics,
      lastAttempt: attempt,
      lastFailure:
        attempt.status === "failed" || attempt.status === "uncertain"
          ? attempt
          : state.diagnostics.lastFailure,
      lastSuccess: attempt.status === "delivered" ? attempt : state.diagnostics.lastSuccess,
      pendingRetries: options.getPendingRetryCount()
    };
    options.setState({
      ...state,
      diagnostics
    });
    persistDiagnostics();
  };

  const sendWebPushToAll = async (
    payload: NotificationPayload
  ): Promise<PushNotificationTestResponse & { uncertain: number }> => {
    const subscriptions = [...options.getState().subscriptions];
    let delivered = 0;
    let failed = 0;
    let uncertain = 0;
    const staleSubscriptionIds = new Set<string>();
    const deliveredSubscriptionIds = new Set<string>();

    await mapWithConcurrency(
      subscriptions,
      options.webPushDeliveryConcurrency,
      async (record) => {
        try {
          await options.deliveryGate.run(async (signal) => {
            signal.throwIfAborted();
            await withDeadline(
              options.sendNotification(record.subscription, JSON.stringify({
                body: payload.body,
                data: {
                  ...(payload.data ?? {}),
                  url: payload.url
                },
                tag: payload.tag,
                title: payload.title
              }), {
                TTL: 60,
                timeout: Math.max(1, options.webPushDeliveryTimeoutMs)
              }),
              options.webPushDeliveryTimeoutMs
            );
          });
          delivered += 1;
          deliveredSubscriptionIds.add(record.id);
        } catch (error) {
          failed += 1;
          if (
            error instanceof WebPushDeliveryTimeoutError ||
            error instanceof NotificationDeliveryAdmissionError
          ) uncertain += 1;
          if (isStaleSubscriptionError(error)) {
            staleSubscriptionIds.add(record.id);
          }
          logger.warn("Web Push delivery failed", {
            message: error instanceof Error ? error.message : String(error),
            subscriptionId: record.id
          });
        }
      }
    );

    if (staleSubscriptionIds.size > 0 || deliveredSubscriptionIds.size > 0) {
      const deliveredAt = new Date().toISOString();
      const state = options.getState();
      options.setState({
        ...state,
        subscriptions: state.subscriptions
          .filter((subscription) => !staleSubscriptionIds.has(subscription.id))
          .map((subscription) =>
            deliveredSubscriptionIds.has(subscription.id)
              ? { ...subscription, lastDeliveredAt: deliveredAt }
              : subscription
          )
      });
      await options.persistState();
    }

    return {
      attempted: subscriptions.length,
      delivered,
      failed,
      uncertain
    };
  };

  const sendToProvider = async (
    provider: NotificationProviderKind,
    payload: NotificationPayload,
    settings = options.getSettings(),
    deliveryOptions: NotificationDeliveryOptions = {}
  ): Promise<NotificationDeliveryResult> => {
    const attempt = deliveryOptions.attempt ?? 1;
    const maxAttempts = deliveryOptions.maxAttempts ?? 1;
    const event = deliveryOptions.event ?? null;
    if (!isProviderEnabled(settings, provider)) {
      return {
        attempted: 0,
        delivered: 0,
        failed: 0,
        provider
      };
    }

    if (provider === "web_push") {
      const result = await sendWebPushToAll(payload);
      recordDeliveryDiagnostic({
        attempt,
        attemptedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        delivered: result.delivered,
        error: result.failed > 0 ? "One or more Web Push subscriptions failed." : null,
        event,
        failed: result.failed,
        maxAttempts,
        nextRetryAt: null,
        provider,
        status: result.uncertain > 0 && result.delivered === 0
          ? "uncertain"
          : result.failed > 0 && result.delivered === 0
            ? "failed"
            : "delivered",
        tag: payload.tag
      });
      const { uncertain: _uncertain, ...deliveryResult } = result;
      return {
        ...deliveryResult,
        provider
      };
    }

    try {
      await options.deliveryGate.run((signal) => sendExternalProvider(
        provider,
        payload,
        options.fetchImpl,
        settings,
        options.telegramFetchImpl,
        { signal, timeoutMs: options.externalProviderTimeoutMs }
      ));
      recordDeliveryDiagnostic({
        attempt,
        attemptedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        delivered: 1,
        error: null,
        event,
        failed: 0,
        maxAttempts,
        nextRetryAt: null,
        provider,
        status: "delivered",
        tag: payload.tag
      });
      return {
        attempted: 1,
        delivered: 1,
        failed: 0,
        provider
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = error instanceof NotificationDeliveryAdmissionError ||
        isRetryableNotificationDeliveryError(error);
      recordDeliveryDiagnostic({
        attempt,
        attemptedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        delivered: 0,
        error: message,
        event,
        failed: 1,
        maxAttempts,
        nextRetryAt: null,
        provider,
        status: retryable ? "uncertain" : "failed",
        tag: payload.tag
      });
      logger.warn("Notification provider delivery failed", {
        attempt,
        maxAttempts,
        message,
        provider
      });
      return {
        attempted: 1,
        delivered: 0,
        error: message,
        failed: 1,
        provider,
        retryable
      };
    }
  };

  return {
    recordDeliveryDiagnostic,
    sendToProvider
  };
}
