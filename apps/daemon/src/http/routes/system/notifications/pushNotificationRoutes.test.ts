import express from "express";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createPushNotificationService } from "#infrastructure/notifications/pushNotificationService";

import { installPushNotificationRoutes } from "./pushNotificationRoutes.ts";
import { errorHandler } from "../../../middleware/errorHandler.ts";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    assert.fail(await response.text());
  }
  return response.json() as Promise<T>;
}

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function withServer(
  app: express.Express,
  run: (baseUrl: string) => Promise<void>
) {
  const server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test server did not expose a TCP address.");
    }
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await closeServer(server);
  }
}

test("push notification route facade installs push, settings, test, and pairing endpoints", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-route-facade-"));
  const pushNotifications = await createPushNotificationService({
    events: {
      on() {
        return undefined;
      },
      publishServerEvent() {
        return undefined;
      }
    },
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.endsWith("/getMe")) {
        return Response.json({
          ok: true,
          result: { username: "DeskCueTestBot" }
        });
      }
      throw new Error(`Unexpected notification route request: ${url}`);
    },
    storagePath: join(directory, "push-state.json")
  });

  try {
    const app = express();
    app.use(express.json());
    installPushNotificationRoutes(app, { pushNotifications });
    app.use(errorHandler);

    await withServer(app, async (baseUrl) => {
      const status = await requestJson<{ supported: boolean }>(
        `${baseUrl}/api/push/status`
      );
      assert.equal(status.supported, true);

      const settings = await requestJson<{ enabled: boolean }>(
        `${baseUrl}/api/notifications/settings`,
        {
          body: JSON.stringify({ enabled: false }),
          headers: { "content-type": "application/json" },
          method: "PATCH"
        }
      );
      assert.equal(settings.enabled, false);

      const testResult = await requestJson<{
        attempted: number;
        delivered: number;
        failed: number;
        provider: string;
      }>(`${baseUrl}/api/notifications/test`, {
        body: JSON.stringify({ provider: "web_push" }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      assert.deepEqual(testResult, {
        attempted: 0,
        delivered: 0,
        failed: 0,
        provider: "web_push"
      });

      const pairing = await requestJson<{
        botUsername: string;
        code: string;
      }>(`${baseUrl}/api/notifications/telegram/pairing/start`, {
        body: JSON.stringify({
          settings: {
            providers: {
              telegram: { botToken: "test-token" }
            }
          }
        }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      assert.equal(pairing.botUsername, "DeskCueTestBot");
      assert.match(pairing.code, /^[A-Za-z0-9_-]{1,64}$/);
    });
  } finally {
    await pushNotifications.close();
    await rm(directory, { force: true, recursive: true });
  }
});
