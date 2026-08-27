import assert from "node:assert/strict";
import test from "node:test";

import type { SessionDetail } from "@deskcue/protocol";
import { emptyPreview, emptyReplyState } from "#sessions/model/sessionDefaults";

import { toSessionSummary, withSessionInputCapability } from "./sessionProjection.ts";

function sessionDetail(patch: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    adapterId: "generic-cli",
    sourceSessionId: null,
    command: "npm test",
    status: "running",
    startedAt: "2026-06-22T10:00:00.000Z",
    finishedAt: null,
    lastActivityAt: "2026-06-22T10:01:00.000Z",
    exitCode: null,
    preview: emptyPreview(),
    replyState: emptyReplyState(),
    git: {
      branch: "main",
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: true,
      lastUpdatedAt: "2026-06-22T10:01:00.000Z"
    },
    logs: [],
    inputHistory: [],
    ...patch
  };
}

test("marks running child sessions as input-capable", () => {
  const session = sessionDetail({
    adapterId: "generic-cli",
    status: "running"
  });

  const projected = withSessionInputCapability(session, (sessionId) => sessionId === "session-1");

  assert.equal(projected.canSendInput, true);
});

test("marks stopped Codex source shells as resumable", () => {
  const session = sessionDetail({
    adapterId: "codex",
    sourceSessionId: "source-1",
    status: "stopped"
  });

  const projected = toSessionSummary(session, () => false);

  assert.equal(projected.canSendInput, true);
});

test("marks completed Codex source shells as resumable", () => {
  const session = sessionDetail({
    adapterId: "codex",
    sourceSessionId: "source-1",
    status: "done"
  });

  const projected = toSessionSummary(session, () => false);

  assert.equal(projected.canSendInput, true);
  assert.equal(projected.inputBlockedReason, null);
});

test("marks read-only Codex source shells as resumable", () => {
  const session = sessionDetail({
    adapterId: "codex",
    sourceSessionId: "source-1",
    status: "read_only"
  });

  const projected = toSessionSummary(session, () => false);

  assert.equal(projected.canSendInput, true);
  assert.equal(projected.inputBlockedReason, null);
});

test("blocks ordinary input while a source prompt outcome is unresolved", () => {
  const session = sessionDetail({
    adapterId: "codex",
    promptRecovery: {
      phase: "outcome_unknown",
      promptText: "Continue",
      requestedAt: "2026-08-25T10:00:00.000Z",
      retryable: false
    },
    sourceSessionId: "source-1",
    status: "read_only"
  });

  const projected = toSessionSummary(session, () => false);

  assert.equal(projected.canSendInput, false);
  assert.equal(projected.inputBlockedReason, "DeskCue lost control of this turn.");
});

test("keeps a definitely-not-sent prompt available to its explicit retry action", () => {
  const session = sessionDetail({
    adapterId: "codex",
    promptRecovery: {
      phase: "not_sent",
      promptText: "Continue",
      requestedAt: "2026-08-25T10:00:00.000Z",
      retryable: true
    },
    sourceSessionId: "source-1",
    status: "read_only"
  });

  const projected = toSessionSummary(session, () => false);

  assert.equal(projected.canSendInput, true);
  assert.equal(projected.inputBlockedReason, null);
});

test("keeps a Codex shell blocked after an active-writer conflict", () => {
  const session = sessionDetail({
    adapterId: "codex",
    sourceSessionId: "source-1",
    status: "read_only",
    inputBlockedReason: "Another Codex client still owns this chat."
  });

  const projected = toSessionSummary(session, () => false);

  assert.equal(projected.canSendInput, false);
  assert.equal(projected.inputBlockedReason, "Another Codex client still owns this chat.");
});

test("marks a non-observe-only Claude source shell as resumable", () => {
  const session = sessionDetail({
    adapterId: "claude-code",
    sourceSessionId: "source-1",
    command: "claude --resume source-1 (read-only)",
    status: "read_only"
  });

  const projected = toSessionSummary(session, () => false);

  assert.equal(projected.canSendInput, true);
  assert.equal(projected.inputBlockedReason, null);
});

test("keeps a failed Claude source shell resumable", () => {
  const session = sessionDetail({
    adapterId: "claude-code",
    sourceSessionId: "source-1",
    command: "claude --resume source-1 --print previous prompt",
    status: "failed",
    exitCode: 1
  });

  const projected = toSessionSummary(session, () => false);

  assert.equal(projected.canSendInput, true);
  assert.equal(projected.inputBlockedReason, null);
});

test("keeps a failed Claude shell blocked while its previous prompt outcome is unresolved", () => {
  const session = sessionDetail({
    adapterId: "claude-code",
    sourceSessionId: "source-1",
    command: "claude --resume source-1 --print previous prompt",
    status: "failed",
    exitCode: 1,
    promptRecovery: {
      phase: "outcome_unknown",
      promptText: "Previous prompt",
      requestedAt: "2026-08-27T10:00:00.000Z",
      retryable: false
    }
  });

  const projected = toSessionSummary(session, () => false);

  assert.equal(projected.canSendInput, false);
  assert.equal(projected.inputBlockedReason, "DeskCue lost control of this turn.");
});

test("keeps a failed Claude shell blocked while its reply lifecycle is still active", () => {
  const session = sessionDetail({
    adapterId: "claude-code",
    sourceSessionId: "source-1",
    command: "claude --resume source-1 --print previous prompt",
    status: "failed",
    exitCode: 1,
    replyState: {
      phase: "waiting",
      promptText: "Previous prompt",
      requestedAt: "2026-08-27T10:00:00.000Z"
    }
  });

  const projected = toSessionSummary(session, () => false);

  assert.equal(projected.canSendInput, false);
  assert.equal(projected.inputBlockedReason, "Session is already handling a prompt.");
});

test("keeps an observe-only Claude source shell blocked", () => {
  const session = sessionDetail({
    adapterId: "claude-code",
    sourceSessionId: "source-1",
    command: "claude --resume source-1 (observe-only)",
    status: "read_only"
  });

  const projected = toSessionSummary(session, () => false);

  assert.equal(projected.canSendInput, false);
  assert.match(projected.inputBlockedReason ?? "", /observed or stopped/);
});

test("does not make a failed observe-only Claude shell resumable", () => {
  const session = sessionDetail({
    adapterId: "claude-code",
    sourceSessionId: "source-1",
    command: "claude --resume source-1 (observe-only)",
    status: "failed",
    exitCode: 1
  });

  const projected = toSessionSummary(session, () => false);

  assert.equal(projected.canSendInput, false);
  assert.match(projected.inputBlockedReason ?? "", /observed or stopped/);
});

test("marks detached running Codex source shells as input-capable", () => {
  const session = sessionDetail({
    adapterId: "codex",
    sourceSessionId: "source-1",
    status: "running"
  });

  const projected = toSessionSummary(session, () => false);

  assert.equal(projected.canSendInput, true);
  assert.equal(projected.inputBlockedReason, null);
});

test("omits heavy git diff from session summaries", () => {
  const session = sessionDetail({
    git: {
      branch: "main",
      changedFiles: ["src/app.ts"],
      diff: "diff --git a/src/app.ts b/src/app.ts\n+large diff body",
      isDirty: true,
      isGitRepo: true,
      lastUpdatedAt: "2026-06-22T10:02:00.000Z"
    }
  });

  const projected = toSessionSummary(session, () => true);

  assert.equal(projected.git.diff, "");
  assert.equal(projected.git.changedFiles.length, 1);
  assert.equal(projected.git.isDirty, true);
});
