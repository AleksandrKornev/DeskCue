import assert from "node:assert/strict";
import test from "node:test";

import type { SessionDetail, WorkspaceSummary } from "@deskcue/protocol";
import { emptyPreview, emptyReplyState } from "#sessions/model/sessionDefaults";

import { SessionRepository } from "./sessionRepository.ts";

function claudeSession(patch: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: "managed-claude",
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    adapterId: "claude-code",
    sourceSessionId: "source-claude",
    command: "claude --resume source-claude --print previous prompt",
    status: "failed",
    startedAt: "2026-08-27T10:00:00.000Z",
    finishedAt: "2026-08-27T10:01:00.000Z",
    lastActivityAt: "2026-08-27T10:01:00.000Z",
    exitCode: 1,
    preview: emptyPreview(),
    replyState: emptyReplyState(),
    actionRequest: null,
    git: {
      branch: null,
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: false,
      lastUpdatedAt: "2026-08-27T10:01:00.000Z"
    },
    logs: [],
    inputHistory: ["previous prompt"],
    ...patch
  };
}

test("reuses a failed Claude source shell for the same native chat", () => {
  const repository = new SessionRepository();
  const session = claudeSession();

  repository.setSession(session);

  assert.equal(repository.findReadOnlyAttachedSession("source-claude"), session);
});

test("does not reuse an unrelated failed source shell as a review shell", () => {
  const repository = new SessionRepository();

  repository.setSession(claudeSession({
    adapterId: "codex",
    id: "managed-codex",
    sourceSessionId: "source-codex"
  }));

  assert.equal(repository.findReadOnlyAttachedSession("source-codex"), null);
});

test("scopes reusable review shells to their adapter when source ids collide", () => {
  const repository = new SessionRepository();
  const codex = claudeSession({
    adapterId: "codex",
    command: "codex resume shared-source (read-only)",
    id: "managed-codex",
    sourceSessionId: "shared-source",
    status: "read_only"
  });
  const claude = claudeSession({
    id: "managed-claude",
    sourceSessionId: "shared-source"
  });

  repository.setSession(codex);
  repository.setSession(claude);

  assert.equal(
    repository.findReadOnlyAttachedSession("shared-source", "claude-code"),
    claude
  );

  assert.equal(
    repository.findReadOnlyAttachedSession("shared-source", "codex"),
    codex
  );
});

test("scopes running attached shells to their adapter when source ids collide", () => {
  const repository = new SessionRepository();
  const codex = claudeSession({
    adapterId: "codex",
    id: "managed-codex",
    sourceSessionId: "shared-source",
    status: "running"
  });
  const claude = claudeSession({
    id: "managed-claude",
    sourceSessionId: "shared-source",
    status: "running"
  });

  repository.setSession(codex);
  repository.setSession(claude);

  assert.equal(
    repository.findReusableAttachedSession("shared-source", "claude-code"),
    claude
  );

  assert.equal(
    repository.findReusableAttachedSession("shared-source", "codex"),
    codex
  );
});

test("atomically claims one shell per adapter and source id", () => {
  const repository = new SessionRepository();
  const running = claudeSession({ status: "running" });
  const candidate = claudeSession({ id: "duplicate-candidate" });

  assert.equal(repository.claimAttachedSession(running), null);
  assert.equal(repository.claimAttachedSession(candidate), running);
  assert.equal(repository.sessionCount, 1);
});

test("removes only the exact unpersisted session revision", () => {
  const repository = new SessionRepository();
  const initial = claudeSession();
  const newer = { ...initial, status: "running" as const };

  repository.setSession(initial);
  repository.setSession(newer);

  assert.equal(repository.removeSessionIfCurrent(initial.id, initial), false);
  assert.equal(repository.getSession(initial.id), newer);
  assert.equal(repository.removeSessionIfCurrent(newer.id, newer), true);
  assert.equal(repository.getSession(newer.id), null);
});

