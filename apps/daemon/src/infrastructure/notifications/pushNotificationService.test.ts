import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { PushSubscription } from "web-push";

import type { ServerEvent } from "@deskcue/protocol";
import { SqliteNotificationStateStore } from "#persistence/journals/notificationStateStore";

import { createPushNotificationService } from "./pushNotificationService.ts";

function pushSubscription(endpoint: string): PushSubscription {
  return {
    endpoint,
    keys: {
      auth: "auth-key",
      p256dh: "p256dh-key"
    }
  };
}

function createApprovalEvent(sessionId = "session-1"): ServerEvent {
  return {
    type: "session.updated",
    payload: {
      adapterId: "codex",
      actionRequest: {
        command: "Set-Content -LiteralPath .\\approval.txt -Value ok",
        kind: "approval",
        reason: "Needs write access",
        requestedAt: "2026-07-09T10:00:00.000Z"
      },
      canSendInput: true,
      command: "codex resume 019f4764",
      exitCode: null,
      finishedAt: null,
      id: sessionId,
      inputBlockedReason: null,
      git: {
        branch: "main",
        changedFiles: [],
        diff: "",
        isDirty: false,
        isGitRepo: true,
        lastUpdatedAt: "2026-07-09T10:00:00.000Z"
      },
      lastActivityAt: "2026-07-09T10:00:00.000Z",
      preview: {
        active: false,
        networkMode: "device-direct",
        port: null,
        targetUrl: null
      },
      replyState: {
        phase: "waiting",
        promptText: null,
        requestedAt: "2026-07-09T10:00:00.000Z"
      },
      sourceSessionId: "019f4764",
      startedAt: "2026-07-09T09:59:00.000Z",
      status: "running",
      workspaceId: "workspace-1",
      workspaceName: "Approval workspace"
    }
  };
}

function createFinishedSessionEvent(): ServerEvent {
  const event = createApprovalEvent();
  if (event.type !== "session.updated") {
    throw new Error("Expected a session update fixture.");
  }

  return {
    type: "session.updated",
    payload: {
      ...event.payload,
      actionRequest: null,
      command: "codex resume session-1",
      exitCode: 0,
      finishedAt: "2026-07-09T10:01:00.000Z",
      lastActivityAt: "2026-07-09T10:01:00.000Z",
      replyState: {
        phase: "idle",
        promptText: null,
        requestedAt: null
      },
      status: "done",
      workspaceName: "Finished workspace"
    }
  };
}

function inertEventBus() {
  return {
    on() {
      return undefined;
    },
    publishServerEvent() {
      return undefined;
    }
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (predicate()) {
      return;
    }

    await delay(10);
  }
}

async function configureWebhookApprovalNotifications(
  service: Awaited<ReturnType<typeof createPushNotificationService>>
) {
  await service.updateNotificationSettings({
    providers: {
      webPush: {
        enabled: false
      },
      webhook: {
        enabled: true,
        headersText: "",
        url: "https://hooks.example.com/deskcue"
      }
    },
    routes: [
      {
        event: "approval.required",
        providers: ["webhook"]
      },
      {
        event: "session.finished",
        providers: []
      },
      {
        event: "session.failed",
        providers: []
      },
      {
        event: "agent.turn.finished",
        providers: []
      }
    ]
  });
}

test("push notification service replaces an old endpoint during forced re-enable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const service = await createPushNotificationService({
    events: {
      on() {
        return undefined;
      },
      publishServerEvent() {
        return undefined;
      }
    },
    storagePath: join(directory, "push-state.json")
  });

  try {
    await service.registerSubscription({
      accessDeviceId: "device-1",
      subscription: pushSubscription("https://push.example/old")
    });
    await service.registerSubscription({
      accessDeviceId: "device-1",
      replaceEndpoint: "https://push.example/old",
      subscription: pushSubscription("https://push.example/new")
    });

    assert.equal(service.getStatus().subscriptionCount, 1);
  } finally {
    service.close();
    await rm(directory, {
      force: true,
      recursive: true
    });
  }
});

