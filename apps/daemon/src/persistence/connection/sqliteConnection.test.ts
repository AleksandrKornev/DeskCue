import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DESKCUE_SQLITE_BUSY_TIMEOUT_MS,
  getProductionSqliteDatabaseContext,
  openDeskCueSqliteDatabase,
  SqliteDatabaseContext
} from "./sqliteConnection.ts";
import { SqliteAgentSessionReviewStore } from "../journals/agentSessionReviewStore.ts";
import { SqliteNotificationStateStore } from "../journals/notificationStateStore.ts";

test("opens every DeskCue SQLite repository with the shared PRAGMA policy", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-sqlite-connection-"));
  const database = openDeskCueSqliteDatabase(join(directory, "state.sqlite"));

  try {
    assert.equal(database.pragma("journal_mode", { simple: true }), "wal");
    assert.equal(database.pragma("foreign_keys", { simple: true }), 1);
    assert.equal(database.pragma("synchronous", { simple: true }), 1);
    assert.equal(
      database.pragma("busy_timeout", { simple: true }),
      DESKCUE_SQLITE_BUSY_TIMEOUT_MS
    );
  } finally {
    database.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("shared SQLite context migrates once and remains open while borrowed stores close", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-sqlite-context-"));
  const context = new SqliteDatabaseContext(join(directory, "state.sqlite"));

  try {
    const firstMigration = context.ensureMigrated();
    const secondMigration = context.ensureMigrated();
    assert.strictEqual(secondMigration, firstMigration);

    const reviews = new SqliteAgentSessionReviewStore(context);
    const notifications = new SqliteNotificationStateStore(context);
    reviews.markReviewed("session-1", "2026-08-05T00:00:00.000Z");

    reviews.close();
    reviews.close();
    assert.equal(context.database.open, true);

    notifications.saveStateJson('{"enabled":true}');
    assert.equal(notifications.loadStateJson(), '{"enabled":true}');
    const verificationReviews = new SqliteAgentSessionReviewStore(context);
    assert.equal(
      verificationReviews.readReviewedAt("session-1"),
      "2026-08-05T00:00:00.000Z"
    );
    verificationReviews.close();

    notifications.close();
    assert.equal(context.database.open, true);
  } finally {
    context.close();
    context.close();
    assert.equal(context.database.open, false);
    await rm(directory, { force: true, recursive: true });
  }
});

test("standalone store owns its context and close is idempotent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-sqlite-owned-context-"));
  const store = new SqliteAgentSessionReviewStore(join(directory, "state.sqlite"));

  try {
    store.markReviewed("session-1");
    store.close();
    store.close();
    assert.throws(() => store.readReviewedAt("session-1"), /(closed|not open)/i);
  } finally {
    store.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("closed production context can be recreated in the same process", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-sqlite-production-context-"));
  const databasePath = join(directory, "state.sqlite");

  try {
    const first = getProductionSqliteDatabaseContext(databasePath);
    first.ensureMigrated();
    first.close();

    const second = getProductionSqliteDatabaseContext(databasePath);
    assert.notStrictEqual(second, first);
    assert.equal(second.isClosed, false);
    second.ensureMigrated();
    second.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
