import assert from "node:assert/strict";
import test from "node:test";

import type { ServerEvent, SessionSummary } from "@deskcue/protocol";

import { classifyNotificationServerEvent } from "./notificationEventClassifier.ts";

function sessionSummary(patch: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    adapterId: "codex",
    sourceSessionId: "source-1",
    command: "codex resume source-1 (read-only)",
    status: "stopped",
    startedAt: "2026-08-22T08:00:00.000Z",
    finishedAt: null,
    lastActivityAt: "2026-08-22T08:05:00.000Z",
    exitCode: null,
    preview: {
      active: false,
      networkMode: "device-direct",
      port: null,
      targetUrl: null
    },
    replyState: {
      phase: "idle",
      promptText: null,
      requestedAt: null
    },
    actionRequest: null,
    canSendInput: true,
    inputBlockedReason: null,
    git: {
      branch: "main",
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: true,
      lastUpdatedAt: "2026-08-22T08:00:00.000Z"
    },
    ...patch
  };
}

test("does not classify an input-ready resume update as completion", () => {
  const event: ServerEvent = {
    type: "session.updated",
    payload: sessionSummary()
  };

  assert.deepEqual(classifyNotificationServerEvent(event, false), []);
  assert.deepEqual(classifyNotificationServerEvent(event, true), []);
});

test("keeps a terminal stopped session eligible for the legacy webhook", () => {
  const event: ServerEvent = {
    type: "session.updated",
    payload: sessionSummary({
      finishedAt: "2026-08-22T08:06:00.000Z"
    })
  };

  const classified = classifyNotificationServerEvent(event, true);

  assert.equal(classified.length, 1);
  assert.equal(classified[0]?.event, "session.finished");
  assert.deepEqual(classified[0]?.providersOverride, ["webhook"]);
});
