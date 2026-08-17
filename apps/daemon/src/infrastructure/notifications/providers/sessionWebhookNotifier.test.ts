import assert from "node:assert/strict";
import test from "node:test";

import { resolveLegacySessionWebhookSettings } from "./sessionWebhookNotifier.ts";
import { createDefaultNotificationSettings } from "../state/notificationSettings.ts";

test("legacy session webhook becomes a durable provider default", () => {
  const result = resolveLegacySessionWebhookSettings(
    createDefaultNotificationSettings(),
    " https://legacy.example/deskcue "
  );

  assert.equal(result.legacySessionWebhookActive, true);
  assert.deepEqual(result.settings.providers.webhook, {
    enabled: true,
    headersText: "",
    url: "https://legacy.example/deskcue"
  });
  assert.deepEqual(
    result.settings.routes.find((route) => route.event === "session.finished")?.providers,
    ["web_push", "webhook"]
  );
  assert.deepEqual(
    result.settings.routes.find((route) => route.event === "session.failed")?.providers,
    ["web_push", "webhook"]
  );
});

test("saved webhook settings take precedence over the legacy env default", () => {
  const settings = createDefaultNotificationSettings();
  settings.providers.webhook = {
    enabled: true,
    headersText: "Authorization: configured",
    url: "https://configured.example/deskcue"
  };

  const result = resolveLegacySessionWebhookSettings(
    settings,
    "https://legacy.example/deskcue"
  );

  assert.equal(result.legacySessionWebhookActive, false);
  assert.equal(result.settings, settings);
});

test("invalid legacy webhook URLs are not activated", () => {
  const settings = createDefaultNotificationSettings();
  const result = resolveLegacySessionWebhookSettings(settings, "file:///tmp/hook");

  assert.equal(result.legacySessionWebhookActive, false);
  assert.equal(result.settings, settings);
});
