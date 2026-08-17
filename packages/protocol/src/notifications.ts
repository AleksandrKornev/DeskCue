export interface PushNotificationStatusResponse {
  publicKey: string;
  subscriptionCount: number;
  supported: boolean;
}

export interface PushSubscriptionRegistrationResponse {
  subscriptionCount: number;
  subscriptionId: string;
}

export interface PushSubscriptionRemovalResponse {
  removedCount: number;
  subscriptionCount: number;
}

export interface PushSubscriptionSummary {
  createdAt: string;
  current: boolean;
  id: string;
  label: string;
  lastDeliveredAt: string | null;
  updatedAt: string;
}

export interface PushSubscriptionListResponse {
  subscriptionCount: number;
  subscriptions: PushSubscriptionSummary[];
}

export interface PushNotificationTestResponse {
  attempted: number;
  delivered: number;
  failed: number;
}

export type NotificationEventKind =
  | "approval.required"
  | "session.finished"
  | "session.failed"
  | "agent.turn.finished";

export type NotificationProviderKind =
  | "web_push"
  | "ntfy"
  | "gotify"
  | "telegram"
  | "webhook";

export interface NotificationRouteSettings {
  event: NotificationEventKind;
  providers: NotificationProviderKind[];
}

export interface WebPushNotificationProviderSettings {
  enabled: boolean;
}

export interface NtfyNotificationProviderSettings {
  enabled: boolean;
  topicUrl: string;
}

export interface GotifyNotificationProviderSettings {
  enabled: boolean;
  serverUrl: string;
  tokenConfigured: boolean;
  token?: string | null;
}

export interface TelegramNotificationProviderSettings {
  botTokenConfigured: boolean;
  botToken?: string | null;
  chatId: string;
  enabled: boolean;
}

export interface WebhookNotificationProviderSettings {
  enabled: boolean;
  headersText: string;
  url: string;
}

export interface NotificationProviderSettings {
  gotify: GotifyNotificationProviderSettings;
  ntfy: NtfyNotificationProviderSettings;
  telegram: TelegramNotificationProviderSettings;
  webhook: WebhookNotificationProviderSettings;
  webPush: WebPushNotificationProviderSettings;
}

export interface NotificationSettingsResponse {
  diagnostics: NotificationDeliveryDiagnostics;
  enabled: boolean;
  events: NotificationEventKind[];
  providers: NotificationProviderSettings;
  routes: NotificationRouteSettings[];
}

export interface UpdateNotificationSettingsInput {
  enabled?: boolean;
  providers?: Partial<{
    gotify: Partial<GotifyNotificationProviderSettings> & {
      clearToken?: boolean;
    };
    ntfy: Partial<NtfyNotificationProviderSettings>;
    telegram: Partial<TelegramNotificationProviderSettings> & {
      clearBotToken?: boolean;
    };
    webhook: Partial<WebhookNotificationProviderSettings>;
    webPush: Partial<WebPushNotificationProviderSettings>;
  }>;
  routes?: NotificationRouteSettings[];
}

export interface NotificationTestInput {
  provider: NotificationProviderKind;
  settings?: UpdateNotificationSettingsInput;
}

export interface NotificationTestResponse {
  attempted: number;
  delivered: number;
  error?: string;
  failed: number;
  provider: NotificationProviderKind;
}

export type NotificationDeliveryDiagnosticEvent = NotificationEventKind | "test";

export interface NotificationDeliveryAttemptDiagnostic {
  attempt: number;
  attemptedAt: string;
  completedAt?: string | null;
  delivered: number;
  error?: string | null;
  event: NotificationDeliveryDiagnosticEvent | null;
  failed: number;
  maxAttempts: number;
  nextRetryAt?: string | null;
  provider: NotificationProviderKind;
  status: "delivered" | "failed" | "scheduled" | "uncertain";
  tag: string;
}

export interface NotificationDeliveryDiagnostics {
  lastAttempt: NotificationDeliveryAttemptDiagnostic | null;
  lastFailure: NotificationDeliveryAttemptDiagnostic | null;
  lastSuccess: NotificationDeliveryAttemptDiagnostic | null;
  pendingRetries: number;
}

export interface TelegramNotificationPairingStartInput {
  settings?: UpdateNotificationSettingsInput;
}

export interface TelegramNotificationPairingStartResponse {
  botUsername: string;
  code: string;
  deepLink: string;
  expiresAt: string;
}

export interface TelegramNotificationPairingResolveInput {
  code: string;
  settings?: UpdateNotificationSettingsInput;
}

export interface TelegramNotificationPairingResolveResponse {
  chatId: string;
  chatTitle: string | null;
}

export function parseNotificationTestInput(value: unknown): NotificationTestInput {
  const body = readRecord(value, "Notification test");
  return {
    provider: readNotificationProvider(body.provider),
    ...(Object.hasOwn(body, "settings")
      ? { settings: parseUpdateNotificationSettingsInput(body.settings) }
      : {})
  };
}

export function parseTelegramNotificationPairingStartInput(
  value: unknown
): TelegramNotificationPairingStartInput {
  const body = readRecord(value, "Telegram pairing start");
  return Object.hasOwn(body, "settings")
    ? { settings: parseUpdateNotificationSettingsInput(body.settings) }
    : {};
}

