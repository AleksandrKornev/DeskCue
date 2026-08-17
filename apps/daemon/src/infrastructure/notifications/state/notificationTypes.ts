import type { PushSubscription } from "web-push";

import type {
  NotificationDeliveryDiagnostics,
  NotificationDeliveryDiagnosticEvent,
  NotificationEventKind,
  NotificationProviderKind,
  NotificationTestResponse
} from "@deskcue/protocol";
import type { DaemonEventBus } from "#application/ports";
import type { SqliteNotificationStateStore } from "#persistence/journals/notificationStateStore";

export type StoredVapidKeys = {
  privateKey: string;
  publicKey: string;
};

export type StoredPushSubscription = {
  accessDeviceId?: string | null;
  createdAt: string;
  id: string;
  lastDeliveredAt?: string | null;
  pushClientId?: string | null;
  subscription: PushSubscription;
  updatedAt: string;
  userAgent: string | null;
};

export type StoredNotificationSettings = {
  enabled: boolean;
  providers: {
    gotify: { enabled: boolean; serverUrl: string; token: string };
    ntfy: { enabled: boolean; topicUrl: string };
    telegram: { botToken: string; chatId: string; enabled: boolean };
    webhook: { enabled: boolean; headersText: string; url: string };
    webPush: { enabled: boolean };
  };
  routes: Array<{
    event: NotificationEventKind;
    providers: NotificationProviderKind[];
  }>;
};

export type StoredNotificationDedupe = {
  actionRequestKeys: string[];
  agentSessionKeys: string[];
  sessionKeys: string[];
};

export type NotificationPayload = {
  body: string;
  data?: Record<string, unknown>;
  tag: string;
  title: string;
  url: string;
  /** Exact compatibility body for the legacy session webhook env default. */
  webhookBody?: unknown;
};

export type QueuedNotificationRetry = {
  attempt: number;
  createdAt: string;
  event: NotificationEventKind;
  key: string;
  maxAttempts: number;
  payload: NotificationPayload;
  provider: NotificationProviderKind;
  timer?: NodeJS.Timeout;
};

export type StoredNotificationRetry = Omit<QueuedNotificationRetry, "timer"> & {
  nextRetryAt: string;
};

export type StoredPushState = {
  dedupe: StoredNotificationDedupe;
  diagnostics: NotificationDeliveryDiagnostics;
  pendingRetries: StoredNotificationRetry[];
  settings: StoredNotificationSettings;
  subscriptions: StoredPushSubscription[];
  vapid: StoredVapidKeys;
};

export type PushSubscriptionInput = {
  accessDeviceId?: string | null;
  pushClientId?: string | null;
  replaceEndpoint?: string | null;
  subscription: PushSubscription;
  userAgent?: string | null;
};

export type RemovePushSubscriptionInput = {
  accessDeviceId?: string | null;
  endpoint?: string | null;
  pushClientId?: string | null;
};

export type ListPushSubscriptionsInput = {
  accessDeviceId?: string | null;
  pushClientId?: string | null;
};

export type NotificationDeliveryResult = NotificationTestResponse & {
  retryable?: boolean;
};

export type NotificationDeliveryOptions = {
  attempt?: number;
  event?: NotificationDeliveryDiagnosticEvent | null;
  maxAttempts?: number;
};

export type NotificationDedupeClaim = {
  bucket: keyof StoredNotificationDedupe;
  key: string;
};

export type TelegramPairingSession = {
  botToken: string;
  botUsername: string;
  code: string;
  expiresAtMs: number;
};

export type PushNotificationServiceOptions = {
  databaseFilePath?: string;
  events: DaemonEventBus;
  fetchImpl?: typeof fetch;
  legacySessionWebhookUrl?: string | null;
  outboxMaxRecords?: number;
  outboxTtlMs?: number;
  recoveryRetryDelayMs?: number;
  sendNotification?: (
    subscription: PushSubscription,
    payload: string,
    options: { TTL: number; timeout: number }
  ) => Promise<unknown>;
  telegramIpv4FetchImpl?: typeof fetch;
  retryDelaysMs?: number[];
  stateStore?: SqliteNotificationStateStore;
  storagePath?: string;
  externalProviderTimeoutMs?: number;
  deliveryConcurrency?: number;
  deliveryQueueCapacity?: number;
  telegramPairingMaxSessions?: number;
  telegramPairingTimeoutMs?: number;
  webPushDeliveryConcurrency?: number;
  webPushDeliveryTimeoutMs?: number;
  webPushMaxSubscriptions?: number;
  webPushSubscriptionRetentionMs?: number;
};

export type TelegramGetMeResponse = {
  result: { username?: string };
};

export type TelegramUpdate = {
  update_id: number;
  message?: {
    chat?: {
      first_name?: string;
      id?: number | string;
      title?: string;
      username?: string;
    };
    text?: string;
  };
};

export type TelegramUpdatesResponse = { result: TelegramUpdate[] };

export const NOTIFICATION_EVENTS: NotificationEventKind[] = [
  "approval.required",
  "session.finished",
  "session.failed",
  "agent.turn.finished"
];

export const NOTIFICATION_PROVIDERS: NotificationProviderKind[] = [
  "web_push",
  "ntfy",
  "gotify",
  "telegram",
  "webhook"
];

export const TELEGRAM_PAIRING_TTL_MS = 2 * 60 * 1000;
export const DEFAULT_EXTERNAL_NOTIFICATION_RETRY_DELAYS_MS = [1_000, 5_000, 20_000];
export const DEFAULT_EXTERNAL_NOTIFICATION_RECOVERY_RETRY_DELAY_MS = 5 * 60 * 1_000;
export const MAX_EXTERNAL_NOTIFICATION_RECOVERY_RETRY_DELAY_MS = 60 * 60 * 1_000;
export const DEFAULT_NOTIFICATION_OUTBOX_MAX_RECORDS = 1_000;
export const DEFAULT_NOTIFICATION_OUTBOX_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const DEFAULT_WEB_PUSH_SUBSCRIPTION_RETENTION_MS = 180 * 24 * 60 * 60 * 1_000;
export const DEFAULT_WEB_PUSH_DELIVERY_CONCURRENCY = 4;
export const DEFAULT_WEB_PUSH_MAX_SUBSCRIPTIONS = 64;
export const DEFAULT_NOTIFICATION_DELIVERY_CONCURRENCY = 8;
export const DEFAULT_NOTIFICATION_DELIVERY_QUEUE_CAPACITY = 256;
export const DEFAULT_TELEGRAM_PAIRING_MAX_SESSIONS = 16;

export function isNotificationEvent(value: unknown): value is NotificationEventKind {
  return typeof value === "string" && NOTIFICATION_EVENTS.includes(value as NotificationEventKind);
}

export function isNotificationProvider(value: unknown): value is NotificationProviderKind {
  return typeof value === "string" && NOTIFICATION_PROVIDERS.includes(value as NotificationProviderKind);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