test("push notification service retains only the newest bounded subscriptions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const service = await createPushNotificationService({
    events: inertEventBus(),
    storagePath: join(directory, "push-state.json"),
    webPushMaxSubscriptions: 3
  });

  try {
    const oldest = await service.registerSubscription({
      subscription: pushSubscription("https://push.example/oldest")
    });
    for (const suffix of ["two", "three", "newest"]) {
      await service.registerSubscription({
        subscription: pushSubscription(`https://push.example/${suffix}`)
      });
    }

    const listed = service.listSubscriptions();
    assert.equal(listed.subscriptionCount, 3);
    assert.equal(listed.subscriptions.some((subscription) => subscription.id === oldest.id), false);
  } finally {
    await service.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("Web Push delivery deadline bounds test delivery and service drain", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  let requestedSocketTimeout: number | null = null;
  const service = await createPushNotificationService({
    events: inertEventBus(),
    sendNotification: async (_subscription, _payload, options) => {
      requestedSocketTimeout = options.timeout;
      return new Promise(() => undefined);
    },
    storagePath: join(directory, "push-state.json"),
    webPushDeliveryTimeoutMs: 20
  });

  try {
    await service.registerSubscription({
      subscription: pushSubscription("https://push.example/quiet")
    });
    const startedAt = Date.now();
    const result = await service.sendTestPush();
    assert.deepEqual(result, { attempted: 1, delivered: 0, failed: 1 });
    assert.ok(Date.now() - startedAt < 250);
    assert.equal(requestedSocketTimeout, 20);
    assert.equal(
      service.getNotificationSettings().diagnostics.lastAttempt?.status,
      "uncertain"
    );
  } finally {
    await service.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("Web Push fan-out uses bounded concurrency", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  let active = 0;
  let maxActive = 0;
  const service = await createPushNotificationService({
    events: inertEventBus(),
    async sendNotification() {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(10);
      active -= 1;
    },
    storagePath: join(directory, "push-state.json"),
    webPushDeliveryConcurrency: 2
  });

  try {
    for (let index = 0; index < 5; index += 1) {
      await service.registerSubscription({
        subscription: pushSubscription(`https://push.example/${index}`)
      });
    }
    const result = await service.sendTestPush();
    assert.deepEqual(result, { attempted: 5, delivered: 5, failed: 0 });
    assert.equal(maxActive, 2);
  } finally {
    await service.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("notification admission is global across simultaneous events and providers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  let active = 0;
  let maxActive = 0;
  const service = await createPushNotificationService({
    deliveryConcurrency: 2,
    deliveryQueueCapacity: 8,
    events: inertEventBus(),
    async fetchImpl() {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(15);
      active -= 1;
      return new Response(null, { status: 204 });
    },
    storagePath: join(directory, "push-state.json")
  });

  try {
    const settings = {
      enabled: true,
      providers: {
        webhook: {
          enabled: true,
          headersText: "",
          url: "https://hooks.example.com/deskcue"
        }
      }
    };
    const results = await Promise.all(Array.from({ length: 6 }, () =>
      service.sendTestNotification("webhook", settings)));
    assert.equal(results.every((result) => result.delivered === 1), true);
    assert.equal(maxActive, 2);
  } finally {
    await service.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("push notification service replaces legacy endpoint records without device ids", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const service = await createPushNotificationService({
    events: {
      on() {
        return undefined;
      },
      publishServerEvent() {
        return undefined;
      }
    },
    storagePath: join(directory, "push-state.json")
  });

  try {
    await service.registerSubscription({
      subscription: pushSubscription("https://push.example/stale-legacy"),
      userAgent: "Chrome"
    });
    await service.registerSubscription({
      subscription: pushSubscription("https://push.example/current-legacy"),
      userAgent: "Chrome"
    });
    await service.registerSubscription({
      subscription: pushSubscription("https://push.example/other-browser"),
      userAgent: "Mobile Safari"
    });
    await service.registerSubscription({
      accessDeviceId: "device-1",
      replaceEndpoint: "https://push.example/current-legacy",
      subscription: pushSubscription("https://push.example/new"),
      userAgent: "Chrome"
    });

    assert.equal(service.getStatus().subscriptionCount, 2);
  } finally {
    service.close();
    await rm(directory, {
      force: true,
      recursive: true
    });
  }
});

test("push notification service replaces prior subscriptions for the same access device", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const service = await createPushNotificationService({
    events: {
      on() {
        return undefined;
      },
      publishServerEvent() {
        return undefined;
      }
    },
    storagePath: join(directory, "push-state.json")
  });

  try {
    await service.registerSubscription({
      accessDeviceId: "device-1",
      subscription: pushSubscription("https://push.example/one"),
      userAgent: "Chrome"
    });
    await service.registerSubscription({
      accessDeviceId: "device-1",
      subscription: pushSubscription("https://push.example/two"),
      userAgent: "Chrome"
    });

    assert.equal(service.getStatus().subscriptionCount, 1);
  } finally {
    service.close();
    await rm(directory, {
      force: true,
      recursive: true
    });
  }
});

test("push notification service replaces prior subscriptions for the same push client", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const service = await createPushNotificationService({
    events: {
      on() {
        return undefined;
      },
      publishServerEvent() {
        return undefined;
      }
    },
    storagePath: join(directory, "push-state.json")
  });

  try {
    await service.registerSubscription({
      pushClientId: "push-client-1",
      subscription: pushSubscription("https://push.example/one"),
      userAgent: "Chrome"
    });
    await service.registerSubscription({
      pushClientId: "push-client-1",
      subscription: pushSubscription("https://push.example/two"),
      userAgent: "Chrome"
    });

    assert.equal(service.getStatus().subscriptionCount, 1);
  } finally {
    service.close();
    await rm(directory, {
      force: true,
      recursive: true
    });
  }
});

test("push notification service keeps different push clients with the same user agent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const service = await createPushNotificationService({
    events: {
      on() {
        return undefined;
      },
      publishServerEvent() {
        return undefined;
      }
    },
    storagePath: join(directory, "push-state.json")
  });

  try {
    await service.registerSubscription({
      pushClientId: "push-client-1",
      subscription: pushSubscription("https://push.example/one"),
      userAgent: "Chrome"
    });
    await service.registerSubscription({
      pushClientId: "push-client-2",
      subscription: pushSubscription("https://push.example/two"),
      userAgent: "Chrome"
    });

    assert.equal(service.getStatus().subscriptionCount, 2);
  } finally {
    service.close();
    await rm(directory, {
      force: true,
      recursive: true
    });
  }
});

test("push notification service removes a subscription by endpoint", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const service = await createPushNotificationService({
    events: {
      on() {
        return undefined;
      },
      publishServerEvent() {
        return undefined;
      }
    },
    storagePath: join(directory, "push-state.json")
  });

  try {
    await service.registerSubscription({
      pushClientId: "push-client-1",
      subscription: pushSubscription("https://push.example/one")
    });
    await service.registerSubscription({
      pushClientId: "push-client-2",
      subscription: pushSubscription("https://push.example/two")
    });

    const result = await service.removeSubscription({
      endpoint: "https://push.example/one"
    });

    assert.equal(result.removedCount, 1);
    assert.equal(result.subscriptionCount, 1);
    assert.equal(service.getStatus().subscriptionCount, 1);
  } finally {
    service.close();
    await rm(directory, {
      force: true,
      recursive: true
    });
  }
});

test("push notification service lists safe browser records and removes only the requested id", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const service = await createPushNotificationService({
    events: {
      on() {
        return undefined;
      },
      publishServerEvent() {
        return undefined;
      }
    },
    storagePath: join(directory, "push-state.json")
  });

  try {
    const current = await service.registerSubscription({
      accessDeviceId: "device-current",
      pushClientId: "push-current",
      subscription: pushSubscription("https://push.example/current"),
      userAgent: "Mozilla/5.0 Chrome/124.0.0.0 Safari/537.36"
    });
    await service.registerSubscription({
      accessDeviceId: "device-other",
      pushClientId: "push-other",
      subscription: pushSubscription("https://push.example/other"),
      userAgent: "Firefox"
    });
    await service.registerSubscription({
      subscription: pushSubscription("https://push.example/legacy"),
      userAgent: "Legacy browser"
    });

    const listed = service.listSubscriptions({
      accessDeviceId: "device-current",
      pushClientId: "push-current"
    });
    assert.equal(listed.subscriptionCount, 3);
    assert.equal(listed.subscriptions.find((item) => item.id === current.id)?.current, true);
    assert.equal(listed.subscriptions.find((item) => item.id === current.id)?.label, "Chrome");
    assert.equal(JSON.stringify(listed).includes("https://push.example"), false);
    assert.equal(JSON.stringify(listed).includes("push-current"), false);
    assert.equal(JSON.stringify(listed).includes("Mozilla/5.0"), false);
    assert.equal(
      service.listSubscriptions({ pushClientId: "push-current" }).subscriptions
        .find((item) => item.id === current.id)?.current,
      true
    );

    const removed = await service.removeSubscriptionById(current.id);
    assert.deepEqual(removed, {
      removedCount: 1,
      subscriptionCount: 2
    });
    assert.equal(await service.removeSubscriptionById(current.id), null);
    assert.equal(service.getStatus().subscriptionCount, 2);
  } finally {
    service.close();
    await rm(directory, {
      force: true,
      recursive: true
    });
  }
});