export function parseTelegramNotificationPairingResolveInput(
  value: unknown
): TelegramNotificationPairingResolveInput {
  const body = readRecord(value, "Telegram pairing resolve");
  const code = readOptionalString(body, "code");
  if (!code || !/^[A-Za-z0-9_-]{1,64}$/.test(code)) {
    throw new ProtocolSchemaError("Telegram pairing code is invalid.");
  }
  return {
    code,
    ...(Object.hasOwn(body, "settings")
      ? { settings: parseUpdateNotificationSettingsInput(body.settings) }
      : {})
  };
}

export function parseUpdateNotificationSettingsInput(
  value: unknown
): UpdateNotificationSettingsInput {
  if (!isRecord(value)) {
    throw new ProtocolSchemaError("Notification settings must be an object.");
  }

  const input: UpdateNotificationSettingsInput = {};
  if (Object.hasOwn(value, "enabled")) {
    if (typeof value.enabled !== "boolean") {
      throw new ProtocolSchemaError("Notification enabled must be a boolean.");
    }
    input.enabled = value.enabled;
  }
  if (Object.hasOwn(value, "routes")) {
    if (!Array.isArray(value.routes)) {
      throw new ProtocolSchemaError("Notification routes must be an array.");
    }
    input.routes = value.routes.map(readNotificationRoute);
  }
  if (Object.hasOwn(value, "providers")) {
    if (!isRecord(value.providers)) {
      throw new ProtocolSchemaError("Notification providers must be an object.");
    }
    input.providers = readNotificationProviders(value.providers);
  }
  return input;
}

function readNotificationProviders(value: Record<string, unknown>) {
  const providers: NonNullable<UpdateNotificationSettingsInput["providers"]> = {};
  if (Object.hasOwn(value, "webPush")) {
    providers.webPush = readProviderFields(value.webPush, "webPush provider", [
      ["enabled", "boolean"]
    ]);
  }
  if (Object.hasOwn(value, "ntfy")) {
    providers.ntfy = readProviderFields(value.ntfy, "ntfy provider", [
      ["enabled", "boolean"],
      ["topicUrl", "string"]
    ]);
  }
  if (Object.hasOwn(value, "gotify")) {
    providers.gotify = readProviderFields(value.gotify, "Gotify provider", [
      ["clearToken", "boolean"],
      ["enabled", "boolean"],
      ["serverUrl", "string"],
      ["token", "string"]
    ]);
  }
  if (Object.hasOwn(value, "telegram")) {
    providers.telegram = readProviderFields(value.telegram, "Telegram provider", [
      ["botToken", "string"],
      ["clearBotToken", "boolean"],
      ["chatId", "string"],
      ["enabled", "boolean"]
    ]);
  }
  if (Object.hasOwn(value, "webhook")) {
    providers.webhook = readProviderFields(value.webhook, "Webhook provider", [
      ["enabled", "boolean"],
      ["headersText", "string"],
      ["url", "string"]
    ]);
  }
  return providers;
}

function readProviderFields(
  value: unknown,
  label: string,
  fields: ReadonlyArray<readonly [string, "boolean" | "string"]>
) {
  const provider = readRecord(value, label);
  const result: Record<string, boolean | string> = {};
  for (const [field, kind] of fields) {
    const parsed = kind === "boolean"
      ? readOptionalBoolean(provider, field)
      : readOptionalString(provider, field);
    if (parsed !== undefined) {
      result[field] = parsed;
    }
  }
  return result;
}

function readNotificationRoute(value: unknown): NotificationRouteSettings {
  const route = readRecord(value, "Notification route");
  if (!Array.isArray(route.providers)) {
    throw new ProtocolSchemaError("Notification route providers must be an array.");
  }
  return {
    event: readNotificationEvent(route.event),
    providers: route.providers.map(readNotificationProvider)
  };
}

function readNotificationEvent(value: unknown): NotificationEventKind {
  if (
    value === "approval.required" ||
    value === "session.finished" ||
    value === "session.failed" ||
    value === "agent.turn.finished"
  ) {
    return value;
  }
  throw new ProtocolSchemaError("Notification event is invalid.");
}

function readNotificationProvider(value: unknown): NotificationProviderKind {
  if (
    value === "web_push" ||
    value === "ntfy" ||
    value === "gotify" ||
    value === "telegram" ||
    value === "webhook"
  ) {
    return value;
  }
  throw new ProtocolSchemaError("Notification provider is invalid.");
}

function readOptionalBoolean(value: Record<string, unknown>, field: string) {
  if (!Object.hasOwn(value, field)) {
    return undefined;
  }
  if (typeof value[field] !== "boolean") {
    throw new ProtocolSchemaError(`${field} must be a boolean.`);
  }
  return value[field] as boolean;
}

function readOptionalString(value: Record<string, unknown>, field: string) {
  if (!Object.hasOwn(value, field)) {
    return undefined;
  }
  if (value[field] === null) {
    return "";
  }
  if (typeof value[field] !== "string") {
    throw new ProtocolSchemaError(`${field} must be a string.`);
  }
  return value[field].trim();
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ProtocolSchemaError(`${label} must be an object.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
import { ProtocolSchemaError } from "./schema.ts";
