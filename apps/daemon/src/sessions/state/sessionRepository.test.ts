import assert from "node:assert/strict";
import test from "node:test";

import type { SessionDetail } from "@deskcue/protocol";
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
