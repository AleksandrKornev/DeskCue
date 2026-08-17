import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchExternalProvider,
  isNetworkTimeoutError,
  sendExternalProvider
} from "./externalNotificationProviders.ts";
import { createDefaultNotificationSettings } from "../state/notificationSettings.ts";

test("every external notification provider observes the shared delivery deadline", async () => {
  const settings = createDefaultNotificationSettings();
  settings.providers.ntfy.topicUrl = "https://ntfy.example.test/deskcue";
  settings.providers.gotify.serverUrl = "https://gotify.example.test";
  settings.providers.gotify.token = "token";
  settings.providers.telegram.botToken = "token";
  settings.providers.telegram.chatId = "123";
  settings.providers.webhook.url = "https://webhook.example.test";

  const hangingFetch: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const guardTimer = setTimeout(() => {
      reject(new Error("Test fetch did not observe the provider abort within 1s."));
    }, 1_000);
    signal?.addEventListener("abort", () => {
      clearTimeout(guardTimer);
      reject(signal.reason);
    }, { once: true });
  });
  const payload = {
    body: "body",
    tag: "test",
    title: "title",
    url: "/"
  };

  for (const provider of ["ntfy", "gotify", "telegram", "webhook"] as const) {
    await assert.rejects(
      sendExternalProvider(
        provider,
        payload,
        hangingFetch,
        settings,
        hangingFetch,
        { timeoutMs: 10 }
      ),
      isNetworkTimeoutError
    );
  }
});

test("external notification fetch errors never echo secret-bearing URLs", async () => {
  const secretUrl = "https://api.telegram.org/botprivate-token/sendMessage";
  await assert.rejects(
    fetchExternalProvider(
      async () => {
        throw new TypeError("fetch failed", {
          cause: new Error(`Connection failed for ${secretUrl}`)
        });
      },
      secretUrl,
      undefined,
      "Telegram notification",
      { retryTransient: false }
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes("private-token"), false);
      assert.equal(error.message, "Telegram notification request failed: network request failed");
      return true;
    }
  );
});