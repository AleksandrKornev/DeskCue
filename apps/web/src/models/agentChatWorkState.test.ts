import assert from "node:assert/strict";
import test from "node:test";

import type { AgentSessionDetail, SessionSummary } from "@deskcue/protocol";

import {
  isActiveSourceTurn,
  isManagedSessionActivelyAttached
} from "./agentChatWorkState";

function createSession(status: SessionSummary["status"]): SessionSummary {
  return {
    id: `session-${status}`,
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    adapterId: "codex",
    sourceSessionId: "source-1",
    command: "codex resume source-1",
    status,
    startedAt: "2026-08-03T16:00:00.000Z",
    finishedAt: status === "running" ? null : "2026-08-03T16:01:00.000Z",
    lastActivityAt: "2026-08-03T16:01:00.000Z",
    exitCode: null,
    preview: { active: false, networkMode: "device-direct", port: null, targetUrl: null, artifacts: [] },
    replyState: { phase: "idle", promptText: null, requestedAt: null },
    git: {
      branch: null,
      isDirty: false,
      isGitRepo: false,
      changedFiles: [],
      diff: "",
      lastUpdatedAt: "2026-08-03T16:00:00.000Z"
    }
  };
}

test("counts only a running source session as actively attached", () => {
  assert.equal(isManagedSessionActivelyAttached(createSession("running")), true);
  assert.equal(isManagedSessionActivelyAttached(createSession("stopped")), false);
  assert.equal(isManagedSessionActivelyAttached(createSession("read_only")), false);
});

test("uses terminal turn state instead of stale running work state", () => {
  assert.equal(isActiveSourceTurn({
    workState: "running",
    turnState: {
      activityAt: "2026-07-31T10:00:05.000Z",
      completedAt: "2026-07-31T10:00:05.000Z",
      evidence: "terminal_lifecycle",
      fingerprint: "turn-1",
      phase: "completed",
      startedAt: "2026-07-31T10:00:00.000Z"
    }
  } satisfies Pick<AgentSessionDetail, "turnState" | "workState">), false);
});
