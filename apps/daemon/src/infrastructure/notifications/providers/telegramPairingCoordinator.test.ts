import assert from "node:assert/strict";
import test from "node:test";

import { createTelegramPairingCoordinator } from "./telegramPairingCoordinator.ts";
import { createDefaultNotificationSettings } from "../state/notificationSettings.ts";

test("Telegram pairing bounds active sessions", async () => {
  const coordinator = createTelegramPairingCoordinator({
    getSettings: () => {
      const settings = createDefaultNotificationSettings();
      settings.providers.telegram.botToken = "token";
      return settings;
    },
    maxSessions: 1,
    telegramApi: {
      async request() {
        return { result: { username: "DeskCueBot" } } as never;
      }
    }
  });

  await coordinator.startTelegramPairing();
  await assert.rejects(coordinator.startTelegramPairing(), /too many/i);
  await coordinator.close();
});

test("Telegram pairing close aborts and drains an active Bot API request", async () => {
  let observedSignal: AbortSignal | undefined;
  const coordinator = createTelegramPairingCoordinator({
    getSettings: () => {
      const settings = createDefaultNotificationSettings();
      settings.providers.telegram.botToken = "token";
      return settings;
    },
    telegramApi: {
      async request(_token, _method, _query, signal) {
        observedSignal = signal;
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
        return { result: { username: "DeskCueBot" } } as never;
      }
    }
  });

  const pairing = coordinator.startTelegramPairing();
  await Promise.resolve();
  const closing = coordinator.close();
  await assert.rejects(pairing, /closing/i);
  await closing;
  assert.equal(observedSignal?.aborted, true);
});

test("Telegram pairing Bot API requests have a deadline", async () => {
  const coordinator = createTelegramPairingCoordinator({
    getSettings: () => {
      const settings = createDefaultNotificationSettings();
      settings.providers.telegram.botToken = "token";
      return settings;
    },
    requestTimeoutMs: 10,
    telegramApi: {
      async request(_token, _method, _query, signal, timeoutMs) {
        assert.equal(timeoutMs, 10);
        const attemptSignal = AbortSignal.any([
          signal!,
          AbortSignal.timeout(timeoutMs!)
        ]);
        await new Promise<void>((_resolve, reject) => {
          attemptSignal.addEventListener(
            "abort",
            () => reject(attemptSignal.reason),
            { once: true }
          );
        });
        return { result: { username: "DeskCueBot" } } as never;
      }
    }
  });

  await assert.rejects(coordinator.startTelegramPairing(), /timed out|timeout/i);
  await coordinator.close();
});
