import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SqliteNotificationStateStore } from "./notificationStateStore.ts";

test("notification state and outbox survive a store restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-notification-store-"));
  const databasePath = join(directory, "state.sqlite");

  try {
    const first = new SqliteNotificationStateStore(databasePath);
    first.saveStateJson('{"enabled":true}');
    first.upsertOutbox({
      attempt: 2,
      createdAt: "2026-08-05T11:59:00.000Z",
      event: "agent.turn.finished",
      key: "telegram:event-1",
      maxAttempts: 4,
      nextRetryAt: "2026-08-05T12:00:00.000Z",
      payloadJson: '{"title":"Done"}',
      provider: "telegram"
    });
    first.close();

    const second = new SqliteNotificationStateStore(databasePath);
    assert.equal(second.loadStateJson(), '{"enabled":true}');
    assert.deepEqual(second.listOutbox(), [
      {
        attempt: 2,
        createdAt: "2026-08-05T11:59:00.000Z",
        event: "agent.turn.finished",
        key: "telegram:event-1",
        maxAttempts: 4,
        nextRetryAt: "2026-08-05T12:00:00.000Z",
        payloadJson: '{"title":"Done"}',
        provider: "telegram"
      }
    ]);

    second.deleteOutbox("telegram:event-1");
    assert.deepEqual(second.listOutbox(), []);
    second.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("notification outbox prunes expired rows and keeps only the newest bounded set", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-notification-store-"));
  const databasePath = join(directory, "state.sqlite");

  try {
    const store = new SqliteNotificationStateStore(databasePath);
    for (const [key, createdAt] of [
      ["expired", "2026-07-01T00:00:00.000Z"],
      ["oldest-current", "2026-08-05T10:00:00.000Z"],
      ["newer", "2026-08-05T11:00:00.000Z"],
      ["newest", "2026-08-05T12:00:00.000Z"]
    ] as const) {
      store.upsertOutbox({
        attempt: 2,
        createdAt,
        event: "agent.turn.finished",
        key,
        maxAttempts: 4,
        nextRetryAt: "2026-08-05T13:00:00.000Z",
        payloadJson: '{"title":"Done"}',
        provider: "telegram"
      });
    }

    assert.deepEqual(
      store.pruneOutbox({
        maxRecords: 2,
        oldestCreatedAt: "2026-08-01T00:00:00.000Z"
      }).sort(),
      ["expired", "oldest-current"]
    );
    assert.deepEqual(store.listOutbox().map((record) => record.key), ["newer", "newest"]);
    store.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
