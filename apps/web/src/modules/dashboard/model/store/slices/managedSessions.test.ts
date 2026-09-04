import assert from "node:assert/strict";
import test from "node:test";

import type { SessionSummary } from "@deskcue/protocol";

import { selectManagedSessions } from "./managedSessions.ts";

function session(id: string, adapterId: string): SessionSummary {
  return {
    actionRequest: null,
    adapterId,
    canSendInput: true,
    command: "agent",
    exitCode: null,
    finishedAt: null,
    git: {
      branch: null,
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: false,
      lastUpdatedAt: "2026-09-04T10:00:00.000Z"
    },
    id,
    inputBlockedReason: null,
    lastActivityAt: "2026-09-04T10:00:00.000Z",
    preview: {
      active: false,
      artifacts: [],
      networkMode: "device-direct",
      port: null,
      targetUrl: null
    },
    replyState: {
      phase: "idle",
      promptText: null,
      requestedAt: null
    },
    sourceSessionId: "shared-source-id",
    startedAt: "2026-09-04T09:00:00.000Z",
    status: "running",
    viewerCount: 0,
    workspaceId: "workspace",
    workspaceName: "DeskCue"
  };
}

test("keeps managed sessions with provider-scoped source identities distinct", () => {
  const sessions = selectManagedSessions([
    session("codex-managed", "codex"),
    session("claude-managed", "claude-code")
  ], "");

  assert.deepEqual(sessions.map((item) => item.id), ["codex-managed", "claude-managed"]);
});
