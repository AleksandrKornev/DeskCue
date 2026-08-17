import { ProtocolSchemaError } from "../schema.ts";

export interface WebPushSubscriptionKeysInput {
  auth: string;
  p256dh: string;
}

export interface WebPushSubscriptionInput {
  endpoint: string;
  expirationTime?: number | null;
  keys: WebPushSubscriptionKeysInput;
}

export interface RegisterPushSubscriptionInput {
  pushClientId?: string | null;
  replaceEndpoint?: string | null;
  subscription: WebPushSubscriptionInput;
}

export interface RemovePushSubscriptionInput {
  endpoint?: string | null;
  pushClientId?: string | null;
}

export interface ListPushSubscriptionsInput {
  pushClientId?: string | null;
}

const PUSH_ENDPOINT_MAX_LENGTH = 4096;
const PUSH_KEY_MAX_LENGTH = 1024;
const PUSH_CLIENT_ID_MAX_LENGTH = 128;

export function parseRegisterPushSubscriptionInput(
  value: unknown
): RegisterPushSubscriptionInput {
  const body = readRecord(value, "Push subscription registration");
  const subscription = readRecord(body.subscription, "Push subscription");
  const keys = readRecord(subscription.keys, "Push subscription keys");
  const endpoint = readBoundedRequiredString(
    subscription.endpoint,
    "Push subscription endpoint",
    PUSH_ENDPOINT_MAX_LENGTH
  );
  const auth = readBoundedRequiredString(
    keys.auth,
    "Push subscription auth key",
    PUSH_KEY_MAX_LENGTH
  );
  const p256dh = readBoundedRequiredString(
    keys.p256dh,
    "Push subscription p256dh key",
    PUSH_KEY_MAX_LENGTH
  );
  const expirationTime = readOptionalExpirationTime(subscription.expirationTime);

  return {
    subscription: {
      endpoint,
      keys: { auth, p256dh },
      ...(expirationTime !== undefined ? { expirationTime } : {})
    },
    pushClientId: parseOptionalPushClientId(body.pushClientId),
    replaceEndpoint: parseOptionalPushEndpoint(body.replaceEndpoint)
  };
}

export function parseRemovePushSubscriptionInput(
  value: unknown
): RemovePushSubscriptionInput {
  const body = readRecord(value, "Push subscription removal");
  return {
    endpoint: parseOptionalPushEndpoint(body.endpoint),
    pushClientId: parseOptionalPushClientId(body.pushClientId)
  };
}

export function parseListPushSubscriptionsInput(
  value: unknown
): ListPushSubscriptionsInput {
  const input = readRecord(value, "Push subscription list query");
  return {
    pushClientId: parseOptionalPushClientId(input.pushClientId)
  };
}

export function parsePushSubscriptionId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  ) {
    throw new ProtocolSchemaError("Push subscription id is invalid.");
  }
  return value;
}

function parseOptionalPushEndpoint(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return readBoundedRequiredString(
    value,
    "Push subscription endpoint",
    PUSH_ENDPOINT_MAX_LENGTH
  );
}

function parseOptionalPushClientId(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const clientId = readBoundedRequiredString(
    value,
    "Push client id",
    PUSH_CLIENT_ID_MAX_LENGTH
  );
  if (!/^[a-zA-Z0-9._:-]+$/.test(clientId)) {
    throw new ProtocolSchemaError("Push client id is invalid.");
  }
  return clientId;
}

function readOptionalExpirationTime(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ProtocolSchemaError("Push subscription expiration time is invalid.");
  }
  return value;
}

function readBoundedRequiredString(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new ProtocolSchemaError(`${label} is invalid.`);
  }
  return value.trim();
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProtocolSchemaError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}
