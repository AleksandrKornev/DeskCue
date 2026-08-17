import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { SessionDetail, WorkspaceSummary } from "@deskcue/protocol";
import { emptyPreview, emptyReplyState } from "#sessions/model/sessionDefaults";

import { DeskCueSqliteStateStorage } from "./sqliteStateStorage.ts";
import { SqliteDatabaseContext } from "../connection/sqliteConnection.ts";

test("a new database loads empty state while corrupt bytes propagate an error", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-state-empty-"));
  const emptyPath = join(directory, "empty.sqlite");
  const corruptPath = join(directory, "corrupt.sqlite");
  const storage = new DeskCueSqliteStateStorage(emptyPath);

  try {
    assert.deepEqual(await storage.load(), {
      version: 1,
      workspaces: [],
      sessions: [],
      partialSessionIds: []
    });
    await writeFile(corruptPath, "not a sqlite database");
    assert.throws(
      () => new DeskCueSqliteStateStorage(corruptPath),
      /(not a database|encrypted|malformed)/i
    );
  } finally {
    storage.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("closing storage borrowed from a context leaves that context usable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-state-borrowed-"));
  const context = new SqliteDatabaseContext(join(directory, "state.sqlite"));

  try {
    const storage = new DeskCueSqliteStateStorage(context);
    await storage.save({ version: 1, workspaces: [], sessions: [] });
    storage.close();
    storage.close();

    assert.equal(context.database.open, true);
    assert.deepEqual(
      context.database.prepare("SELECT COUNT(*) AS count FROM workspaces").get(),
      { count: 0 }
    );
  } finally {
    context.close();
    await rm(directory, { force: true, recursive: true });
  }
});

function workspace(id: string, createdAt: string): WorkspaceSummary {
  return {
    id,
    name: id,
    path: `D:\\work\\${id}`,
    isGitRepo: true,
    branch: "main",
    createdAt
  };
}

function session(workspaceId: string, id: string, startedAt: string): SessionDetail {
  return {
    id,
    workspaceId,
    workspaceName: workspaceId,
    adapterId: "generic-cli",
    sourceSessionId: null,
    command: "echo test",
    status: "running",
    startedAt,
    finishedAt: null,
    lastActivityAt: startedAt,
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
      lastUpdatedAt: startedAt
    },
    logs: [],
    inputHistory: []
  };
}

test("snapshot save rolls back rows and repository caches when serialization fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-state-atomic-"));
  const databasePath = join(directory, "state.sqlite");
  const storage = new DeskCueSqliteStateStorage(databasePath);

  try {
    const originalWorkspace = workspace("workspace-original", "2026-08-05T10:00:00.000Z");
    const originalSession = session(originalWorkspace.id, "session-original", "2026-08-05T10:00:00.000Z");
    await storage.save({
      version: 1,
      workspaces: [originalWorkspace],
      sessions: [originalSession]
    });

    const nextWorkspace = workspace("workspace-next", "2026-08-05T11:00:00.000Z");
    const circularSession = session(nextWorkspace.id, "session-next", "2026-08-05T11:00:00.000Z");
    (circularSession as unknown as { cycle: unknown }).cycle = circularSession;
    await assert.rejects(
      storage.save({
        version: 1,
        workspaces: [nextWorkspace],
        sessions: [circularSession]
      }),
      /circular/i
    );

    const afterFailure = await storage.load();
    assert.deepEqual(afterFailure.workspaces, [originalWorkspace]);
    assert.deepEqual(afterFailure.sessions, [originalSession]);

    const validNextSession = session(
      nextWorkspace.id,
      "session-next",
      "2026-08-05T11:00:00.000Z"
    );
    await storage.save({
      version: 1,
      workspaces: [nextWorkspace],
      sessions: [validNextSession]
    });
    const afterRetry = await storage.load();
    assert.deepEqual(afterRetry.workspaces, [nextWorkspace]);
    assert.deepEqual(afterRetry.sessions, [validNextSession]);
  } finally {
    storage.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("load order follows workspace creation and session start timestamps", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-state-order-"));
  const databasePath = join(directory, "state.sqlite");
  const storage = new DeskCueSqliteStateStorage(databasePath);

  try {
    const firstWorkspace = workspace("workspace-first", "2026-08-05T10:00:00.000Z");
    const secondWorkspace = workspace("workspace-second", "2026-08-05T11:00:00.000Z");
    const firstSession = session(firstWorkspace.id, "session-first", "2026-08-05T10:00:00.000Z");
    const secondSession = session(secondWorkspace.id, "session-second", "2026-08-05T11:00:00.000Z");
    await storage.save({
      version: 1,
      workspaces: [secondWorkspace, firstWorkspace],
      sessions: [secondSession, firstSession]
    });

    const loaded = await storage.load();
    assert.deepEqual(loaded.workspaces.map((item) => item.id), ["workspace-first", "workspace-second"]);
    assert.deepEqual(loaded.sessions.map((item) => item.id), ["session-first", "session-second"]);
  } finally {
    storage.close();
    await rm(directory, { force: true, recursive: true });
  }
});
