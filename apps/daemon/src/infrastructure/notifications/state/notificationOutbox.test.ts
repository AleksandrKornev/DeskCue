import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SqliteNotificationStateStore } from "#persistence/journals/notificationStateStore";

import { loadStoredNotificationOutbox } from "./notificationOutbox.ts";

test("notification outbox removes corrupt durable records while loading", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-invalid-outbox-"));
  const store = new SqliteNotificationStateStore(join(directory, "deskcue.sqlite"));

  try {
    store.upsertOutbox({
      attempt: 1,
      createdAt: "2026-08-05T00:00:00.000Z",
      event: "agent.turn.finished",
      key: "invalid-record",
      maxAttempts: 3,
      nextRetryAt: "2026-08-05T00:01:00.000Z",
      payloadJson: "{not-json",
      provider: "telegram"
    });

    assert.deepEqual(loadStoredNotificationOutbox(store), []);
    assert.deepEqual(store.listOutbox(), []);
  } finally {
    store.close();
    await rm(directory, { force: true, recursive: true });
  }
});
