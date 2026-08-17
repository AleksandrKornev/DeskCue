import { readFile } from "node:fs/promises";
import webPush from "web-push";

import type {
  NotificationDeliveryAttemptDiagnostic,
  NotificationDeliveryDiagnostics,
  NotificationDeliveryDiagnosticEvent
} from "@deskcue/protocol";
import { logger } from "#infrastructure/logging/logger";

import {
  createDefaultNotificationSettings,
  normalizeNotificationSettings
} from "./notificationSettings.ts";
import { isNotificationEvent, isNotificationProvider, isRecord } from "./notificationTypes.ts";
import type {
  StoredNotificationDedupe,
  StoredNotificationRetry,
  StoredPushState,
  StoredPushSubscription
} from "./notificationTypes.ts";

const NOTIFICATION_DEDUPE_MAX_KEYS = 500;

export function serializeNotificationState(state: StoredPushState) {
  return JSON.stringify({ ...state, pendingRetries: [] });
}

export function isCurrentPushSubscription(
  subscription: StoredPushSubscription,
  accessDeviceId: string | null,
  pushClientId: string | null
) {
  if (!accessDeviceId && !pushClientId) return false;
  return (
    (!accessDeviceId || subscription.accessDeviceId === accessDeviceId) &&
    (!pushClientId || subscription.pushClientId === pushClientId)
  );
}

export function pruneStalePushSubscriptions(
  subscriptions: StoredPushSubscription[],
  cutoffMs: number
) {
  return subscriptions.filter((subscription) => {
    const activityAt = [subscription.lastDeliveredAt, subscription.updatedAt, subscription.createdAt]
      .map((value) => typeof value === "string" ? Date.parse(value) : Number.NaN)
      .filter(Number.isFinite)
      .reduce((latest, value) => Math.max(latest, value), Number.NEGATIVE_INFINITY);
    return activityAt >= cutoffMs;
  });
}

export function retainNewestPushSubscriptions(
  subscriptions: StoredPushSubscription[],
  maxSubscriptions: number
) {
  const boundedLimit = Number.isSafeInteger(maxSubscriptions)
    ? Math.max(1, maxSubscriptions)
    : 1;
  return subscriptions
    .map((subscription, index) => ({ index, subscription }))
    .sort((left, right) =>
      right.subscription.updatedAt.localeCompare(left.subscription.updatedAt) ||
      right.subscription.createdAt.localeCompare(left.subscription.createdAt) ||
      right.index - left.index
    )
    .slice(0, boundedLimit)
    .map(({ subscription }) => subscription);
}

