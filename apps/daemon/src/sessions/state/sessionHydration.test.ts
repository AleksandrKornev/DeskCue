import assert from "node:assert/strict";
import test from "node:test";

import type { SessionDetail } from "@deskcue/protocol";
import { CODEX_ACTIVE_WRITER_BLOCKED_REASON } from "#agents/codex/session/codexWriterConflict";
import { emptyPreview, emptyReplyState } from "#sessions/model/sessionDefaults";

import { hydratePersistedSessions } from "./sessionHydration.ts";

function session(overrides: Partial<SessionDetail>): SessionDetail {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    adapterId: "generic-cli",
    sourceSessionId: null,
    command: "echo ok",
    status: "running",
    startedAt: "2026-06-22T10:00:00.000Z",
    finishedAt: null,
    lastActivityAt: "2026-06-22T10:00:00.000Z",
    exitCode: null,
    preview: emptyPreview(),
    replyState: emptyReplyState(),
    git: {
      branch: null,
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: false,
      lastUpdatedAt: "2026-06-22T10:00:00.000Z"
    },
    logs: [],
    inputHistory: [],
    ...overrides
  };
}

test("marks persisted running sessions as stopped on hydration", () => {
  const hydrated = hydratePersistedSessions([session({})]);

  assert.equal(hydrated.revivedRunningSessions, 1);
  assert.equal(hydrated.restoredCodexAttachedSessions, 0);
  assert.equal(hydrated.sessions[0]?.status, "stopped");
  assert.equal(hydrated.sessions[0]?.logs.at(-1)?.stream, "system");
});

test("normalizes legacy preview storage to device-direct routing", () => {
  const legacyPreview = {
    active: true,
    artifacts: [],
    port: 5173,
    targetUrl: "http://127.0.0.1:5173"
  } as unknown as SessionDetail["preview"];

  const hydrated = hydratePersistedSessions([
    session({ preview: legacyPreview, status: "done" })
  ]);

  assert.equal(hydrated.sessions[0]?.preview.networkMode, "device-direct");
});

test("restores persisted running Codex attached sessions as read-only shells", () => {
  const hydrated = hydratePersistedSessions([
    session({
      adapterId: "codex",
      sourceSessionId: "codex-source"
    })
  ]);

  assert.equal(hydrated.revivedRunningSessions, 0);
  assert.equal(hydrated.restoredCodexAttachedSessions, 1);
  assert.equal(hydrated.sessions[0]?.status, "read_only");
  assert.equal(hydrated.sessions[0]?.exitCode, null);
  assert.equal(hydrated.sessions[0]?.replyState.phase, "idle");
  assert.match(
    hydrated.sessions[0]?.logs.at(-1)?.text ?? "",
    /restored this Codex chat/
  );
});

test("restores detached Codex failures as read-only shells", () => {
  const hydrated = hydratePersistedSessions([
    session({
      adapterId: "codex",
      sourceSessionId: "codex-source",
      status: "failed"
    })
  ]);

  assert.equal(hydrated.normalizedDetachedSessions, 0);
  assert.equal(hydrated.restoredCodexAttachedSessions, 1);
  assert.equal(hydrated.sessions[0]?.status, "read_only");
});

test("restores a persisted Codex active-writer conflict without a failed exit code", () => {
  const hydrated = hydratePersistedSessions([
    session({
      adapterId: "codex",
      exitCode: 1,
      sourceSessionId: "codex-source",
      status: "failed",
      replyState: {
        phase: "waiting",
        promptText: "Continue",
        requestedAt: "2026-06-22T10:00:30.000Z"
      },
      logs: [{
        id: "log-1",
        stream: "stderr",
        text: "thread-store conflict: thread codex-source already has an active writer",
        timestamp: "2026-06-22T10:01:00.000Z"
      }]
    })
  ]);

  const restored = hydrated.sessions[0];

  assert.equal(restored?.status, "read_only");
  assert.equal(restored?.exitCode, null);
  assert.match(restored?.inputBlockedReason ?? "", /Codex Desktop still owns this chat/);
  assert.match(restored?.logs.at(-1)?.text ?? "", /prompt was not sent/);
});

test("does not restore a stale Codex active-writer conflict after a later failure", () => {
  const hydrated = hydratePersistedSessions([
    session({
      adapterId: "codex",
      exitCode: 1,
      sourceSessionId: "codex-source",
      status: "failed",
      logs: [
        {
          id: "old-conflict",
          stream: "stderr",
          text: "thread-store conflict: thread codex-source already has an active writer",
          timestamp: "2026-06-22T10:01:00.000Z"
        },
        {
          id: "later-failure",
          stream: "stderr",
          text: "A later unrelated Codex failure",
          timestamp: "2026-06-22T10:03:00.000Z"
        }
      ]
    })
  ]);

  const restored = hydrated.sessions[0];

  assert.equal(hydrated.restoredCodexAttachedSessions, 0);
  assert.equal(restored?.status, "failed");
  assert.equal(restored?.exitCode, 1);
});

test("restores a finalized Codex active-writer conflict from durable recovery state", () => {
  const hydrated = hydratePersistedSessions([
    session({
      adapterId: "codex",
      exitCode: 1,
      inputBlockedReason: CODEX_ACTIVE_WRITER_BLOCKED_REASON,
      promptRecovery: {
        phase: "not_sent",
        promptText: "Continue",
        requestedAt: "2026-06-22T10:00:30.000Z",
        retryable: true
      },
      sourceSessionId: "codex-source",
      status: "failed"
    })
  ]);

  const restored = hydrated.sessions[0];

  assert.equal(restored?.status, "read_only");
  assert.equal(restored?.exitCode, null);
  assert.equal(restored?.inputBlockedReason, CODEX_ACTIVE_WRITER_BLOCKED_REASON);
});

test("restores Codex sessions stopped by daemon restart as read-only shells", () => {
  const hydrated = hydratePersistedSessions([
    session({
      adapterId: "codex",
      sourceSessionId: "codex-source",
      status: "stopped",
      finishedAt: "2026-06-22T10:02:00.000Z",
      logs: [
        {
          id: "log-1",
          timestamp: "2026-06-22T10:02:00.000Z",
          stream: "system",
          text: "DeskCue daemon restarted. Session is no longer attached to a running process.\n"
        }
      ]
    })
  ]);

  assert.equal(hydrated.restoredCodexAttachedSessions, 1);
  assert.equal(hydrated.sessions[0]?.status, "read_only");
});

test("keeps completed stopped Codex sessions stopped", () => {
  const hydrated = hydratePersistedSessions([
    session({
      adapterId: "codex",
      sourceSessionId: "codex-source",
      status: "stopped",
      exitCode: 0,
      finishedAt: "2026-06-22T10:02:00.000Z"
    })
  ]);

  assert.equal(hydrated.restoredCodexAttachedSessions, 0);
  assert.equal(hydrated.sessions[0]?.status, "stopped");
});
