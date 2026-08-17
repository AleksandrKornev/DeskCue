import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "#application/errors";

import {
  readNotificationTestInput,
  readTelegramPairingResolveInput,
  readUpdateNotificationSettingsInput
} from "./notificationSettingsRouteInputs.ts";
import { readOptionalPushClientId } from "./pushSubscriptionRouteInputs.ts";

test("notification settings parser preserves partial provider updates and explicit secret clears", () => {
  assert.deepEqual(
    readUpdateNotificationSettingsInput({
      enabled: false,
      providers: {
        telegram: {
          botToken: null,
          enabled: true
        },
        webhook: {
          headersText: "  X-DeskCue: enabled  "
        }
      },
      routes: [{
        event: "agent.turn.finished",
        providers: ["telegram", "webhook"]
      }]
    }),
    {
      enabled: false,
      providers: {
        telegram: {
          botToken: "",
          enabled: true
        },
        webhook: {
          headersText: "X-DeskCue: enabled"
        }
      },
      routes: [{
        event: "agent.turn.finished",
        providers: ["telegram", "webhook"]
      }]
    }
  );
});

function isInvalidInput(error: unknown, message: string) {
  return (
    error instanceof AppError &&
    error.code === "invalid_input" &&
    error.message === message
  );
}

test("notification request parsers reject unknown providers and malformed pairing codes", () => {
  assert.throws(
    () => readNotificationTestInput({ provider: "unknown" }),
    (error) => isInvalidInput(error, "Notification provider is invalid.")
  );
  assert.throws(
    () => readTelegramPairingResolveInput({ code: "invalid code" }),
    (error) => isInvalidInput(error, "Telegram pairing code is invalid.")
  );
});

test("push client id parser accepts durable ids and rejects unsafe values", () => {
  assert.equal(readOptionalPushClientId("device.mobile:01"), "device.mobile:01");
  assert.throws(
    () => readOptionalPushClientId("device/mobile"),
    (error) => isInvalidInput(error, "Push client id is invalid.")
  );
});