test("push notification service removes stale records for the same push client", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const service = await createPushNotificationService({
    events: {
      on() {
        return undefined;
      },
      publishServerEvent() {
        return undefined;
      }
    },
    storagePath: join(directory, "push-state.json")
  });

  try {
    await service.registerSubscription({
      pushClientId: "push-client-1",
      subscription: pushSubscription("https://push.example/one")
    });
    await service.registerSubscription({
      pushClientId: "push-client-2",
      subscription: pushSubscription("https://push.example/two")
    });

    const result = await service.removeSubscription({
      pushClientId: "push-client-1"
    });

    assert.equal(result.removedCount, 1);
    assert.equal(result.subscriptionCount, 1);
    assert.equal(service.getStatus().subscriptionCount, 1);
  } finally {
    service.close();
    await rm(directory, {
      force: true,
      recursive: true
    });
  }
});

test("push notification service prunes subscriptions inactive beyond retention", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const storagePath = join(directory, "push-state.json");
  const events = {
    on() {
      return undefined;
    },
    publishServerEvent() {
      return undefined;
    }
  };

  try {
    const firstService = await createPushNotificationService({ events, storagePath });
    await firstService.registerSubscription({
      pushClientId: "stale-client",
      subscription: pushSubscription("https://push.example/stale")
    });
    await firstService.registerSubscription({
      pushClientId: "recent-client",
      subscription: pushSubscription("https://push.example/recent")
    });
    firstService.close();

    const stateStore = new SqliteNotificationStateStore(`${storagePath}.sqlite`);
    const state = JSON.parse(stateStore.loadStateJson() ?? "{}") as {
      subscriptions: Array<{ createdAt: string; pushClientId?: string; updatedAt: string }>;
    };
    const staleAt = new Date(Date.now() - 200 * 24 * 60 * 60 * 1_000).toISOString();
    state.subscriptions = state.subscriptions.map((subscription) =>
      subscription.pushClientId === "stale-client"
        ? { ...subscription, createdAt: staleAt, updatedAt: staleAt }
        : subscription
    );
    stateStore.saveStateJson(JSON.stringify(state));
    stateStore.close();

    const secondService = await createPushNotificationService({
      events,
      storagePath,
      webPushSubscriptionRetentionMs: 180 * 24 * 60 * 60 * 1_000
    });
    assert.equal(secondService.getStatus().subscriptionCount, 1);
    assert.equal(
      secondService.listSubscriptions({ pushClientId: "recent-client" }).subscriptions[0]?.current,
      true
    );
    secondService.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("push notification service sends an approval-required notification once per request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const eventListeners: Array<(event: ServerEvent) => void> = [];
  const sentPayloads: Array<Record<string, unknown>> = [];
  const service = await createPushNotificationService({
    events: {
      on(_eventName, listener) {
        eventListeners.push(listener);
        return undefined;
      },
      publishServerEvent() {
        return undefined;
      }
    },
    async sendNotification(_subscription, payload) {
      sentPayloads.push(JSON.parse(payload) as Record<string, unknown>);
    },
    storagePath: join(directory, "push-state.json")
  });

  try {
    await service.registerSubscription({
      pushClientId: "push-client-1",
      subscription: pushSubscription("https://push.example/approval")
    });

    const event: ServerEvent = {
      type: "session.updated",
      payload: {
        adapterId: "codex",
        actionRequest: {
          command: "Set-Content -LiteralPath .\\approval.txt -Value ok",
          kind: "approval",
          reason: "Needs write access",
          requestedAt: "2026-07-09T10:00:00.000Z"
        },
        canSendInput: true,
        command: "codex resume 019f4764",
        exitCode: null,
        finishedAt: null,
        id: "session-1",
        inputBlockedReason: null,
        git: {
          branch: "main",
          changedFiles: [],
          diff: "",
          isDirty: false,
          isGitRepo: true,
          lastUpdatedAt: "2026-07-09T10:00:00.000Z"
        },
        lastActivityAt: "2026-07-09T10:00:00.000Z",
        preview: {
          active: false,
          networkMode: "device-direct",
          port: null,
          targetUrl: null
        },
        replyState: {
          phase: "waiting",
          promptText: null,
          requestedAt: "2026-07-09T10:00:00.000Z"
        },
        sourceSessionId: "019f4764",
        startedAt: "2026-07-09T09:59:00.000Z",
        status: "running",
        workspaceId: "workspace-1",
        workspaceName: "Approval workspace"
      }
    };

    for (const listener of eventListeners) {
      listener(event);
      listener(event);
    }
    await waitFor(() => sentPayloads.length === 1);

    assert.equal(sentPayloads.length, 1);
    assert.equal(sentPayloads[0]?.title, "DeskCue: approval needed");
    assert.equal(
      sentPayloads[0]?.body,
      "Approval workspace: approve or reject Set-Content -LiteralPath .\\approval.txt -Value ok"
    );
    assert.deepEqual(sentPayloads[0]?.data, {
      actionKind: "approval",
      agentLabel: "Codex",
      notificationKind: "approval.required",
      reason: "Needs write access",
      sessionId: "session-1",
      url: "/sessions/session-1/overview",
      workspaceName: "Approval workspace"
    });
  } finally {
    service.close();
    await rm(directory, {
      force: true,
      recursive: true
    });
  }
});

test("notification settings return secrets and preserve configured provider tokens", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const service = await createPushNotificationService({
    events: {
      on() {
        return undefined;
      },
      publishServerEvent() {
        return undefined;
      }
    },
    storagePath: join(directory, "push-state.json")
  });

  try {
    const configured = await service.updateNotificationSettings({
      providers: {
        gotify: {
          enabled: true,
          serverUrl: "https://gotify.example.com",
          token: "gotify-token"
        },
        telegram: {
          botToken: "telegram-token",
          chatId: "12345",
          enabled: true
        }
      }
    });
    const preserved = await service.updateNotificationSettings({
      providers: {
        gotify: {
          serverUrl: "https://gotify.example.org"
        },
        telegram: {
          chatId: "67890"
        }
      }
    });

    assert.equal(configured.providers.gotify.tokenConfigured, true);
    assert.equal(configured.providers.telegram.botTokenConfigured, true);
    assert.equal(configured.providers.gotify.token, "gotify-token");
    assert.equal(configured.providers.telegram.botToken, "telegram-token");
    assert.equal(preserved.providers.gotify.tokenConfigured, true);
    assert.equal(preserved.providers.gotify.token, "gotify-token");
    assert.equal(preserved.providers.gotify.serverUrl, "https://gotify.example.org");
    assert.equal(preserved.providers.telegram.botTokenConfigured, true);
    assert.equal(preserved.providers.telegram.botToken, "telegram-token");
    assert.equal(preserved.providers.telegram.chatId, "67890");
  } finally {
    service.close();
    await rm(directory, {
      force: true,
      recursive: true
    });
  }
});

