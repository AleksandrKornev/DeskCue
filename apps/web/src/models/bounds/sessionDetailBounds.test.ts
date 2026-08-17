import assert from "node:assert/strict";
import test from "node:test";

import type { SessionDetail, SessionLogLine } from "@deskcue/protocol";

import {
  boundLiveSessionDetail,
  trimSessionDetailForCache
} from "./sessionDetailBounds";

function createLog(index: number): SessionLogLine {
  return {
    id: `log-${index}`,
    stream: "stdout",
    text: `line ${index}`,
    timestamp: new Date(index * 1_000).toISOString()
  };
}

function createDetail(logs: SessionLogLine[]): SessionDetail {
  return {
    adapterId: "codex",
    canSendInput: true,
    command: "codex",
    exitCode: null,
    finishedAt: null,
    git: {
      branch: null,
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: false,
      lastUpdatedAt: "2026-08-06T10:00:00.000Z"
    },
    id: "session-1",
    inputBlockedReason: null,
    inputHistory: [],
    lastActivityAt: "2026-08-06T10:00:00.000Z",
    logs,
    preview: { active: false, artifacts: [], networkMode: "device-direct", port: null, targetUrl: null },
    replyState: { phase: "idle", promptText: null, requestedAt: null },
    sourceSessionId: null,
    startedAt: "2026-08-06T10:00:00.000Z",
    status: "running",
    workspaceId: "workspace-1",
    workspaceName: "Workspace"
  };
}

test("bounds live managed logs by count while retaining the newest records", () => {
  const detail = createDetail(Array.from({ length: 2_200 }, (_, index) => createLog(index)));
  const bounded = boundLiveSessionDetail(detail);

  assert.equal(bounded.logs.length, 2_000);
  assert.equal(bounded.logs[0]?.id, "log-200");
  assert.equal(bounded.logs.at(-1)?.id, "log-2199");
});

test("stores only a small managed-session tail in the dashboard cache", () => {
  const detail = createDetail(Array.from({ length: 500 }, (_, index) => createLog(index)));
  detail.inputHistory = Array.from({ length: 100 }, (_, index) => `prompt-${index}`);
  const cached = trimSessionDetailForCache(detail);

  assert.equal(cached.logs.length, 160);
  assert.equal(cached.logs.at(-1)?.id, "log-499");
  assert.equal(cached.inputHistory.length, 32);
  assert.equal(cached.inputHistory.at(-1), "prompt-99");
});
