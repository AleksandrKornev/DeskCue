import type { PushSubscription } from "web-push";

import {
  parseListPushSubscriptionsInput,
  parsePushSubscriptionId,
  parseRegisterPushSubscriptionInput,
  parseRemovePushSubscriptionInput
} from "@deskcue/protocol";
import { readProtocolPayload } from "#http/middleware/validators";

export function readPushSubscription(value: unknown): PushSubscription {
  return readProtocolPayload(
    () => parseRegisterPushSubscriptionInput({ subscription: value }).subscription
  );
}

export function readOptionalEndpoint(value: unknown) {
  return readProtocolPayload(
    () => parseRemovePushSubscriptionInput({ endpoint: value }).endpoint ?? null
  );
}

export function readOptionalPushClientId(value: unknown) {
  return readProtocolPayload(
    () => parseListPushSubscriptionsInput({ pushClientId: value }).pushClientId ?? null
  );
}

export function readPushSubscriptionId(value: unknown) {
  return readProtocolPayload(() => parsePushSubscriptionId(value));
}