export function formatPushSubscriptionLabel(userAgent: string | null) {
  if (!userAgent) return "Unknown browser";
  const mobile = /mobile|android|iphone|ipad/i.test(userAgent);
  if (/edg\//i.test(userAgent)) return mobile ? "Edge on mobile" : "Edge";
  if (/firefox\//i.test(userAgent)) return mobile ? "Firefox on mobile" : "Firefox";
  if (/chrome\//i.test(userAgent) || /crios\//i.test(userAgent)) return mobile ? "Chrome on mobile" : "Chrome";
  if (/safari\//i.test(userAgent)) return mobile ? "Safari on mobile" : "Safari";
  return mobile ? "Mobile browser" : "Browser";
}

export function createEmptyNotificationDeliveryDiagnostics(): NotificationDeliveryDiagnostics {
  return { lastAttempt: null, lastFailure: null, lastSuccess: null, pendingRetries: 0 };
}

export function createEmptyNotificationDedupe(): StoredNotificationDedupe {
  return { actionRequestKeys: [], agentSessionKeys: [], sessionKeys: [] };
}

export function appendBoundedDedupeKey(keys: string[], key: string) {
  return [...keys.filter((item) => item !== key), key].slice(-NOTIFICATION_DEDUPE_MAX_KEYS);
}

export function normalizeStoredNotificationRetries(input: unknown): StoredNotificationRetry[] {
  if (!Array.isArray(input)) return [];
  const retries = new Map<string, StoredNotificationRetry>();
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const retry = item as Record<string, unknown>;
    const payload = retry.payload;
    if (
      typeof retry.attempt !== "number" || !Number.isInteger(retry.attempt) || retry.attempt < 1 ||
      !isNotificationEvent(retry.event) || typeof retry.key !== "string" ||
      typeof retry.maxAttempts !== "number" || !Number.isInteger(retry.maxAttempts) ||
      retry.maxAttempts < retry.attempt || typeof retry.nextRetryAt !== "string" ||
      Number.isNaN(Date.parse(retry.nextRetryAt)) || !isNotificationProvider(retry.provider) ||
      !payload || typeof payload !== "object" ||
      typeof (payload as Record<string, unknown>).body !== "string" ||
      typeof (payload as Record<string, unknown>).tag !== "string" ||
      typeof (payload as Record<string, unknown>).title !== "string" ||
      typeof (payload as Record<string, unknown>).url !== "string"
    ) continue;

    retries.set(retry.key, {
      attempt: retry.attempt,
      createdAt: typeof retry.createdAt === "string" && !Number.isNaN(Date.parse(retry.createdAt))
        ? retry.createdAt : retry.nextRetryAt,
      event: retry.event,
      key: retry.key,
      maxAttempts: retry.maxAttempts,
      nextRetryAt: retry.nextRetryAt,
      payload: {
        body: (payload as Record<string, unknown>).body as string,
        data: isRecord((payload as Record<string, unknown>).data)
          ? (payload as Record<string, unknown>).data as Record<string, unknown> : undefined,
        tag: (payload as Record<string, unknown>).tag as string,
        title: (payload as Record<string, unknown>).title as string,
        url: (payload as Record<string, unknown>).url as string,
        webhookBody: Object.hasOwn(payload, "webhookBody")
          ? (payload as Record<string, unknown>).webhookBody
          : undefined
      },
      provider: retry.provider
    });
  }
  return [...retries.values()];
}

function normalizeDedupeKeyList(input: unknown) {
  return Array.isArray(input)
    ? input.filter((item): item is string => typeof item === "string" && item.length > 0)
        .slice(-NOTIFICATION_DEDUPE_MAX_KEYS)
    : [];
}

export function normalizeNotificationDedupe(input: unknown): StoredNotificationDedupe {
  if (!input || typeof input !== "object") return createEmptyNotificationDedupe();
  const dedupe = input as Record<string, unknown>;
  return {
    actionRequestKeys: normalizeDedupeKeyList(dedupe.actionRequestKeys),
    agentSessionKeys: normalizeDedupeKeyList(dedupe.agentSessionKeys),
    sessionKeys: normalizeDedupeKeyList(dedupe.sessionKeys)
  };
}

function isNotificationDeliveryDiagnosticEvent(value: unknown): value is NotificationDeliveryDiagnosticEvent {
  return value === "test" || isNotificationEvent(value);
}

function isNotificationDeliveryStatus(
  value: unknown
): value is NotificationDeliveryAttemptDiagnostic["status"] {
  return value === "delivered" || value === "failed" || value === "scheduled" || value === "uncertain";
}

function normalizeNotificationDeliveryAttemptDiagnostic(
  input: unknown
): NotificationDeliveryAttemptDiagnostic | null {
  if (!input || typeof input !== "object") return null;
  const attempt = input as Record<string, unknown>;
  if (
    typeof attempt.attempt !== "number" || typeof attempt.attemptedAt !== "string" ||
    typeof attempt.delivered !== "number" || typeof attempt.failed !== "number" ||
    typeof attempt.maxAttempts !== "number" || !isNotificationProvider(attempt.provider) ||
    !isNotificationDeliveryStatus(attempt.status) || typeof attempt.tag !== "string"
  ) return null;

  return {
    attempt: attempt.attempt,
    attemptedAt: attempt.attemptedAt,
    completedAt: typeof attempt.completedAt === "string" ? attempt.completedAt : null,
    delivered: attempt.delivered,
    error: typeof attempt.error === "string" ? attempt.error : null,
    event: isNotificationDeliveryDiagnosticEvent(attempt.event) ? attempt.event : null,
    failed: attempt.failed,
    maxAttempts: attempt.maxAttempts,
    nextRetryAt: typeof attempt.nextRetryAt === "string" ? attempt.nextRetryAt : null,
    provider: attempt.provider,
    status: attempt.status,
    tag: attempt.tag
  };
}

export function normalizeNotificationDeliveryDiagnostics(input: unknown): NotificationDeliveryDiagnostics {
  if (!input || typeof input !== "object") return createEmptyNotificationDeliveryDiagnostics();
  const diagnostics = input as Record<string, unknown>;
  return {
    lastAttempt: normalizeNotificationDeliveryAttemptDiagnostic(diagnostics.lastAttempt),
    lastFailure: normalizeNotificationDeliveryAttemptDiagnostic(diagnostics.lastFailure),
    lastSuccess: normalizeNotificationDeliveryAttemptDiagnostic(diagnostics.lastSuccess),
    pendingRetries: 0
  };
}

export function loadPushStateFromJson(raw: string | null): StoredPushState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredPushState>;
    if (!parsed.vapid?.publicKey || !parsed.vapid.privateKey || !Array.isArray(parsed.subscriptions)) {
      return null;
    }
    return {
      dedupe: normalizeNotificationDedupe(parsed.dedupe),
      diagnostics: normalizeNotificationDeliveryDiagnostics(parsed.diagnostics),
      pendingRetries: normalizeStoredNotificationRetries(parsed.pendingRetries),
      settings: normalizeNotificationSettings(parsed.settings),
      subscriptions: parsed.subscriptions,
      vapid: parsed.vapid
    };
  } catch {
    return null;
  }
}

export function isFileNotFound(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export async function loadPushState(storagePath: string): Promise<StoredPushState> {
  try {
    const raw = await readFile(storagePath, "utf8");
    const parsed = loadPushStateFromJson(raw);
    if (parsed) return parsed;
  } catch (error) {
    if (!isFileNotFound(error)) {
      logger.warn("Failed to load Web Push state; generating a fresh state", {
        message: error instanceof Error ? error.message : String(error),
        storagePath
      });
    }
  }

  return {
    dedupe: createEmptyNotificationDedupe(),
    diagnostics: createEmptyNotificationDeliveryDiagnostics(),
    pendingRetries: [],
    settings: createDefaultNotificationSettings(),
    subscriptions: [],
    vapid: webPush.generateVAPIDKeys()
  };
}
