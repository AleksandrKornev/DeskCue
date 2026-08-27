import Database from "better-sqlite3";
import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  rm,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

import type { SessionDetail, WorkspaceSummary } from "@deskcue/protocol";
import { daemonConfig } from "#config/daemonConfig";
import { emptyPreview, emptyReplyState } from "#sessions/model/sessionDefaults";

import { DESKCUE_SQLITE_SCHEMA_VERSION, DeskCueSqliteStateStorage } from "./sqliteStateStorage.ts";

test("throws on SQLite load failure instead of returning empty state", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-sqlite-"));
  const databasePath = join(tempDir, "state.sqlite");
  let storage: DeskCueSqliteStateStorage | null = null;

  try {
    storage = new DeskCueSqliteStateStorage(databasePath);
    const database = new Database(databasePath);

    database.exec("DROP TABLE workspaces");

    database.close();

    await assert.rejects(
      () => storage!.load(),
      /no such table: workspaces/
    );
  } finally {
    storage?.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("prunes old legacy state artifacts on startup", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-sqlite-"));
  const databasePath = join(tempDir, "state.sqlite");
  const oldTmpPath = join(tempDir, "state.old.tmp");
  const freshTmpPath = join(tempDir, "state.fresh.tmp");
  const oldCodexTmpPath = join(tempDir, "codex-transcript-line-counts.old.tmp");
  const oldTurnStateTmpPath = join(tempDir, "agent-session-turn-states.old.tmp");
  const oldSourceIndexTmpPath = join(
    tempDir,
    `${basename(daemonConfig.agentSessionIndexFilePath)}.1234.orphan.tmp`
  );
  const now = new Date();
  const old = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  let storage: DeskCueSqliteStateStorage | null = null;

  try {
    await writeFile(oldTmpPath, "old");
    await writeFile(freshTmpPath, "fresh");
    await writeFile(oldCodexTmpPath, "old");
    await writeFile(oldTurnStateTmpPath, "old");
    await writeFile(oldSourceIndexTmpPath, "old");
    await utimes(oldTmpPath, old, old);
    await utimes(oldCodexTmpPath, old, old);
    await utimes(oldTurnStateTmpPath, old, old);
    await utimes(oldSourceIndexTmpPath, old, old);

    storage = new DeskCueSqliteStateStorage(databasePath);

    await assert.rejects(() => access(oldTmpPath));
    await assert.rejects(() => access(oldCodexTmpPath));
    await assert.rejects(() => access(oldTurnStateTmpPath));
    await assert.rejects(() => access(oldSourceIndexTmpPath));
    await access(freshTmpPath);
  } finally {
    storage?.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("records the SQLite schema version in metadata", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-sqlite-"));
  const databasePath = join(tempDir, "state.sqlite");
  let storage: DeskCueSqliteStateStorage | null = null;

  try {
    storage = new DeskCueSqliteStateStorage(databasePath);

    assert.equal(storage.readSchemaVersion(), DESKCUE_SQLITE_SCHEMA_VERSION);
  } finally {
    storage?.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("rejects SQLite databases from newer schema versions", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-sqlite-"));
  const databasePath = join(tempDir, "state.sqlite");

  try {
    const database = new Database(databasePath);

    database.exec(`
      CREATE TABLE metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    database.prepare(`
      INSERT INTO metadata (key, value, updated_at)
      VALUES ('schema_version', ?, ?)
    `).run(String(DESKCUE_SQLITE_SCHEMA_VERSION + 1), new Date().toISOString());
    database.close();

    assert.throws(
      () => new DeskCueSqliteStateStorage(databasePath),
      /Unsupported DeskCue SQLite schema version/
    );
  } finally {
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

function workspaceSummary(): WorkspaceSummary {
  return {
    id: "workspace-1",
    name: "DeskCue",
    path: "D:\\work\\DeskCue",
    isGitRepo: true,
    branch: "main",
    createdAt: "2026-06-22T10:00:00.000Z"
  };
}

function sessionDetail(workspaceId: string, id = "session-1"): SessionDetail {
  return {
    id,
    workspaceId,
    workspaceName: "DeskCue",
    adapterId: "generic-cli",
    sourceSessionId: null,
    command: "echo hello",
    status: "done",
    startedAt: "2026-06-22T10:00:00.000Z",
    finishedAt: "2026-06-22T10:01:00.000Z",
    lastActivityAt: "2026-06-22T10:01:00.000Z",
    exitCode: 0,
    preview: emptyPreview(),
    replyState: emptyReplyState(),
    actionRequest: null,
    git: {
      isGitRepo: true,
      branch: "main",
      isDirty: false,
      changedFiles: [],
      diff: "",
      lastUpdatedAt: "2026-06-22T10:01:00.000Z"
    },
    logs: [],
    inputHistory: []
  };
}

test("persists daemon workspaces and sessions in SQLite rows", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-sqlite-"));
  const databasePath = join(tempDir, "state.sqlite");
  let storage: DeskCueSqliteStateStorage | null = null;
  let reloadedStorage: DeskCueSqliteStateStorage | null = null;

  try {
    storage = new DeskCueSqliteStateStorage(databasePath);
    const workspace = workspaceSummary();
    const session = sessionDetail(workspace.id);

    await storage.save({
      version: 1,
      workspaces: [workspace],
      sessions: [session]
    });

    reloadedStorage = new DeskCueSqliteStateStorage(databasePath);
    const reloaded = await reloadedStorage.load();

    assert.deepEqual(reloaded.workspaces, [workspace]);
    assert.deepEqual(reloaded.sessions, [session]);
  } finally {
    storage?.close();
    reloadedStorage?.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("removes stale SQLite rows when the persisted snapshot shrinks", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-sqlite-"));
  const databasePath = join(tempDir, "state.sqlite");
  let storage: DeskCueSqliteStateStorage | null = null;
  let reloadedStorage: DeskCueSqliteStateStorage | null = null;

  try {
    storage = new DeskCueSqliteStateStorage(databasePath);
    const workspace = workspaceSummary();

    await storage.save({
      version: 1,
      workspaces: [workspace],
      sessions: [sessionDetail(workspace.id)]
    });
    await storage.save({
      version: 1,
      workspaces: [workspace],
      sessions: []
    });

    reloadedStorage = new DeskCueSqliteStateStorage(databasePath);
    const reloaded = await reloadedStorage.load();

    assert.deepEqual(reloaded.workspaces, [workspace]);
    assert.deepEqual(reloaded.sessions, []);
  } finally {
    storage?.close();
    reloadedStorage?.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("patch save updates changed rows without removing unchanged rows", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-sqlite-"));
  const databasePath = join(tempDir, "state.sqlite");
  let storage: DeskCueSqliteStateStorage | null = null;
  let reloadedStorage: DeskCueSqliteStateStorage | null = null;

  try {
    storage = new DeskCueSqliteStateStorage(databasePath);
    const workspace = workspaceSummary();
    const firstSession = sessionDetail(workspace.id, "session-1");
    const secondSession = sessionDetail(workspace.id, "session-2");

    await storage.save({
      version: 1,
      workspaces: [workspace],
      sessions: [firstSession, secondSession]
    });

    await storage.savePatch({
      version: 1,
      workspaces: [],
      sessions: [
        {
          ...firstSession,
          status: "failed",
          exitCode: 1
        }
      ]
    });

    reloadedStorage = new DeskCueSqliteStateStorage(databasePath);
    const reloaded = await reloadedStorage.load();

    assert.deepEqual(reloaded.workspaces, [workspace]);
    assert.deepEqual(reloaded.sessions, [
      {
        ...firstSession,
        status: "failed",
        exitCode: 1
      },
      secondSession
    ]);
  } finally {
    storage?.close();
    reloadedStorage?.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("loads stopped history sessions as lightweight rows without overwriting stored details", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-sqlite-"));
  const databasePath = join(tempDir, "state.sqlite");
  let storage: DeskCueSqliteStateStorage | null = null;
  let reloadedStorage: DeskCueSqliteStateStorage | null = null;

  try {
    storage = new DeskCueSqliteStateStorage(databasePath);
    const workspace = workspaceSummary();
    const heavySession = {
      ...sessionDetail(workspace.id),
      git: {
        ...sessionDetail(workspace.id).git,
        changedFiles: ["src/heavy.ts"],
        diff: "diff --git a/src/heavy.ts b/src/heavy.ts\n".repeat(100)
      },
      logs: [
        {
          id: "log-1",
          timestamp: "2026-06-22T10:01:00.000Z",
          stream: "stdout" as const,
          text: "large log line\n".repeat(100)
        }
      ],
      inputHistory: ["heavy prompt"]
    };

    await storage.save({
      version: 1,
      workspaces: [workspace],
      sessions: [heavySession]
    });

    reloadedStorage = new DeskCueSqliteStateStorage(databasePath);
    const reloaded = await reloadedStorage.load();

    assert.deepEqual(reloaded.partialSessionIds, [heavySession.id]);
    assert.deepEqual(reloaded.sessions[0]?.logs, []);
    assert.deepEqual(reloaded.sessions[0]?.inputHistory, []);
    assert.deepEqual(reloaded.sessions[0]?.git.changedFiles, []);
    assert.equal(reloaded.sessions[0]?.git.diff, "");

    await reloadedStorage.save(reloaded);
    const database = new Database(databasePath, {
      readonly: true
    });
    const row = database.prepare("SELECT json FROM sessions WHERE id = ?").get(heavySession.id) as {
      json: string;
    };

    database.close();

    assert.deepEqual(JSON.parse(row.json), heavySession);
  } finally {
    storage?.close();
    reloadedStorage?.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("loads running sessions with full details", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-sqlite-"));
  const databasePath = join(tempDir, "state.sqlite");
  let storage: DeskCueSqliteStateStorage | null = null;
  let reloadedStorage: DeskCueSqliteStateStorage | null = null;

  try {
    storage = new DeskCueSqliteStateStorage(databasePath);
    const workspace = workspaceSummary();
    const runningSession = {
      ...sessionDetail(workspace.id),
      status: "running" as const,
      finishedAt: null,
      logs: [
        {
          id: "log-1",
          timestamp: "2026-06-22T10:01:00.000Z",
          stream: "stdout" as const,
          text: "still running\n"
        }
      ]
    };

    await storage.save({
      version: 1,
      workspaces: [workspace],
      sessions: [runningSession]
    });

    reloadedStorage = new DeskCueSqliteStateStorage(databasePath);
    const reloaded = await reloadedStorage.load();

    assert.deepEqual(reloaded.partialSessionIds, []);
    assert.deepEqual(reloaded.sessions, [runningSession]);
  } finally {
    storage?.close();
    reloadedStorage?.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("loads read-only history sessions as lightweight rows", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-sqlite-"));
  const databasePath = join(tempDir, "state.sqlite");
  let storage: DeskCueSqliteStateStorage | null = null;
  let reloadedStorage: DeskCueSqliteStateStorage | null = null;

  try {
    storage = new DeskCueSqliteStateStorage(databasePath);
    const workspace = workspaceSummary();
    const readOnlySession = {
      ...sessionDetail(workspace.id),
      adapterId: "codex",
      sourceSessionId: "source-1",
      status: "read_only" as const,
      exitCode: null,
      logs: [
        {
          id: "log-1",
          timestamp: "2026-06-22T10:01:00.000Z",
          stream: "stdout" as const,
          text: "archived attached output\n"
        }
      ],
      inputHistory: ["archived prompt"]
    };

    await storage.save({
      version: 1,
      workspaces: [workspace],
      sessions: [readOnlySession]
    });

    reloadedStorage = new DeskCueSqliteStateStorage(databasePath);
    const reloaded = await reloadedStorage.load();

    assert.deepEqual(reloaded.partialSessionIds, [readOnlySession.id]);
    assert.deepEqual(reloaded.sessions[0]?.logs, []);
    assert.deepEqual(reloaded.sessions[0]?.inputHistory, []);
  } finally {
    storage?.close();
    reloadedStorage?.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("loads attached Claude shells with full durable details", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-sqlite-"));
  const databasePath = join(tempDir, "state.sqlite");
  let storage: DeskCueSqliteStateStorage | null = null;
  let reloadedStorage: DeskCueSqliteStateStorage | null = null;

  try {
    storage = new DeskCueSqliteStateStorage(databasePath);
    const workspace = workspaceSummary();
    const claudeSession = {
      ...sessionDetail(workspace.id),
      adapterId: "claude-code",
      sourceSessionId: "source-claude",
      status: "failed" as const,
      exitCode: 1,
      logs: [
        {
          id: "log-claude",
          timestamp: "2026-06-22T10:01:00.000Z",
          stream: "stdout" as const,
          text: "durable Claude output\n"
        }
      ],
      inputHistory: ["previous Claude prompt"]
    };

    await storage.save({
      version: 1,
      workspaces: [workspace],
      sessions: [claudeSession]
    });

    reloadedStorage = new DeskCueSqliteStateStorage(databasePath);
    const reloaded = await reloadedStorage.load();

    assert.deepEqual(reloaded.partialSessionIds, []);
    assert.deepEqual(reloaded.sessions, [claudeSession]);
  } finally {
    storage?.close();
    reloadedStorage?.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("quarantines schema-invalid persisted entities during startup hydration", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-sqlite-invalid-row-"));
  const databasePath = join(tempDir, "state.sqlite");
  let storage: DeskCueSqliteStateStorage | null = null;
  try {
    storage = new DeskCueSqliteStateStorage(databasePath);
    await storage.save({
      version: 1,
      workspaces: [workspaceSummary()],
      sessions: [sessionDetail("workspace-1"), sessionDetail("workspace-1", "session-2")]
    });

    storage.close();
    storage = null;

    const database = new Database(databasePath);

    database.prepare("UPDATE workspaces SET json = ? WHERE id = ?")
      .run(JSON.stringify({ id: "workspace-1" }), "workspace-1");
    database.prepare("UPDATE sessions SET status = 'running', json = ? WHERE id = ?")
      .run(JSON.stringify({ id: "session-1", status: "running" }), "session-1");
    database.close();

    storage = new DeskCueSqliteStateStorage(databasePath);
    const state = await storage.load();

    assert.deepEqual(state.workspaces, []);

    assert.deepEqual(state.sessions, []);
    assert.deepEqual(state.partialSessionIds, []);
  } finally {
    storage?.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});
