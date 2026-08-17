import Database from "better-sqlite3";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { SessionDetail, WorkspaceSummary } from "@deskcue/protocol";
import { emptyPreview, emptyReplyState } from "#sessions/model/sessionDefaults";

import {
  clearMigrationBackups,
  readStorageMaintenanceStats,
  runLightweightStorageMaintenance,
  runStorageMaintenance
} from "./storageMaintenance.ts";
import {
  runFullStorageMaintenanceInWorker,
  runStorageMaintenanceInWorker
} from "./storageMaintenanceWorkerClient.ts";
import { DeskCueSqliteStateStorage } from "../state/sqliteStateStorage.ts";

function workspaceSummary(): WorkspaceSummary {
  return {
    id: "workspace-1",
    name: "DeskCue",
    path: "D:\\work\\DeskCue",
    isGitRepo: true,
    branch: "main",
    createdAt: "2026-07-15T10:00:00.000Z"
  };
}

function sessionDetail(
  workspaceId: string,
  overrides: Partial<SessionDetail>
): SessionDetail {
  return {
    id: "session-1",
    workspaceId,
    workspaceName: "DeskCue",
    adapterId: "codex",
    sourceSessionId: null,
    command: "codex resume",
    status: "done",
    startedAt: "2026-07-15T10:00:00.000Z",
    finishedAt: null,
    lastActivityAt: "2026-07-15T10:00:00.000Z",
    exitCode: null,
    preview: emptyPreview(),
    replyState: emptyReplyState(),
    actionRequest: null,
    git: {
      isGitRepo: true,
      branch: "main",
      isDirty: false,
      changedFiles: [],
      diff: "",
      lastUpdatedAt: "2026-07-15T10:00:00.000Z"
    },
    logs: [],
    inputHistory: [],
    ...overrides
  };
}

function heavyAttachedSession(workspaceId: string, overrides: Partial<SessionDetail>) {
  return sessionDetail(workspaceId, {
    sourceSessionId: "codex-source",
    status: "read_only",
    git: {
      isGitRepo: true,
      branch: "main",
      isDirty: true,
      changedFiles: ["src/heavy.ts"],
      diff: "diff --git a/src/heavy.ts b/src/heavy.ts\n".repeat(1_000),
      lastUpdatedAt: "2026-07-15T10:00:00.000Z"
    },
    logs: [
      {
        id: "heavy-log",
        stream: "stdout",
        text: "large log line\n".repeat(1_000),
        timestamp: "2026-07-15T10:00:00.000Z"
      }
    ],
    ...overrides
  });
}

function heavyManagedSession(workspaceId: string, overrides: Partial<SessionDetail>) {
  return heavyAttachedSession(workspaceId, {
    sourceSessionId: null,
    status: "done",
    ...overrides
  });
}

async function directoryBytes(directoryPath: string): Promise<number> {
  const entries = await readdir(directoryPath, {
    withFileTypes: true
  });
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        return directoryBytes(entryPath);
      }

      return entry.isFile() ? (await stat(entryPath)).size : 0;
    })
  );

  return sizes.reduce((total, size) => total + size, 0);
}