test("keeps a newer session revision dirty after an older snapshot is persisted", () => {
  const repository = new SessionRepository();
  const initial = claudeSession();
  const newer = { ...initial, status: "running" as const };

  repository.setSession(initial);
  const snapshots = repository.listSessionPersistenceSnapshots({ dirtyOnly: true });

  repository.setSession(newer);

  repository.markPersistenceSnapshotsPersisted([], snapshots);

  assert.deepEqual(
    repository.listDirtyPersistedSessions().map((session) => session.status),
    ["running"]
  );
});

test("keeps a newer workspace revision dirty after an older snapshot is persisted", () => {
  const repository = new SessionRepository();
  const initial: WorkspaceSummary = {
    branch: "main",
    createdAt: "2026-08-27T10:00:00.000Z",
    id: "workspace-1",
    isGitRepo: true,
    name: "Workspace",
    path: "D:/workspace"
  };

  const newer = { ...initial, branch: "feature/newer" };

  repository.setWorkspace(initial);
  const snapshots = repository.listWorkspacePersistenceSnapshots({ dirtyOnly: true });

  repository.setWorkspace(newer);

  repository.markPersistenceSnapshotsPersisted(snapshots, []);

  assert.deepEqual(repository.listDirtyWorkspaces(), [newer]);
});

test("preserves lightweight session metadata during an exact revision replacement", () => {
  const repository = new SessionRepository();
  const initial = claudeSession();
  const replacement = {
    ...initial,
    command: `${initial.command} (observe-only)`
  };

  repository.setSession(initial, { partial: true });

  assert.equal(
    repository.replaceSessionIfCurrent(initial.id, initial, replacement),
    true
  );

  assert.deepEqual(repository.listPartialSessionIds(), [initial.id]);
  assert.deepEqual(repository.listDirtyPersistedSessions(), []);
});

test("materializes a lightweight session without marking its durable snapshot dirty", () => {
  const repository = new SessionRepository();
  const lightweight = claudeSession({
    inputHistory: [],
    logs: []
  });
  const materialized = claudeSession({
    inputHistory: ["Previous prompt"],
    logs: [{
      id: "log-1",
      stream: "stdout",
      text: "Previous output\n",
      timestamp: "2026-08-27T10:01:00.000Z"
    }]
  });

  repository.setSession(lightweight, { partial: true });
  repository.markAllPersisted();

  assert.equal(
    repository.materializePartialSessionIfCurrent(lightweight.id, lightweight, materialized),
    true
  );
  assert.equal(repository.isPartialSession(lightweight.id), false);
  assert.equal(repository.getSession(lightweight.id), materialized);
  assert.deepEqual(repository.listDirtyPersistedSessions(), []);

  repository.updateSession(lightweight.id, { status: "running" });

  assert.equal(repository.listDirtyPersistedSessions()[0]?.status, "running");
});

test("shares one durable attached-session creation with concurrent followers", async () => {
  const repository = new SessionRepository();
  const session = claudeSession();
  let operationCalls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const operation = async () => {
    operationCalls += 1;
    await gate;
    return session;
  };

  const first = repository.runAttachedSessionCreation(
    "claude-code",
    "source-claude",
    operation
  );
  const second = repository.runAttachedSessionCreation(
    "claude-code",
    "source-claude",
    operation
  );

  release();

  assert.equal(await first, session);
  assert.equal(await second, session);
  assert.equal(operationCalls, 1);
});

test("rejects every attached-session follower and permits retry after failure", async () => {
  const repository = new SessionRepository();
  const failure = new Error("disk unavailable");
  let operationCalls = 0;

  const operation = async () => {
    operationCalls += 1;
    throw failure;
  };

  const first = repository.runAttachedSessionCreation(
    "claude-code",
    "source-claude",
    operation
  );
  const second = repository.runAttachedSessionCreation(
    "claude-code",
    "source-claude",
    operation
  );

  const failed = await Promise.allSettled([first, second]);

  assert.equal(failed[0]?.status, "rejected");
  assert.equal(failed[1]?.status, "rejected");
  assert.equal(operationCalls, 1);

  await new Promise((resolve) => setImmediate(resolve));

  const retried = await repository.runAttachedSessionCreation(
    "claude-code",
    "source-claude",
    async () => claudeSession({ id: "retried" })
  );

  assert.equal(retried.id, "retried");
});
