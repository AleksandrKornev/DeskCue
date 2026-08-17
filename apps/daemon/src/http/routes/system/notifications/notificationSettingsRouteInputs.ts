import {
  parseNotificationTestInput,
  parseTelegramNotificationPairingResolveInput,
  parseTelegramNotificationPairingStartInput,
  parseUpdateNotificationSettingsInput
} from "@deskcue/protocol";
import type { UpdateNotificationSettingsInput } from "@deskcue/protocol";

import { readProtocolPayload } from "../../../middleware/validators.ts";

export function readNotificationTestInput(value: unknown) {
  return readProtocolPayload(() => parseNotificationTestInput(value));
}

export function readTelegramPairingStartInput(value: unknown) {
  return readProtocolPayload(() => parseTelegramNotificationPairingStartInput(value));
}

export function readTelegramPairingResolveInput(value: unknown) {
  return readProtocolPayload(() => parseTelegramNotificationPairingResolveInput(value));
}

export function readUpdateNotificationSettingsInput(
  value: unknown
): UpdateNotificationSettingsInput {
  return readProtocolPayload(() => parseUpdateNotificationSettingsInput(value));
}