test("scheduled storage maintenance runs in an isolated worker", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-maintenance-worker-"));
  const databasePath = join(tempDir, "state.sqlite");
  const storage = new DeskCueSqliteStateStorage(databasePath);
  storage.close();

  try {
    const result = await runStorageMaintenanceInWorker(
      {
        databaseFilePath: databasePath,
        pruneDuplicateAttachedSessions: false,
        pruneRevokedAccessDevices: false,
        pruneTerminalSessions: false
      },
      { allowAutomaticVacuum: false }
    );

    assert.equal(result.compacted, false);
    assert.ok(result.after.database.totalBytes > 0);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("manual full storage maintenance compacts in an isolated worker", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-maintenance-full-worker-"));
  const databasePath = join(tempDir, "state.sqlite");
  const storage = new DeskCueSqliteStateStorage(databasePath);
  storage.close();

  try {
    const result = await runFullStorageMaintenanceInWorker({
      databaseFilePath: databasePath,
      pruneDuplicateAttachedSessions: false,
      pruneRevokedAccessDevices: false,
      pruneTerminalSessions: false
    });

    assert.equal(result.compacted, true);
    assert.ok(result.after.database.totalBytes > 0);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("lightweight maintenance skips automatic vacuum when runtime is not quiescent", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-maintenance-"));
  const databasePath = join(tempDir, "state.sqlite");
  const storage = new DeskCueSqliteStateStorage(databasePath);
  storage.close();
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE maintenance_probe (payload BLOB);
    INSERT INTO maintenance_probe (payload) VALUES (zeroblob(1048576));
    DELETE FROM maintenance_probe;
  `);
  database.pragma("wal_checkpoint(TRUNCATE)");
  database.close();

  try {
    const before = readStorageMaintenanceStats(databasePath);
    assert.equal(before.database.freeBytes >= 64 * 1024, true);

    const result = runLightweightStorageMaintenance(
      {
        databaseFilePath: databasePath,
        pruneDuplicateAttachedSessions: false,
        pruneOldAttachedSessions: false,
        pruneRevokedAccessDevices: false,
        pruneTerminalSessions: false
      },
      { allowAutomaticVacuum: false }
    );

    assert.equal(result.compacted, false);
    assert.equal(result.after.database.freeBytes >= 64 * 1024, true);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("storage maintenance reports and prunes duplicate read-only attached sessions", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-maintenance-"));
  const databasePath = join(tempDir, "state.sqlite");
  let storage: DeskCueSqliteStateStorage | null = null;

  try {
    storage = new DeskCueSqliteStateStorage(databasePath);
    const workspace = workspaceSummary();
    await storage.save({
      version: 1,
      workspaces: [workspace],
      sessions: [
        sessionDetail(workspace.id, {
          id: "read-only-old",
          sourceSessionId: "codex-source",
          status: "read_only",
          startedAt: "2026-07-15T10:00:00.000Z",
          lastActivityAt: "2026-07-15T10:01:00.000Z"
        }),
        sessionDetail(workspace.id, {
          id: "read-only-new",
          sourceSessionId: "codex-source",
          status: "read_only",
          startedAt: "2026-07-15T10:02:00.000Z",
          lastActivityAt: "2026-07-15T10:03:00.000Z"
        }),
        sessionDetail(workspace.id, {
          id: "running",
          sourceSessionId: "codex-source",
          status: "running"
        }),
        sessionDetail(workspace.id, {
          id: "manual-stopped",
          sourceSessionId: null,
          status: "stopped"
        })
      ]
    });
    storage.close();
    storage = null;

    const before = readStorageMaintenanceStats(databasePath);
    assert.equal(before.sessions.duplicateAttachedGroups, 1);
    assert.equal(before.sessions.duplicateAttachedSessions, 1);

    const result = runStorageMaintenance({
      compact: false,
      databaseFilePath: databasePath,
      pruneRevokedAccessDevices: false
    });

    assert.equal(result.deletedDuplicateAttachedSessions, 1);
    assert.equal(result.compacted, false);

    const database = new Database(databasePath, {
      readonly: true
    });
    const ids = database.prepare("SELECT id FROM sessions ORDER BY id").all() as Array<{ id: string }>;
    database.close();

    assert.deepEqual(ids.map((row) => row.id), [
      "manual-stopped",
      "read-only-new",
      "running"
    ]);
  } finally {
    storage?.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("storage maintenance retains terminal cards for seven days and caps their count", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-maintenance-"));
  const databasePath = join(tempDir, "state.sqlite");
  let storage: DeskCueSqliteStateStorage | null = null;

  try {
    storage = new DeskCueSqliteStateStorage(databasePath);
    const workspace = workspaceSummary();
    await storage.save({
      version: 1,
      workspaces: [workspace],
      sessions: [
        sessionDetail(workspace.id, {
          id: "terminal-old",
          status: "done",
          lastActivityAt: "2026-07-01T12:00:00.000Z"
        }),
        sessionDetail(workspace.id, {
          id: "terminal-third-newest",
          status: "stopped",
          lastActivityAt: "2026-07-14T12:00:00.000Z"
        }),
        sessionDetail(workspace.id, {
          id: "terminal-second-newest",
          status: "failed",
          lastActivityAt: "2026-07-14T13:00:00.000Z"
        }),
        sessionDetail(workspace.id, {
          id: "terminal-newest",
          status: "read_only",
          lastActivityAt: "2026-07-14T14:00:00.000Z"
        }),
        sessionDetail(workspace.id, {
          id: "running",
          status: "running",
          lastActivityAt: "2026-06-01T12:00:00.000Z"
        })
      ]
    });
    storage.close();
    storage = null;

    const result = runStorageMaintenance({
      compact: false,
      databaseFilePath: databasePath,
      maxTerminalSessions: 2,
      now: new Date("2026-07-15T12:00:00.000Z"),
      pruneDuplicateAttachedSessions: false,
      pruneRevokedAccessDevices: false,
      pruneTerminalSessions: true
    });

    assert.equal(result.deletedTerminalSessions, 2);
    const database = new Database(databasePath, { readonly: true });
    const ids = database.prepare("SELECT id FROM sessions ORDER BY id").all() as Array<{ id: string }>;
    database.close();
    assert.deepEqual(ids.map((row) => row.id), [
      "running",
      "terminal-newest",
      "terminal-second-newest"
    ]);
  } finally {
    storage?.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("storage maintenance prunes only old terminal prompt journal entries", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-maintenance-"));
  const databasePath = join(tempDir, "state.sqlite");
  let storage: DeskCueSqliteStateStorage | null = null;

  try {
    storage = new DeskCueSqliteStateStorage(databasePath);
    storage.close();
    storage = null;

    const database = new Database(databasePath);
    const insert = database.prepare(
      `INSERT INTO prompt_delivery_journal (
        id, session_id, adapter_id, prompt_text, phase, requested_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    insert.run(
      "old-completed",
      "session-1",
      "codex",
      "done",
      "completed",
      "2026-05-01T00:00:00.000Z",
      "2026-05-01T00:00:00.000Z"
    );
    insert.run(
      "recent-interrupted",
      "session-1",
      "claude",
      "stopped",
      "interrupted",
      "2026-07-10T00:00:00.000Z",
      "2026-07-10T00:00:00.000Z"
    );
    insert.run(
      "old-active",
      "session-1",
      "codex",
      "active",
      "dispatching",
      "2026-05-01T00:00:00.000Z",
      "2026-05-01T00:00:00.000Z"
    );
    insert.run(
      "old-outcome-unknown",
      "session-2",
      "codex",
      "unknown",
      "outcome_unknown",
      "2026-05-01T00:00:00.000Z",
      "2026-05-01T00:00:00.000Z"
    );
    insert.run(
      "old-not-sent",
      "session-3",
      "codex",
      "not sent",
      "not_sent",
      "2026-05-01T00:00:00.000Z",
      "2026-05-01T00:00:00.000Z"
    );
    insert.run(
      "old-observed",
      "session-4",
      "codex",
      "observed",
      "observed",
      "2026-05-01T00:00:00.000Z",
      "2026-05-01T00:00:00.000Z"
    );
    database.close();

    runStorageMaintenance({
      compact: false,
      databaseFilePath: databasePath,
      now: new Date("2026-07-15T12:00:00.000Z"),
      pruneDuplicateAttachedSessions: false,
      pruneRevokedAccessDevices: false
    });

    const verificationDatabase = new Database(databasePath, { readonly: true });
    const ids = verificationDatabase
      .prepare("SELECT id FROM prompt_delivery_journal ORDER BY id")
      .all() as Array<{ id: string }>;
    verificationDatabase.close();
    assert.deepEqual(ids.map((row) => row.id), [
      "old-active",
      "old-not-sent",
      "old-outcome-unknown",
      "recent-interrupted"
    ]);
  } finally {
    storage?.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("storage maintenance prunes expired and used access recovery codes", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-maintenance-"));
  const databasePath = join(tempDir, "state.sqlite");
  let storage: DeskCueSqliteStateStorage | null = null;

  try {
    storage = new DeskCueSqliteStateStorage(databasePath);
    storage.close();
    storage = null;
    const database = new Database(databasePath);
    const insert = database.prepare(`
      INSERT INTO access_recovery_codes (
        id, code_hash, created_at, expires_at, used_at
      ) VALUES (?, ?, ?, ?, ?)
    `);
    insert.run("expired", "hash-expired", "2026-08-01T00:00:00.000Z", "2026-08-02T00:00:00.000Z", null);
    insert.run("used", "hash-used", "2026-08-01T00:00:00.000Z", "2026-08-10T00:00:00.000Z", "2026-08-03T00:00:00.000Z");
    insert.run("active", "hash-active", "2026-08-01T00:00:00.000Z", "2026-08-10T00:00:00.000Z", null);
    database.close();

    runStorageMaintenance({
      compact: false,
      databaseFilePath: databasePath,
      now: new Date("2026-08-05T00:00:00.000Z"),
      pruneDuplicateAttachedSessions: false,
      pruneRevokedAccessDevices: false
    });

    const verificationDatabase = new Database(databasePath, { readonly: true });
    const ids = verificationDatabase
      .prepare("SELECT id FROM access_recovery_codes ORDER BY id")
      .all() as Array<{ id: string }>;
    verificationDatabase.close();
    assert.deepEqual(ids.map((row) => row.id), ["active"]);
  } finally {
    storage?.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("storage maintenance prunes agent session reviews older than ninety days", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-maintenance-"));
  const databasePath = join(tempDir, "state.sqlite");
  let storage: DeskCueSqliteStateStorage | null = null;

  try {
    storage = new DeskCueSqliteStateStorage(databasePath);
    storage.close();
    storage = null;
    const database = new Database(databasePath);
    const insert = database.prepare(
      `INSERT INTO agent_session_reviews (agent_session_id, reviewed_at, updated_at)
       VALUES (?, ?, ?)`
    );
    insert.run("old", "2026-03-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z");
    insert.run("recent", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
    database.close();

    runStorageMaintenance({
      compact: false,
      databaseFilePath: databasePath,
      now: new Date("2026-08-05T00:00:00.000Z"),
      pruneDuplicateAttachedSessions: false,
      pruneRevokedAccessDevices: false
    });

    const verificationDatabase = new Database(databasePath, { readonly: true });
    const ids = verificationDatabase
      .prepare("SELECT agent_session_id AS id FROM agent_session_reviews ORDER BY id")
      .all() as Array<{ id: string }>;
    verificationDatabase.close();
    assert.deepEqual(ids.map((row) => row.id), ["recent"]);
  } finally {
    storage?.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("manual storage cleanup removes every terminal card and DeskCue log", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-maintenance-"));
  const databasePath = join(tempDir, "state.sqlite");
  const logDirectory = join(tempDir, "logs");
  let storage: DeskCueSqliteStateStorage | null = null;

  try {
    storage = new DeskCueSqliteStateStorage(databasePath);
    const workspace = workspaceSummary();
    await storage.save({
      version: 1,
      workspaces: [workspace],
      sessions: [
        sessionDetail(workspace.id, { id: "done", status: "done" }),
        sessionDetail(workspace.id, { id: "stopped", status: "stopped" }),
        sessionDetail(workspace.id, { id: "running", status: "running" })
      ]
    });
    storage.close();
    storage = null;
    await mkdir(logDirectory, { recursive: true });
    await writeFile(join(logDirectory, "daemon.jsonl"), "current log");
    await writeFile(join(logDirectory, "daemon.jsonl.1"), "rotated log");

    const result = runStorageMaintenance({
      databaseFilePath: databasePath,
      clearLogs: true,
      pruneDuplicateAttachedSessions: false,
      pruneRevokedAccessDevices: false,
      purgeTerminalSessions: true
    });

    assert.equal(result.deletedTerminalSessions, 2);
    assert.equal(result.clearedLogBytes, Buffer.byteLength("current logrotated log"));
    assert.equal((await stat(join(logDirectory, "daemon.jsonl"))).size, 0);
    assert.deepEqual(await readdir(logDirectory), ["daemon.jsonl"]);
    const database = new Database(databasePath, { readonly: true });
    const ids = database.prepare("SELECT id FROM sessions ORDER BY id").all() as Array<{ id: string }>;
    database.close();
    assert.deepEqual(ids.map((row) => row.id), ["running"]);
  } finally {
    storage?.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("storage stats keep the local model chat library separate from service storage", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-maintenance-"));
  const databasePath = join(tempDir, "service", "deskcue.sqlite");
  const localChatLibraryPath = join(tempDir, "deskcue-chats");
  let storage: DeskCueSqliteStateStorage | null = null;

  try {
    await mkdir(join(tempDir, "service"), { recursive: true });
    storage = new DeskCueSqliteStateStorage(databasePath);
    storage.close();
    storage = null;

    const beforeFirstChat = readStorageMaintenanceStats(databasePath, {
      localChatLibraryPath
    });
    assert.deepEqual(beforeFirstChat.localChats, {
      path: localChatLibraryPath,
      bytes: 0,
      chatCount: 0
    });
    await assert.rejects(stat(localChatLibraryPath));

    const chatPath = join(localChatLibraryPath, "local-chat-1");
    await mkdir(chatPath, { recursive: true });
    await writeFile(join(chatPath, "chat.json"), "{}");
    await writeFile(join(chatPath, "messages.jsonl"), "{\"role\":\"user\"}\n");

    const afterFirstChat = readStorageMaintenanceStats(databasePath, {
      localChatLibraryPath
    });
    assert.equal(afterFirstChat.localChats.path, localChatLibraryPath);
    assert.equal(afterFirstChat.localChats.chatCount, 1);
    assert.ok(afterFirstChat.localChats.bytes > 0);
    assert.ok(afterFirstChat.database.totalBytes > 0);

    const archivedChatPath = join(localChatLibraryPath, "archive", "local-chat-archived");
    await mkdir(archivedChatPath, { recursive: true });
    await writeFile(join(archivedChatPath, "chat.json"), "{}");
    const afterArchivedChat = readStorageMaintenanceStats(databasePath, {
      localChatLibraryPath
    });
    assert.equal(afterArchivedChat.localChats.chatCount, 2);

    await writeFile(`${databasePath}.backup-v0-to-v1-2026-08-03T00-00-00-000Z`, "backup");
    const afterMigrationBackup = readStorageMaintenanceStats(databasePath, {
      localChatLibraryPath
    });
    assert.deepEqual(afterMigrationBackup.migrationBackups, {
      bytes: Buffer.byteLength("backup"),
      count: 1
    });
    assert.equal(
      afterMigrationBackup.database.serviceUsageBytes,
      afterMigrationBackup.database.totalBytes - afterMigrationBackup.migrationBackups.bytes
    );

    const cleanup = clearMigrationBackups(databasePath);
    assert.equal(cleanup.deletedBackups, 1);
    assert.equal(cleanup.deletedBytes, Buffer.byteLength("backup"));
    assert.deepEqual(cleanup.after.migrationBackups, {
      bytes: 0,
      count: 0
    });
  } finally {
    storage?.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("storage maintenance prunes old revoked access devices", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-maintenance-"));
  const databasePath = join(tempDir, "state.sqlite");
  const now = new Date("2026-07-16T10:00:00.000Z");
  let storage: DeskCueSqliteStateStorage | null = null;

  try {
    storage = new DeskCueSqliteStateStorage(databasePath);
    storage.close();
    storage = null;

    const database = new Database(databasePath);
    database.prepare(`
      INSERT INTO access_devices (
        id, token_hash, label, user_agent, created_at, last_seen_at, last_ip, revoked_at
      )
      VALUES (?, ?, ?, NULL, ?, ?, NULL, ?)
    `).run(
      "revoked-old",
      "hash-old",
      "Old phone",
      "2026-07-01T10:00:00.000Z",
      "2026-07-01T10:00:00.000Z",
      "2026-07-01T10:00:00.000Z"
    );
    database.prepare(`
      INSERT INTO access_devices (
        id, token_hash, label, user_agent, created_at, last_seen_at, last_ip, revoked_at
      )
      VALUES (?, ?, ?, NULL, ?, ?, NULL, ?)
    `).run(
      "revoked-new",
      "hash-new",
      "New phone",
      "2026-07-15T10:00:00.000Z",
      "2026-07-15T10:00:00.000Z",
      "2026-07-16T09:30:00.000Z"
    );
    database.prepare(`
      INSERT INTO access_devices (
        id, token_hash, label, user_agent, created_at, last_seen_at, last_ip, revoked_at
      )
      VALUES (?, ?, ?, NULL, ?, ?, NULL, NULL)
    `).run(
      "active",
      "hash-active",
      "Active phone",
      "2026-07-15T10:00:00.000Z",
      "2026-07-15T10:00:00.000Z"
    );
    database.close();

    const result = runStorageMaintenance({
      compact: false,
      databaseFilePath: databasePath,
      now,
      pruneDuplicateAttachedSessions: false,
      revokedAccessDeviceRetentionMs: 24 * 60 * 60 * 1000
    });

    assert.equal(result.deletedRevokedAccessDevices, 1);
    assert.equal(result.after.accessDevices.total, 2);
    assert.equal(result.after.accessDevices.active, 1);
    assert.equal(result.after.accessDevices.revoked, 1);
  } finally {
    storage?.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("storage maintenance prunes old attached shells conservatively", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-maintenance-"));
  const databasePath = join(tempDir, "state.sqlite");
  let storage: DeskCueSqliteStateStorage | null = null;

  try {
    storage = new DeskCueSqliteStateStorage(databasePath);
    const workspace = workspaceSummary();
    await storage.save({
      version: 1,
      workspaces: [workspace],
      sessions: [
        sessionDetail(workspace.id, {
          id: "attached-old",
          sourceSessionId: "codex-source",
          status: "read_only",
          startedAt: "2026-05-01T10:00:00.000Z",
          lastActivityAt: "2026-05-01T10:01:00.000Z"
        }),
        sessionDetail(workspace.id, {
          id: "attached-latest",
          sourceSessionId: "codex-source",
          status: "read_only",
          startedAt: "2026-07-15T10:00:00.000Z",
          lastActivityAt: "2026-07-15T10:01:00.000Z"
        }),
        sessionDetail(workspace.id, {
          id: "attached-only-old",
          sourceSessionId: "codex-old-only",
          status: "read_only",
          startedAt: "2026-05-01T10:00:00.000Z",
          lastActivityAt: "2026-05-01T10:01:00.000Z"
        }),
        sessionDetail(workspace.id, {
          id: "manual-old",
          sourceSessionId: null,
          status: "stopped",
          startedAt: "2026-05-01T10:00:00.000Z",
          lastActivityAt: "2026-05-01T10:01:00.000Z"
        })
      ]
    });
    storage.close();
    storage = null;

    const result = runStorageMaintenance({
      compact: false,
      databaseFilePath: databasePath,
      now: new Date("2026-07-15T12:00:00.000Z"),
      oldAttachedSessionRetentionMs: 30 * 24 * 60 * 60 * 1000,
      pruneOldAttachedSessions: true,
      pruneDuplicateAttachedSessions: false,
      pruneRevokedAccessDevices: false
    });

    assert.equal(result.before.sessions.oldAttachedSessions, 1);
    assert.equal(result.deletedOldAttachedSessions, 1);
    assert.equal(result.after.sessions.oldAttachedSessions, 0);

    const database = new Database(databasePath, {
      readonly: true
    });
    const ids = database.prepare("SELECT id FROM sessions ORDER BY id").all() as Array<{ id: string }>;
    database.close();

    assert.deepEqual(ids.map((row) => row.id), [
      "attached-latest",
      "attached-only-old",
      "manual-old"
    ]);
  } finally {
    storage?.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("storage maintenance compacts inactive attached session payloads for the data directory limit", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-maintenance-"));
  const databasePath = join(tempDir, "state.sqlite");
  let storage: DeskCueSqliteStateStorage | null = null;

  try {
    storage = new DeskCueSqliteStateStorage(databasePath);
    const workspace = workspaceSummary();
    const newest = heavyAttachedSession(workspace.id, {
      id: "attached-newest",
      lastActivityAt: "2026-07-15T12:00:00.000Z"
    });
    await storage.save({
      version: 1,
      workspaces: [workspace],
      sessions: [
        heavyAttachedSession(workspace.id, {
          id: "attached-oldest",
          lastActivityAt: "2026-07-15T10:00:00.000Z"
        }),
        heavyAttachedSession(workspace.id, {
          id: "attached-middle",
          lastActivityAt: "2026-07-15T11:00:00.000Z"
        }),
        newest,
        sessionDetail(workspace.id, {
          id: "manual-history",
          sourceSessionId: null,
          status: "stopped",
          logs: [{ id: "manual-log", stream: "stdout", text: "keep me", timestamp: "2026-07-15T10:00:00.000Z" }]
        })
      ]
    });
    storage.close();
    storage = null;

    const before = readStorageMaintenanceStats(databasePath);
    const result = runLightweightStorageMaintenance({
      databaseFilePath: databasePath,
      storageMaxBytes:
        before.database.totalBytes -
        before.sessions.inactiveAttachedJsonBytes +
        Buffer.byteLength(JSON.stringify(newest)) +
        4 * 1024,
      pruneDuplicateAttachedSessions: false,
      pruneOldAttachedSessions: false,
      pruneRevokedAccessDevices: false,
      pruneTerminalSessions: false
    });

    assert.equal(result.compactedAttachedSessions, 2);
    assert.equal(result.compactedAttachedSessionBytes > 0, true);
    assert.equal(result.compacted, true);

    const database = new Database(databasePath, {
      readonly: true
    });
    const rows = database.prepare("SELECT id, json FROM sessions ORDER BY id").all() as Array<{
      id: string;
      json: string;
    }>;
    database.close();
    const sessions = new Map(rows.map((row) => [row.id, JSON.parse(row.json) as SessionDetail]));

    const newestStored = sessions.get("attached-newest");
    const middleStored = sessions.get("attached-middle");
    const oldestStored = sessions.get("attached-oldest");
    const manualStored = sessions.get("manual-history");
    assert.ok(newestStored);
    assert.ok(middleStored);
    assert.ok(oldestStored);
    assert.ok(manualStored);
    assert.equal(newestStored.logs.length, 1);
    assert.equal(newestStored.git.diff.length > 0, true);
    assert.deepEqual(middleStored.logs, []);
    assert.equal(middleStored.git.diff, "");
    assert.deepEqual(oldestStored.logs, []);
    assert.equal(oldestStored.git.diff, "");
    assert.equal(manualStored.logs[0]?.text, "keep me");
  } finally {
    storage?.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("storage maintenance compacts old finished local session details but keeps session cards", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-maintenance-"));
  const databasePath = join(tempDir, "state.sqlite");
  let storage: DeskCueSqliteStateStorage | null = null;

  try {
    storage = new DeskCueSqliteStateStorage(databasePath);
    const workspace = workspaceSummary();
    const newest = heavyManagedSession(workspace.id, {
      id: "managed-newest",
      lastActivityAt: "2026-07-15T12:00:00.000Z"
    });
    await storage.save({
      version: 1,
      workspaces: [workspace],
      sessions: [
        heavyManagedSession(workspace.id, {
          id: "managed-oldest",
          lastActivityAt: "2026-07-15T10:00:00.000Z"
        }),
        heavyManagedSession(workspace.id, {
          id: "managed-middle",
          lastActivityAt: "2026-07-15T11:00:00.000Z"
        }),
        newest
      ]
    });
    storage.close();
    storage = null;

    const before = readStorageMaintenanceStats(databasePath);
    const result = runLightweightStorageMaintenance({
      databaseFilePath: databasePath,
      storageMaxBytes:
        before.database.totalBytes -
        before.sessions.inactiveManagedJsonBytes +
        Buffer.byteLength(JSON.stringify(newest)) +
        4 * 1024,
      pruneDuplicateAttachedSessions: false,
      pruneOldAttachedSessions: false,
      pruneRevokedAccessDevices: false,
      pruneTerminalSessions: false
    });

    assert.equal(result.compactedManagedSessions, 2);
    assert.equal(result.compactedManagedSessionBytes > 0, true);

    const database = new Database(databasePath, {
      readonly: true
    });
    const rows = database.prepare("SELECT id, json FROM sessions ORDER BY id").all() as Array<{
      id: string;
      json: string;
    }>;
    database.close();
    const sessions = new Map(rows.map((row) => [row.id, JSON.parse(row.json) as SessionDetail]));

    const newestStored = sessions.get("managed-newest");
    const middleStored = sessions.get("managed-middle");
    const oldestStored = sessions.get("managed-oldest");
    assert.ok(newestStored);
    assert.ok(middleStored);
    assert.ok(oldestStored);
    assert.equal(newestStored.logs.length, 1);
    assert.equal(newestStored.git.diff.length > 0, true);
    assert.equal(middleStored.status, "done");
    assert.equal(middleStored.command, "codex resume");
    assert.deepEqual(middleStored.logs, []);
    assert.equal(middleStored.git.diff, "");
    assert.deepEqual(oldestStored.logs, []);
    assert.equal(oldestStored.git.diff, "");
  } finally {
    storage?.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("storage maintenance normalizes daemon log retention", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-maintenance-"));
  const databasePath = join(tempDir, "state.sqlite");
  const logDir = join(tempDir, "logs");
  let storage: DeskCueSqliteStateStorage | null = null;

  try {
    storage = new DeskCueSqliteStateStorage(databasePath);
    storage.close();
    storage = null;
    await mkdir(logDir, {
      recursive: true
    });
    await writeFile(join(logDir, "daemon.jsonl"), "x".repeat(6 * 1024 * 1024));
    await writeFile(join(logDir, "daemon.jsonl.1"), "x".repeat(6 * 1024 * 1024));
    await writeFile(join(logDir, "daemon.jsonl.2"), "small");
    await writeFile(join(logDir, "daemon.jsonl.4"), "old");

    const result = runStorageMaintenance({
      compact: false,
      databaseFilePath: databasePath,
      pruneDuplicateAttachedSessions: false,
      pruneRevokedAccessDevices: false
    });

    assert.equal(result.deletedLogFiles, 3);
    assert.equal(result.after.database.logBytes < result.before.database.logBytes, true);
  } finally {
    storage?.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("automatic storage maintenance prunes oldest daemon logs to stay within the data limit", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-maintenance-"));
  const databasePath = join(tempDir, "state.sqlite");
  const logDir = join(tempDir, "logs");
  const storageLimitBytes = 7 * 1024 * 1024;
  let storage: DeskCueSqliteStateStorage | null = null;

  try {
    storage = new DeskCueSqliteStateStorage(databasePath);
    storage.close();
    storage = null;
    await mkdir(logDir, {
      recursive: true
    });
    await writeFile(join(logDir, "daemon.jsonl"), "current".repeat(700_000));
    await writeFile(join(logDir, "daemon.jsonl.1"), "newer".repeat(700_000));
    await writeFile(join(logDir, "daemon.jsonl.2"), "older".repeat(700_000));
    await writeFile(join(logDir, "daemon.jsonl.3"), "oldest".repeat(700_000));

    const result = runLightweightStorageMaintenance({
      databaseFilePath: databasePath,
      pruneDuplicateAttachedSessions: false,
      pruneOldAttachedSessions: false,
      pruneRevokedAccessDevices: false,
      storageMaxBytes: storageLimitBytes
    });

    assert.equal(result.deletedLogFiles > 0, true);
    assert.equal(result.after.database.totalBytes <= storageLimitBytes, true);
    assert.equal(result.after.warnings.some((warning) => warning.code === "storage.size"), false);
    assert.equal(
      Math.abs((await directoryBytes(tempDir)) - result.after.database.totalBytes) <= 64 * 1024,
      true
    );
  } finally {
    storage?.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("storage maintenance reports size and duplicate warnings", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-maintenance-"));
  const databasePath = join(tempDir, "state.sqlite");
  let storage: DeskCueSqliteStateStorage | null = null;

  try {
    storage = new DeskCueSqliteStateStorage(databasePath);
    const workspace = workspaceSummary();
    await storage.save({
      version: 1,
      workspaces: [workspace],
      sessions: [
        sessionDetail(workspace.id, {
          id: "read-only-old",
          sourceSessionId: "codex-source",
          status: "read_only",
          lastActivityAt: "2026-07-15T10:01:00.000Z"
        }),
        sessionDetail(workspace.id, {
          id: "read-only-new",
          sourceSessionId: "codex-source",
          status: "read_only",
          lastActivityAt: "2026-07-15T10:03:00.000Z"
        })
      ]
    });
    storage.close();
    storage = null;

    const stats = readStorageMaintenanceStats(databasePath);
    const forcedWarningResult = runStorageMaintenance({
      compact: false,
      databaseFilePath: databasePath,
      pruneDuplicateAttachedSessions: false,
      pruneOldAttachedSessions: false,
      pruneRevokedAccessDevices: false,
      storageMaxBytes: Math.max(1, stats.database.totalBytes - 1)
    });

    assert.equal(
      forcedWarningResult.before.warnings.some((warning) => warning.code === "storage.size"),
      true
    );
    assert.equal(
      forcedWarningResult.before.warnings.some(
        (warning) => warning.code === "sessions.duplicate-attached"
      ),
      true
    );
  } finally {
    storage?.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});