test("telegram pairing resolves chat id from a matching deep link start code", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const getUpdatesUrls: string[] = [];
  let expectedStartCode = "";
  const service = await createPushNotificationService({
    events: {
      on() {
        return undefined;
      },
      publishServerEvent() {
        return undefined;
      }
    },
    async fetchImpl(input) {
      const url = String(input);
      if (url.includes("/getMe")) {
        return Response.json({
          ok: true,
          result: {
            username: "DeskCueTestBot"
          }
        });
      }

      if (url.includes("/getUpdates")) {
        getUpdatesUrls.push(url);
        return Response.json({
          ok: true,
          result: [
            {
              message: {
                chat: {
                  first_name: "Ada",
                  id: 12345
                },
                text: `/start ${expectedStartCode}`
              },
              update_id: 7
            }
          ]
        });
      }

      throw new Error(`Unexpected Telegram request: ${url}`);
    },
    storagePath: join(directory, "push-state.json")
  });

  try {
    const pairing = await service.startTelegramPairing({
      providers: {
        telegram: {
          botToken: "telegram-token"
        }
      }
    });

    assert.equal(pairing.botUsername, "DeskCueTestBot");
    assert.match(pairing.deepLink, /^https:\/\/t\.me\/DeskCueTestBot\?start=/);
    expectedStartCode = pairing.code;

    const resolved = await service.resolveTelegramPairing(pairing.code);
    assert.equal(resolved.chatId, "12345");
    assert.equal(resolved.chatTitle, "Ada");
    assert.equal(getUpdatesUrls.length, 1);
    assert.equal(new URL(getUpdatesUrls[0] ?? "").searchParams.has("offset"), false);

    service.close();
  } finally {
    service.close();
    await rm(directory, {
      force: true,
      recursive: true
    });
  }
});

test("telegram pairing retries a transient external fetch failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  let requestCount = 0;
  const service = await createPushNotificationService({
    events: {
      on() {
        return undefined;
      },
      publishServerEvent() {
        return undefined;
      }
    },
    async fetchImpl(input) {
      requestCount += 1;
      if (requestCount === 1) {
        throw new TypeError("fetch failed");
      }

      const url = String(input);
      if (url.includes("/getMe")) {
        return Response.json({
          ok: true,
          result: {
            username: "DeskCueTestBot"
          }
        });
      }

      throw new Error(`Unexpected Telegram request: ${url}`);
    },
    storagePath: join(directory, "push-state.json")
  });

  try {
    const pairing = await service.startTelegramPairing({
      providers: {
        telegram: {
          botToken: "telegram-token"
        }
      }
    });

    assert.equal(pairing.botUsername, "DeskCueTestBot");
    assert.equal(requestCount, 2);
  } finally {
    service.close();
    await rm(directory, {
      force: true,
      recursive: true
    });
  }
});

test("notification routes deliver matching events to configured webhook provider", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const eventListeners: Array<(event: ServerEvent) => void> = [];
  const requests: Array<{ body: unknown; headers: Record<string, string>; url: string }> = [];
  const service = await createPushNotificationService({
    events: {
      on(_eventName, listener) {
        eventListeners.push(listener);
        return undefined;
      },
      publishServerEvent() {
        return undefined;
      }
    },
    async fetchImpl(input, init) {
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
        headers: init?.headers as Record<string, string>,
        url: String(input)
      });
      return new Response("ok", {
        status: 200
      });
    },
    storagePath: join(directory, "push-state.json")
  });

  try {
    await service.updateNotificationSettings({
      providers: {
        webPush: {
          enabled: false
        },
        webhook: {
          enabled: true,
          headersText: "Authorization: Bearer hook-token",
          url: "https://hooks.example.com/deskcue"
        }
      },
      routes: [
        {
          event: "approval.required",
          providers: ["webhook"]
        },
        {
          event: "session.finished",
          providers: []
        },
        {
          event: "session.failed",
          providers: []
        },
        {
          event: "agent.turn.finished",
          providers: []
        }
      ]
    });

    for (const listener of eventListeners) {
      listener(createApprovalEvent());
      listener(createApprovalEvent());
    }
    await waitFor(() => requests.length === 1);

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, "https://hooks.example.com/deskcue");
    assert.equal(requests[0]?.headers.Authorization, "Bearer hook-token");
    assert.deepEqual(requests[0]?.body, {
      body: "Approval workspace: approve or reject Set-Content -LiteralPath .\\approval.txt -Value ok",
      data: {
        actionKind: "approval",
        agentLabel: "Codex",
        notificationKind: "approval.required",
        reason: "Needs write access",
        sessionId: "session-1",
        workspaceName: "Approval workspace"
      },
      tag: "deskcue-session-action-session-1-2026-07-09T10:00:00.000Z",
      title: "DeskCue: approval needed",
      url: "/sessions/session-1/overview"
    });
  } finally {
    service.close();
    await rm(directory, {
      force: true,
      recursive: true
    });
  }
});

