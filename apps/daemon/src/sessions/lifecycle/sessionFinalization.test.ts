import assert from "node:assert/strict";
import test from "node:test";

import type { ServerEvent, SessionDetail } from "@deskcue/protocol";
import { emptyPreview, emptyReplyState } from "#sessions/model/sessionDefaults";

import { detachAttachedSession, finalizeSession } from "./sessionFinalization.ts";

function session(): SessionDetail {
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
    replyState: {
      phase: "sending",
      promptText: "go",
      requestedAt: "2026-06-22T10:00:00.000Z"
    },
    git: {
      branch: null,
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: false,
      lastUpdatedAt: "2026-06-22T10:00:00.000Z"
    },
    logs: [],
    inputHistory: []
  };
}

test("finalizes session through callback boundary", () => {
  let current = session();
  let deleted = false;
  let persisted = false;
  let stoppedPolling = false;
  const events: ServerEvent[] = [];

  finalizeSession(
    {
      deleteChild: () => {
        deleted = true;
      },
      emitServerEvent: (event) => {
        events.push(event);
      },
      getChild: () => undefined,
      getSession: () => current,
      killChild: async () => {},
      onAppendSystemLog: () => {},
      persistState: async () => {
        persisted = true;
      },
      stopGitPolling: () => {
        stoppedPolling = true;
      },
      toSummary: (value) => value,
      updateSession: (_sessionId, patch) => {
        current = {
          ...current,
          ...patch
        };
      }
    },
    "session-1",
    "done",
    0
  );

  assert.equal(deleted, true);
  assert.equal(persisted, true);
  assert.equal(stoppedPolling, true);
  assert.equal(current.status, "done");
  assert.deepEqual(current.replyState, emptyReplyState());
  assert.equal(events[0]?.type, "session.updated");
});

test("keeps the reply watcher alive after a successful Claude one-shot transport", () => {
  let current = session();
  current.adapterId = "claude-code";
  current.sourceSessionId = "claude-source";
  current.command = "claude --resume claude-source --print go";

  finalizeSession(
    {
      deleteChild: () => {},
      emitServerEvent: () => {},
      getChild: () => undefined,
      getSession: () => current,
      killChild: async () => {},
      onAppendSystemLog: () => {},
      persistState: async () => {},
      stopGitPolling: () => {},
      toSummary: (value) => value,
      updateSession: (_sessionId, patch) => {
        current = {
          ...current,
          ...patch
        };
      }
    },
    "session-1",
    "read_only",
    0
  );

  assert.equal(current.status, "read_only");
  assert.deepEqual(current.replyState, {
    phase: "waiting",
    promptText: "go",
    requestedAt: "2026-06-22T10:00:00.000Z"
  });
});

test("does not detach or release ownership when process termination is unconfirmed", async () => {
  const current = session();
  let deleted = false;
  let stoppedPolling = false;
  let persisted = false;

  await assert.rejects(
    detachAttachedSession(
      {
        deleteChild: () => {
          deleted = true;
        },
        emitServerEvent: () => {},
        getChild: () => ({ pid: 42 } as never),
        getSession: () => current,
        killChild: async () => {
          throw new Error("unconfirmed termination");
        },
        onAppendSystemLog: () => {},
        persistState: async () => {
          persisted = true;
        },
        stopGitPolling: () => {
          stoppedPolling = true;
        },
        toSummary: (value) => value,
        updateSession: () => {}
      },
      current.id,
      { reason: "source moved" }
    ),
    /unconfirmed termination/
  );

  assert.equal(deleted, false);
  assert.equal(stoppedPolling, false);
  assert.equal(persisted, false);
  assert.equal(current.status, "running");
});
