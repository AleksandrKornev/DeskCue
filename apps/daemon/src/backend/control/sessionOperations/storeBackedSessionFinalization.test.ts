import assert from "node:assert/strict";
import test from "node:test";

import type { SessionDetail } from "@deskcue/protocol";
import { emptyPreview } from "#sessions/model/sessionDefaults";

import { finishStoreBackedSession } from "./storeBackedSessionFinalization.ts";

const requestedAt = "2026-08-23T13:23:21.883Z";

function activeWriterConflictSession(): SessionDetail {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    workspaceName: "DeskCueWorkspace",
    adapterId: "codex",
    sourceSessionId: "source-1",
    command: "codex exec resume source-1",
    status: "running",
    startedAt: requestedAt,
    finishedAt: null,
    lastActivityAt: requestedAt,
    exitCode: null,
    preview: emptyPreview(),
    replyState: {
      phase: "sending",
      promptText: "Continue",
      requestedAt
    },
    git: {
      branch: "main",
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: true,
      lastUpdatedAt: requestedAt
    },
    logs: [{
      id: "log-1",
      timestamp: requestedAt,
      stream: "stderr",
      text: "thread-store conflict: thread source-1 already has an active writer"
    }],
    inputHistory: ["Continue"]
  };
}

test("settles an active-writer conflict as retryable read-only instead of task failed", () => {
  let session = activeWriterConflictSession();
  const lifecycle: string[] = [];
  const context = {
    appendLog: (_sessionId: string, _stream: string, text: string) => lifecycle.push(text),
    emitServerEvent: () => lifecycle.push("event"),
    getSession: () => session,
    gitPolling: { stop: () => lifecycle.push("git-stop") },
    persistState: async () => {},
    repository: {
      getSession: () => session,
      getWorkspace: () => null
    },
    sessionRunner: {
      deleteChild: () => true,
      getChild: () => undefined,
      isCurrentChild: () => false,
      killChild: async () => {},
      spawnProcess: () => {
        throw new Error("unexpected spawn");
      }
    },
    toSummary: () => session,
    updateSession: (_sessionId: string, patch: Partial<SessionDetail>) => {
      session = { ...session, ...patch };
    }
  } as never;
  const promptTransport = {
    recordSessionFinished: (
      _sessionId: string,
      _session: SessionDetail,
      status: string,
      exitCode: number | null
    ) => lifecycle.push(`record:${status}:${exitCode}`)
  } as never;
  const sourceTurnInterrupts = {
    confirmManagedTransportExit: () => lifecycle.push("confirm")
  } as never;

  finishStoreBackedSession(
    context,
    promptTransport,
    sourceTurnInterrupts,
    session.id,
    "failed",
    1
  );

  assert.equal(session.status, "read_only");
  assert.equal(session.exitCode, null);
  assert.equal(session.replyState.phase, "idle");
  assert.equal(session.promptRecovery?.phase, "not_sent");
  assert.equal(session.promptRecovery?.retryable, true);
  assert.match(session.inputBlockedReason ?? "", /Another Codex client still owns/);
  assert.ok(lifecycle.includes("record:read_only:null"));
  assert.ok(lifecycle.some((entry) => entry.includes("prompt was not sent")));
});

test("does not expose a user interrupt as a failed process exit", () => {
  let session = activeWriterConflictSession();

  session.logs = [];
  const context = {
    appendLog: () => {},
    emitServerEvent: () => {},
    getSession: () => session,
    gitPolling: { stop: () => {} },
    persistState: async () => {},
    repository: { getSession: () => session, getWorkspace: () => null },
    sessionRunner: {
      deleteChild: () => true,
      getChild: () => undefined,
      isCurrentChild: () => false,
      killChild: async () => {},
      spawnProcess: () => {
        throw new Error("unexpected spawn");
      }
    },
    toSummary: () => session,
    updateSession: (_sessionId: string, patch: Partial<SessionDetail>) => {
      session = { ...session, ...patch };
    }
  } as never;

  finishStoreBackedSession(
    context,
    { recordSessionFinished: () => {} } as never,
    { confirmManagedTransportExit: () => {} } as never,
    session.id,
    "stopped",
    1
  );

  assert.equal(session.status, "stopped");
  assert.equal(session.exitCode, null);
  assert.equal(session.replyState.phase, "idle");
});