test("legacy session webhook is delivered once through the durable notification coordinator", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const eventListeners: Array<(event: ServerEvent) => void> = [];
  const requests: Array<{ body: unknown; url: string }> = [];
  const service = await createPushNotificationService({
    events: {
      on(_eventName, listener) {
        eventListeners.push(listener);
        return undefined;
      },
      publishServerEvent() {
        return undefined;
      }
    },
    async fetchImpl(input, init) {
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
        url: String(input)
      });
      return new Response(null, { status: 204 });
    },
    legacySessionWebhookUrl: "https://legacy.example/deskcue",
    storagePath: join(directory, "push-state.json")
  });

  try {
    assert.equal(eventListeners.length, 1);
    const event = createFinishedSessionEvent();
    for (const listener of eventListeners) {
      listener(event);
      listener(event);
    }
    await waitFor(() => requests.length === 1);

    assert.deepEqual(requests, [{
      body: {
        event: "session.finished",
        session: {
          command: "codex resume session-1",
          exitCode: 0,
          finishedAt: "2026-07-09T10:01:00.000Z",
          id: "session-1",
          lastActivityAt: "2026-07-09T10:01:00.000Z",
          status: "done",
          workspaceId: "workspace-1",
          workspaceName: "Finished workspace"
        }
      },
      url: "https://legacy.example/deskcue"
    }]);
  } finally {
    await service.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("configured webhook takes precedence over the legacy env without duplicate delivery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const eventListeners: Array<(event: ServerEvent) => void> = [];
  const requests: Array<{ body: unknown; url: string }> = [];
  const service = await createPushNotificationService({
    events: {
      on(_eventName, listener) {
        eventListeners.push(listener);
        return undefined;
      },
      publishServerEvent() {
        return undefined;
      }
    },
    async fetchImpl(input, init) {
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
        url: String(input)
      });
      return new Response(null, { status: 204 });
    },
    legacySessionWebhookUrl: "https://legacy.example/deskcue",
    storagePath: join(directory, "push-state.json")
  });

  try {
    await service.updateNotificationSettings({
      providers: {
        webPush: { enabled: false },
        webhook: {
          enabled: true,
          headersText: "",
          url: "https://configured.example/deskcue"
        }
      },
      routes: [
        { event: "approval.required", providers: [] },
        { event: "session.finished", providers: ["webhook"] },
        { event: "session.failed", providers: ["webhook"] },
        { event: "agent.turn.finished", providers: [] }
      ]
    });

    for (const listener of eventListeners) {
      listener(createFinishedSessionEvent());
    }
    await waitFor(() => requests.length === 1);

    assert.equal(requests[0]?.url, "https://configured.example/deskcue");
    assert.equal((requests[0]?.body as { event?: unknown }).event, undefined);
    assert.equal((requests[0]?.body as { title?: unknown }).title, "DeskCue: task finished");
  } finally {
    await service.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("legacy session webhook retry survives notification service restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const storagePath = join(directory, "push-state.json");
  const eventListeners: Array<(event: ServerEvent) => void> = [];
  let requestCount = 0;

  try {
    const firstService = await createPushNotificationService({
      events: {
        on(_eventName, listener) {
          eventListeners.push(listener);
          return undefined;
        },
        publishServerEvent() {
          return undefined;
        }
      },
      async fetchImpl() {
        requestCount += 1;
        throw new TypeError("fetch failed");
      },
      legacySessionWebhookUrl: "https://legacy.example/deskcue",
      retryDelaysMs: [200],
      storagePath
    });

    for (const listener of eventListeners) {
      listener(createFinishedSessionEvent());
    }
    await waitFor(() => firstService.getNotificationSettings().diagnostics.pendingRetries === 1);
    await firstService.close();

    const secondService = await createPushNotificationService({
      events: {
        on() {
          return undefined;
        },
        publishServerEvent() {
          return undefined;
        }
      },
      async fetchImpl() {
        requestCount += 1;
        return new Response(null, { status: 204 });
      },
      legacySessionWebhookUrl: "https://legacy.example/deskcue",
      retryDelaysMs: [200],
      storagePath
    });

    await waitFor(() => requestCount === 2, 1_000);
    assert.equal(secondService.getNotificationSettings().diagnostics.pendingRetries, 0);
    await secondService.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("notification dedupe survives push service restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const storagePath = join(directory, "push-state.json");
  const requests: string[] = [];

  try {
    const firstEventListeners: Array<(event: ServerEvent) => void> = [];
    const firstService = await createPushNotificationService({
      events: {
        on(_eventName, listener) {
          firstEventListeners.push(listener);
          return undefined;
        },
        publishServerEvent() {
          return undefined;
        }
      },
      async fetchImpl(input) {
        requests.push(String(input));
        return new Response("ok", {
          status: 200
        });
      },
      storagePath
    });

    await firstService.updateNotificationSettings({
      providers: {
        webPush: {
          enabled: false
        },
        webhook: {
          enabled: true,
          headersText: "",
          url: "https://hooks.example.com/deskcue"
        }
      },
      routes: [
        {
          event: "approval.required",
          providers: ["webhook"]
        },
        {
          event: "session.finished",
          providers: []
        },
        {
          event: "session.failed",
          providers: []
        },
        {
          event: "agent.turn.finished",
          providers: []
        }
      ]
    });

    for (const listener of firstEventListeners) {
      listener(createApprovalEvent());
    }
    await waitFor(() => requests.length === 1);
    firstService.close();

    const secondEventListeners: Array<(event: ServerEvent) => void> = [];
    const secondService = await createPushNotificationService({
      events: {
        on(_eventName, listener) {
          secondEventListeners.push(listener);
          return undefined;
        },
        publishServerEvent() {
          return undefined;
        }
      },
      async fetchImpl(input) {
        requests.push(String(input));
        return new Response("ok", {
          status: 200
        });
      },
      storagePath
    });

    for (const listener of secondEventListeners) {
      listener(createApprovalEvent());
    }
    await waitFor(() => requests.length === 1);

    assert.deepEqual(requests, ["https://hooks.example.com/deskcue"]);
    secondService.close();
  } finally {
    await rm(directory, {
      force: true,
      recursive: true
    });
  }
});

test("terminal prompt events are neither lost nor duplicated", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const eventListeners: Array<(event: ServerEvent) => void> = [];
  const requests: string[] = [];
  const service = await createPushNotificationService({
    events: {
      on(_eventName, listener) {
        eventListeners.push(listener);
        return undefined;
      },
      publishServerEvent() {
        return undefined;
      }
    },
    async fetchImpl(input) {
      requests.push(String(input));
      return new Response("ok", { status: 200 });
    },
    storagePath: join(directory, "push-state.json")
  });

  try {
    await service.updateNotificationSettings({
      providers: {
        webPush: { enabled: false },
        webhook: {
          enabled: true,
          headersText: "",
          url: "https://hooks.example.com/turn-finished"
        }
      },
      routes: [
        { event: "approval.required", providers: [] },
        { event: "session.finished", providers: [] },
        { event: "session.failed", providers: [] },
        { event: "agent.turn.finished", providers: ["webhook"] }
      ]
    });

    const event: ServerEvent = {
      type: "agent.session.turn.finished",
      payload: {
        agentId: "codex",
        agentLabel: "Codex",
        agentSessionId: "codex:source-terminal",
        answer: "Done",
        completedAt: "2026-08-05T12:00:01.000Z",
        durationMs: 1_000,
        sourceSessionId: "source-terminal",
        startedAt: "2026-08-05T12:00:00.000Z",
        status: "completed",
        title: "Terminal turn",
        workspaceName: "ExampleWorkspace",
        workspacePath: "C:\\projects\\ExampleWorkspace"
      }
    };
    for (const listener of eventListeners) {
      listener(event);
      listener(event);
    }
    await waitFor(() => requests.length === 1);

    assert.deepEqual(requests, ["https://hooks.example.com/turn-finished"]);
  } finally {
    await service.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("external notification providers retry transient delivery failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const eventListeners: Array<(event: ServerEvent) => void> = [];
  let requestCount = 0;
  const service = await createPushNotificationService({
    events: {
      on(_eventName, listener) {
        eventListeners.push(listener);
        return undefined;
      },
      publishServerEvent() {
        return undefined;
      }
    },
    async fetchImpl() {
      requestCount += 1;
      if (requestCount === 1) {
        throw new TypeError("fetch failed");
      }
      return new Response("ok", { status: 200 });
    },
    retryDelaysMs: [1],
    storagePath: join(directory, "push-state.json")
  });

  try {
    await service.updateNotificationSettings({
      providers: {
        webPush: {
          enabled: false
        },
        webhook: {
          enabled: true,
          headersText: "",
          url: "https://hooks.example.com/deskcue"
        }
      },
      routes: [
        {
          event: "approval.required",
          providers: ["webhook"]
        },
        {
          event: "session.finished",
          providers: []
        },
        {
          event: "session.failed",
          providers: []
        },
        {
          event: "agent.turn.finished",
          providers: []
        }
      ]
    });

    for (const listener of eventListeners) {
      listener(createApprovalEvent());
    }
    await waitFor(() =>
      requestCount === 2 &&
      service.getNotificationSettings().diagnostics.pendingRetries === 0
    );

    const settings = service.getNotificationSettings();
    assert.equal(requestCount, 2);
    assert.equal(settings.diagnostics.pendingRetries, 0);
    assert.equal(settings.diagnostics.lastFailure?.status, "uncertain");
    assert.equal(settings.diagnostics.lastFailure?.provider, "webhook");
    assert.equal(settings.diagnostics.lastSuccess?.status, "delivered");
    assert.equal(settings.diagnostics.lastSuccess?.provider, "webhook");
    assert.equal(settings.diagnostics.lastAttempt?.status, "delivered");
  } finally {
    service.close();
    await rm(directory, {
      force: true,
      recursive: true
    });
  }
});

test("notification dispatch is durable before the first network request completes and close drains it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const storagePath = join(directory, "push-state.json");
  const listeners: Array<(event: ServerEvent) => void> = [];
  const deferredRequest = {
    resolve: (_response: Response) => {}
  };
  let requestStarted = false;
  const request = new Promise<Response>((resolve) => {
    deferredRequest.resolve = resolve;
  });
  const service = await createPushNotificationService({
    events: {
      on(_eventName, listener) {
        listeners.push(listener);
        return undefined;
      },
      publishServerEvent() {
        return undefined;
      }
    },
    async fetchImpl() {
      requestStarted = true;
      return request;
    },
    storagePath
  });

  try {
    await configureWebhookApprovalNotifications(service);
    for (const listener of listeners) {
      listener(createApprovalEvent());
    }
    await waitFor(() => requestStarted);

    const stateStore = new SqliteNotificationStateStore(`${storagePath}.sqlite`);
    const durableDispatches = stateStore.listOutbox();
    assert.equal(durableDispatches.length, 1);
    assert.equal(durableDispatches[0]?.attempt, 1);
    assert.equal(durableDispatches[0]?.provider, "webhook");
    stateStore.close();

    let closeCompleted = false;
    const closing = service.close().then(() => {
      closeCompleted = true;
    });
    await delay(10);
    assert.equal(closeCompleted, false);

    deferredRequest.resolve(new Response("ok", { status: 200 }));
    await closing;

    const verificationStore = new SqliteNotificationStateStore(`${storagePath}.sqlite`);
    assert.equal(verificationStore.listOutbox().length, 0);
    verificationStore.close();
  } finally {
    deferredRequest.resolve(new Response("ok", { status: 200 }));
    await service.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("restart resumes persisted first attempts for external and Web Push providers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const storagePath = join(directory, "push-state.json");
  let externalDeliveries = 0;
  let webPushDeliveries = 0;

  try {
    const firstService = await createPushNotificationService({
      events: {
        on() {
          return undefined;
        },
        publishServerEvent() {
          return undefined;
        }
      },
      storagePath
    });
    await configureWebhookApprovalNotifications(firstService);
    await firstService.registerSubscription({
      subscription: pushSubscription("https://push.example/restart-attempt-one")
    });
    await firstService.updateNotificationSettings({
      providers: {
        webPush: { enabled: true }
      },
      routes: [
        { event: "approval.required", providers: ["webhook", "web_push"] },
        { event: "session.finished", providers: [] },
        { event: "session.failed", providers: [] },
        { event: "agent.turn.finished", providers: [] }
      ]
    });
    await firstService.close();

    const stateStore = new SqliteNotificationStateStore(`${storagePath}.sqlite`);
    const createdAt = new Date().toISOString();
    const payloadJson = JSON.stringify({
      body: "Approval needed",
      tag: "restart-attempt-one",
      title: "DeskCue",
      url: "/"
    });
    stateStore.upsertOutbox({
      attempt: 1,
      createdAt,
      event: "approval.required",
      key: "approval.required:webhook:restart-attempt-one",
      maxAttempts: 2,
      nextRetryAt: createdAt,
      payloadJson,
      provider: "webhook"
    });
    stateStore.upsertOutbox({
      attempt: 1,
      createdAt,
      event: "approval.required",
      key: "approval.required:web_push:restart-attempt-one",
      maxAttempts: 1,
      nextRetryAt: createdAt,
      payloadJson,
      provider: "web_push"
    });
    stateStore.close();

    const secondService = await createPushNotificationService({
      events: {
        on() {
          return undefined;
        },
        publishServerEvent() {
          return undefined;
        }
      },
      async fetchImpl() {
        externalDeliveries += 1;
        return new Response("ok", { status: 200 });
      },
      async sendNotification() {
        webPushDeliveries += 1;
      },
      storagePath
    });
    await waitFor(() => externalDeliveries === 1 && webPushDeliveries === 1);
    await secondService.close();

    const verificationStore = new SqliteNotificationStateStore(`${storagePath}.sqlite`);
    assert.equal(verificationStore.listOutbox().length, 0);
    verificationStore.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("external notification retries survive a daemon restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const storagePath = join(directory, "push-state.json");
  const listeners: Array<(event: ServerEvent) => void> = [];
  let requestCount = 0;

  try {
    const firstService = await createPushNotificationService({
      events: {
        on(_eventName, listener) {
          listeners.push(listener);
          return undefined;
        },
        publishServerEvent() {
          return undefined;
        }
      },
      async fetchImpl() {
        requestCount += 1;
        throw new TypeError("fetch failed");
      },
      retryDelaysMs: [200],
      storagePath
    });
    await configureWebhookApprovalNotifications(firstService);

    for (const listener of listeners) {
      listener(createApprovalEvent());
    }
    await waitFor(() => firstService.getNotificationSettings().diagnostics.pendingRetries === 1);
    await delay(20);
    firstService.close();

    const secondService = await createPushNotificationService({
      events: {
        on() {
          return undefined;
        },
        publishServerEvent() {
          return undefined;
        }
      },
      async fetchImpl() {
        requestCount += 1;
        return new Response("ok", { status: 200 });
      },
      retryDelaysMs: [200],
      storagePath
    });
    await waitFor(() => requestCount === 2, 1_000);
    assert.equal(secondService.getNotificationSettings().diagnostics.pendingRetries, 0);
    assert.equal(secondService.getNotificationSettings().diagnostics.lastSuccess?.provider, "webhook");
    secondService.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("external notification retries stop at the fixed attempt limit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const storagePath = join(directory, "push-state.json");
  const listeners: Array<(event: ServerEvent) => void> = [];
  let requestCount = 0;

  try {
    const firstService = await createPushNotificationService({
      events: {
        on(_eventName, listener) {
          listeners.push(listener);
          return undefined;
        },
        publishServerEvent() {
          return undefined;
        }
      },
      async fetchImpl() {
        requestCount += 1;
        throw new Error("network request failed (ETIMEDOUT)");
      },
      retryDelaysMs: [1],
      storagePath
    });
    await configureWebhookApprovalNotifications(firstService);

    for (const listener of listeners) {
      listener(createApprovalEvent());
    }
    await waitFor(() =>
      requestCount === 2 &&
      firstService.getNotificationSettings().diagnostics.pendingRetries === 0
    );
    assert.equal(firstService.getNotificationSettings().diagnostics.lastAttempt?.attempt, 2);
    assert.equal(firstService.getNotificationSettings().diagnostics.lastAttempt?.status, "uncertain");
    firstService.close();

    const secondService = await createPushNotificationService({
      events: {
        on() {
          return undefined;
        },
        publishServerEvent() {
          return undefined;
        }
      },
      async fetchImpl() {
        requestCount += 1;
        return new Response("ok", { status: 200 });
      },
      retryDelaysMs: [1],
      storagePath
    });
    await delay(20);

    const settings = secondService.getNotificationSettings();
    assert.equal(requestCount, 2);
    assert.equal(settings.diagnostics.pendingRetries, 0);
    assert.equal(settings.diagnostics.lastAttempt?.attempt, 2);
    assert.equal(settings.diagnostics.lastAttempt?.status, "uncertain");
    secondService.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("notification outbox evicts its oldest retry at the configured record limit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const storagePath = join(directory, "push-state.json");
  const listeners: Array<(event: ServerEvent) => void> = [];

  try {
    const service = await createPushNotificationService({
      events: {
        on(_eventName, listener) {
          listeners.push(listener);
          return undefined;
        },
        publishServerEvent() {
          return undefined;
        }
      },
      async fetchImpl() {
        throw new TypeError("fetch failed");
      },
      outboxMaxRecords: 2,
      retryDelaysMs: [1_000],
      storagePath
    });
    await configureWebhookApprovalNotifications(service);

    for (const sessionId of ["session-1", "session-2", "session-3"]) {
      for (const listener of listeners) {
        listener(createApprovalEvent(sessionId));
      }
    }
    await waitFor(() => service.getNotificationSettings().diagnostics.pendingRetries === 2);
    service.close();

    const stateStore = new SqliteNotificationStateStore(`${storagePath}.sqlite`);
    assert.equal(stateStore.listOutbox().length, 2);
    stateStore.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("external notification providers omit relative urls from message text", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const requests: Array<{ body: string; headers: Record<string, string>; url: string }> = [];
  const service = await createPushNotificationService({
    events: {
      on() {
        return undefined;
      },
      publishServerEvent() {
        return undefined;
      }
    },
    async fetchImpl(input, init) {
      requests.push({
        body: String(init?.body ?? ""),
        headers: init?.headers as Record<string, string>,
        url: String(input)
      });
      return new Response("ok", {
        status: 200
      });
    },
    storagePath: join(directory, "push-state.json")
  });

  try {
    const ntfyResult = await service.sendTestNotification("ntfy", {
      providers: {
        ntfy: {
          enabled: true,
          topicUrl: "https://ntfy.sh/deskcue-test"
        }
      }
    });
    const gotifyResult = await service.sendTestNotification("gotify", {
      providers: {
        gotify: {
          enabled: true,
          serverUrl: "https://gotify.example.com",
          token: "gotify-token"
        }
      }
    });

    assert.deepEqual(ntfyResult, {
      attempted: 1,
      delivered: 1,
      failed: 0,
      provider: "ntfy"
    });
    assert.deepEqual(gotifyResult, {
      attempted: 1,
      delivered: 1,
      failed: 0,
      provider: "gotify"
    });
    assert.equal(requests[0]?.url, "https://ntfy.sh/deskcue-test");
    assert.equal(requests[0]?.body, "DeskCue notifications are configured.");
    assert.deepEqual(JSON.parse(requests[1]?.body ?? "{}"), {
      message: "DeskCue notifications are configured.",
      priority: 5,
      title: "DeskCue test notification"
    });
  } finally {
    service.close();
    await rm(directory, {
      force: true,
      recursive: true
    });
  }
});

test("ntfy notification preserves non-ascii titles in HTTP headers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const eventListeners: Array<(event: ServerEvent) => void> = [];
  const requests: Array<{ body: string; headers: Record<string, string>; url: string }> = [];
  const service = await createPushNotificationService({
    events: {
      on(_eventName, listener) {
        eventListeners.push(listener);
        return undefined;
      },
      publishServerEvent() {
        return undefined;
      }
    },
    async fetchImpl(input, init) {
      requests.push({
        body: String(init?.body ?? ""),
        headers: init?.headers as Record<string, string>,
        url: String(input)
      });
      return new Response("ok", {
        status: 200
      });
    },
    storagePath: join(directory, "push-state.json")
  });

  try {
    await service.updateNotificationSettings({
      providers: {
        ntfy: {
          enabled: true,
          topicUrl: "https://ntfy.sh/deskcue-test"
        },
        webPush: {
          enabled: false
        }
      },
      routes: [
        {
          event: "approval.required",
          providers: []
        },
        {
          event: "session.finished",
          providers: []
        },
        {
          event: "session.failed",
          providers: []
        },
        {
          event: "agent.turn.finished",
          providers: ["ntfy"]
        }
      ]
    });

    for (const listener of eventListeners) {
      listener({
        type: "agent.session.turn.finished",
        payload: {
          agentId: "codex",
          agentLabel: "Codex",
          agentSessionId: "codex:source-1",
          answer: "Done",
          completedAt: "2026-07-09T10:08:34.000Z",
          sourceSessionId: "source-1",
          startedAt: "2026-07-09T10:00:00.000Z",
          status: "completed",
          title: "Café push polish",
          workspaceName: "ExampleWorkspace",
          workspacePath: "/workspace/project"
        }
      });
    }
    await waitFor(() => requests.length === 1);

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, "https://ntfy.sh/deskcue-test");
    assert.equal(
      requests[0]?.headers.Title,
      "DeskCue: Café push polish"
    );
    assert.equal(requests[0]?.body.includes("/?agent="), false);
  } finally {
    service.close();
    await rm(directory, {
      force: true,
      recursive: true
    });
  }
});

test("telegram notification formats source-agent turn without relative url", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const eventListeners: Array<(event: ServerEvent) => void> = [];
  const requests: Array<{ body: Record<string, unknown>; url: string }> = [];
  const service = await createPushNotificationService({
    events: {
      on(_eventName, listener) {
        eventListeners.push(listener);
        return undefined;
      },
      publishServerEvent() {
        return undefined;
      }
    },
    async fetchImpl(input, init) {
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {},
        url: String(input)
      });
      return new Response("ok", {
        status: 200
      });
    },
    storagePath: join(directory, "push-state.json")
  });

  try {
    await service.updateNotificationSettings({
      providers: {
        telegram: {
          botToken: "telegram-token",
          chatId: "123456",
          enabled: true
        },
        webPush: {
          enabled: false
        }
      },
      routes: [
        {
          event: "approval.required",
          providers: []
        },
        {
          event: "session.finished",
          providers: []
        },
        {
          event: "session.failed",
          providers: []
        },
        {
          event: "agent.turn.finished",
          providers: ["telegram"]
        }
      ]
    });

    for (const listener of eventListeners) {
      listener({
        type: "agent.session.turn.finished",
        payload: {
          agentId: "codex",
          agentLabel: "Codex",
          agentSessionId: "codex:source-1",
          answer: "Done",
          completedAt: "2026-07-09T10:08:34.000Z",
          durationMs: 2_065_000,
          sourceSessionId: "source-1",
          startedAt: "2026-07-09T10:00:00.000Z",
          status: "completed",
          title: "Chat title",
          workspaceName: "ExampleWorkspace",
          workspacePath: "C:\\projects\\ExampleWorkspace"
        }
      });
    }
    await waitFor(() => requests.length === 1);

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, "https://api.telegram.org/bottelegram-token/sendMessage");
    assert.deepEqual(requests[0]?.body, {
      chat_id: "123456",
      disable_web_page_preview: true,
      parse_mode: "MarkdownV2",
      text: [
        "*DeskCue: Chat title*",
        "Codex finished the task \\- 34m 25s",
        "",
        "Answer",
        "Done"
      ].join("\n")
    });
    assert.equal(String(requests[0]?.body.text).includes("/?agent="), false);

    const longAnswer = [
      "Sending the full answer to Telegram is not useful.",
      "- Telegram becomes noisy when the agent writes a long answer.",
      "- The answer may contain markdown, diffs, logs, and implementation details.",
      "- Mobile push works better as a short preview with the full text in DeskCue.",
      "- Sending everything makes the important signal harder to notice."
    ].join("\n");

    for (const listener of eventListeners) {
      listener({
        type: "agent.session.turn.finished",
        payload: {
          agentId: "codex",
          agentLabel: "Codex",
          agentSessionId: "codex:source-1",
          answer: longAnswer,
          completedAt: "2026-07-09T10:08:35.000Z",
          sourceSessionId: "source-1",
          startedAt: "2026-07-09T10:00:00.000Z",
          status: "completed",
          title: "Chat title",
          workspaceName: "ExampleWorkspace",
          workspacePath: "/workspace/project"
        }
      });
    }
    await waitFor(() => requests.length === 2);

    const longMessage = String(requests[1]?.body.text);
    assert.equal(requests.length, 2);
    assert.equal(longMessage.includes("- Telegram"), false);
    assert.equal(longMessage.includes("/?agent="), false);
    assert.match(longMessage, /^\*DeskCue: Chat title\*\nCodex finished the task \\- 8m 35s\n\nAnswer\n/);
    assert.equal(longMessage.includes("Full answer is available in DeskCue\\."), true);
    assert.equal(longMessage.length < 430, true);
  } finally {
    service.close();
    await rm(directory, {
      force: true,
      recursive: true
    });
  }
});

test("telegram notification retries a timed out request over IPv4", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  let ipv4RequestCount = 0;
  let primaryRequestCount = 0;
  const service = await createPushNotificationService({
    events: {
      on() {
        return undefined;
      },
      publishServerEvent() {
        return undefined;
      }
    },
    async fetchImpl() {
      primaryRequestCount += 1;
      throw Object.assign(new AggregateError([], ""), {
        code: "ETIMEDOUT"
      });
    },
    async telegramIpv4FetchImpl() {
      ipv4RequestCount += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    storagePath: join(directory, "push-state.json")
  });

  try {
    const result = await service.sendTestNotification("telegram", {
      providers: {
        telegram: {
          botToken: "telegram-token",
          chatId: "123456",
          enabled: true
        }
      }
    });

    assert.equal(result.delivered, 1);
    assert.equal(result.failed, 0);
    assert.equal(primaryRequestCount, 1);
    assert.equal(ipv4RequestCount, 1);
  } finally {
    service.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("notification routes deliver a completed Local LLM turn through Telegram", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const eventListeners: Array<(event: ServerEvent) => void> = [];
  const requests: Array<{ body: Record<string, unknown>; url: string }> = [];
  const service = await createPushNotificationService({
    events: {
      on(_eventName, listener) {
        eventListeners.push(listener);
        return undefined;
      },
      publishServerEvent() {
        return undefined;
      }
    },
    async fetchImpl(input, init) {
      requests.push({
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
        url: String(input)
      });
      return new Response("ok", { status: 200 });
    },
    storagePath: join(directory, "push-state.json")
  });

  try {
    await service.updateNotificationSettings({
      providers: {
        telegram: { botToken: "telegram-token", chatId: "123456", enabled: true },
        webPush: { enabled: false }
      },
      routes: [
        { event: "approval.required", providers: [] },
        { event: "session.finished", providers: [] },
        { event: "session.failed", providers: [] },
        { event: "agent.turn.finished", providers: ["telegram"] }
      ]
    });
    for (const listener of eventListeners) {
      listener({
        type: "local.llm.chat.finished",
        payload: {
          answer: "Done locally.",
          chatId: "chat-1",
          completedAt: "2026-08-04T12:00:00.000Z",
          error: null,
          model: "qwen3",
          runtimeId: "ollama",
          status: "completed",
          title: "Local test chat"
        }
      });
    }
    await waitFor(() => requests.length === 1);

    assert.equal(requests[0]?.url, "https://api.telegram.org/bottelegram-token/sendMessage");
    assert.match(String(requests[0]?.body.text), /Ollama finished the task/);
    assert.match(String(requests[0]?.body.text), /Done locally/);
  } finally {
    service.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("telegram notification formats approval reason and workspace", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-"));
  const eventListeners: Array<(event: ServerEvent) => void> = [];
  const requests: Array<{ body: Record<string, unknown>; url: string }> = [];
  const service = await createPushNotificationService({
    events: {
      on(_eventName, listener) {
        eventListeners.push(listener);
        return undefined;
      },
      publishServerEvent() {
        return undefined;
      }
    },
    async fetchImpl(input, init) {
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {},
        url: String(input)
      });
      return new Response("ok", {
        status: 200
      });
    },
    storagePath: join(directory, "push-state.json")
  });

  try {
    await service.updateNotificationSettings({
      providers: {
        telegram: {
          botToken: "telegram-token",
          chatId: "123456",
          enabled: true
        },
        webPush: {
          enabled: false
        }
      },
      routes: [
        {
          event: "approval.required",
          providers: ["telegram"]
        },
        {
          event: "session.finished",
          providers: []
        },
        {
          event: "session.failed",
          providers: []
        },
        {
          event: "agent.turn.finished",
          providers: []
        }
      ]
    });

    for (const listener of eventListeners) {
      listener(createApprovalEvent());
    }
    await waitFor(() => requests.length === 1);

    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0]?.body, {
      chat_id: "123456",
      disable_web_page_preview: true,
      parse_mode: "MarkdownV2",
      text: [
        "*DeskCue: approval needed*",
        "Codex needs approval",
        "",
        "Reason",
        "Needs write access",
        "",
        "Workspace: Approval workspace"
      ].join("\n")
    });
  } finally {
    service.close();
    await rm(directory, {
      force: true,
      recursive: true
    });
  }
});
