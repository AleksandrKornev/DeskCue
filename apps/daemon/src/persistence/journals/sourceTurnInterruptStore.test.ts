import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SqliteSourceTurnInterruptStore } from "./sourceTurnInterruptStore.ts";

test("persists, updates and removes a source turn interrupt lifecycle marker", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-source-turn-interrupt-"));
  const databasePath = join(tempDir, "state.sqlite");
  let store: SqliteSourceTurnInterruptStore | null = null;
  let reloadedStore: SqliteSourceTurnInterruptStore | null = null;

  const key = {
    agentId: "codex",
    sourceSessionId: "source-session",
    turnFingerprint: "turn-entry-42"
  };

  try {
    store = new SqliteSourceTurnInterruptStore(databasePath);
    store.upsert({
      ...key,
      managedSessionId: "managed-session",
      turnStartEntryId: "turn-entry-42",
      turnStartedAt: "2026-07-30T10:00:00.000Z",
      requestedAt: "2026-07-30T10:01:00.000Z",
      phase: "requested",
      confirmationKind: null,
      confirmationEntryId: null,
      terminalOutcome: null,
      confirmedAt: null,
      updatedAt: "2026-07-30T10:01:00.000Z",
      expiresAt: "2026-07-31T10:01:00.000Z"
    });

    reloadedStore = new SqliteSourceTurnInterruptStore(databasePath);
    assert.deepEqual(reloadedStore.get(key), {
      ...key,
      managedSessionId: "managed-session",
      turnStartEntryId: "turn-entry-42",
      turnStartedAt: "2026-07-30T10:00:00.000Z",
      requestedAt: "2026-07-30T10:01:00.000Z",
      phase: "requested",
      confirmationKind: null,
      confirmationEntryId: null,
      terminalOutcome: null,
      confirmedAt: null,
      updatedAt: "2026-07-30T10:01:00.000Z",
      expiresAt: "2026-07-31T10:01:00.000Z"
    });

    reloadedStore.upsert({
      ...reloadedStore.get(key)!,
      phase: "confirmed_source",
      confirmationKind: "source_terminal",
      confirmationEntryId: "turn-completed-43",
      confirmedAt: "2026-07-30T10:02:00.000Z",
      updatedAt: "2026-07-30T10:02:00.000Z"
    });
    assert.equal(reloadedStore.get(key)?.phase, "confirmed_source");
    assert.equal(reloadedStore.delete(key), 1);
    assert.equal(reloadedStore.get(key), null);
  } finally {
    store?.close();
    reloadedStore?.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("cleans up only expired source turn interrupt lifecycle markers", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-source-turn-interrupt-"));
  const databasePath = join(tempDir, "state.sqlite");
  let store: SqliteSourceTurnInterruptStore | null = null;

  try {
    store = new SqliteSourceTurnInterruptStore(databasePath);
    const base = {
      agentId: "codex",
      sourceSessionId: "source-session",
      managedSessionId: "managed-session",
      turnStartEntryId: "turn-entry",
      turnStartedAt: "2026-07-30T10:00:00.000Z",
      requestedAt: "2026-07-30T10:01:00.000Z",
      phase: "unresolved" as const,
      confirmationKind: null,
      confirmationEntryId: null,
      terminalOutcome: null,
      confirmedAt: null,
      updatedAt: "2026-07-30T10:01:00.000Z"
    };
    store.upsert({
      ...base,
      turnFingerprint: "expired-turn",
      expiresAt: "2026-07-30T10:01:00.000Z"
    });
    store.upsert({
      ...base,
      turnFingerprint: "active-turn",
      expiresAt: "2026-07-31T10:01:00.000Z"
    });

    assert.equal(store.cleanup("2026-07-30T10:02:00.000Z"), 1);
    assert.equal(
      store.get({
        agentId: "codex",
        sourceSessionId: "source-session",
        turnFingerprint: "expired-turn"
      }),
      null
    );
    assert.equal(
      store.get({
        agentId: "codex",
        sourceSessionId: "source-session",
        turnFingerprint: "active-turn"
      })?.phase,
      "unresolved"
    );
  } finally {
    store?.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});
