import assert from "node:assert/strict";
import test from "node:test";

import type { ServerEvent, SessionDetail } from "@deskcue/protocol";
import { emptyPreview, emptyReplyState } from "#sessions/model/sessionDefaults";

import { appendSessionLog } from "./sessionLogAppend.ts";
import { MAX_LOG_TEXT_LENGTH } from "./sessionLogs.ts";

function sessionDetail(): SessionDetail {
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
    actionRequest: null,
    git: {
      branch: "main",
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: true,
      lastUpdatedAt: "2026-06-22T10:01:00.000Z"
    },
    logs: [],
    inputHistory: []
  };
}

test("appends a truncated log line and emits a session log event", () => {
  const session = sessionDetail();
  const events: ServerEvent[] = [];
  let persisted = false;

  appendSessionLog(
    {
      emitServerEvent: (event) => {
        events.push(event);
      },
      getSession: () => session,
      schedulePersistState: () => {
        persisted = true;
      },
      toSummary: (updatedSession) => updatedSession,
      updateSession: (_sessionId, patch) => {
        Object.assign(session, patch);
      }
    },
    session.id,
    "stdout",
    "x".repeat(MAX_LOG_TEXT_LENGTH + 50),
    "2026-06-22T10:02:00.000Z"
  );

  assert.equal(session.logs.length, 1);
  assert.equal(session.logs[0].stream, "stdout");
  assert.equal(session.logs[0].timestamp, "2026-06-22T10:02:00.000Z");
  assert.ok(session.logs[0].text.length <= MAX_LOG_TEXT_LENGTH + 80);
  assert.equal(events[0].type, "session.log");
  assert.equal(persisted, true);
});

test("detects Codex approval prompts and emits a session update", () => {
  const session = sessionDetail();
  const events: ServerEvent[] = [];

  appendSessionLog(
    {
      emitServerEvent: (event) => {
        events.push(event);
      },
      getSession: () => session,
      schedulePersistState: () => {},
      toSummary: (updatedSession) => updatedSession,
      updateSession: (_sessionId, patch) => {
        Object.assign(session, patch);
      }
    },
    session.id,
    "stdout",
    [
      "Would you like to run the following command?",
      "",
      "Reason: Allow creating approval-check.txt?",
      "",
      "$ Set-Content -LiteralPath .\\approval-check.txt -Value 'ok' -NoNewline",
      "",
      "1. Yes, proceed (y)",
      "2. Yes, and don't ask again for commands that start with `Set-Content` (p)",
      "3. No, and tell Codex what to do differently (esc)"
    ].join("\n"),
    "2026-06-22T10:03:00.000Z"
  );

  assert.equal(session.actionRequest?.kind, "approval");
  assert.equal(
    session.actionRequest?.command,
    "Set-Content -LiteralPath .\\approval-check.txt -Value 'ok' -NoNewline"
  );
  assert.equal(session.actionRequest?.reason, "Allow creating approval-check.txt?");
  assert.equal(events[0]?.type, "session.log");
  assert.equal(events[1]?.type, "session.updated");
});

test("joins wrapped Codex approval reasons from terminal frames", () => {
  const session = sessionDetail();

  appendSessionLog(
    {
      emitServerEvent: () => {},
      getSession: () => session,
      schedulePersistState: () => {},
      toSummary: (updatedSession) => updatedSession,
      updateSession: (_sessionId, patch) => {
        Object.assign(session, patch);
      }
    },
    session.id,
    "stdout",
    [
      "Would you like to run the following command?",
      "Environment: local",
      "Reason: Allow creating approval-tooltip-portal-20260709.txt in this workspace with exactly 'approval tooltip portal",
      "  ok'?",
      "$ Set-Content -LiteralPath .\\approval-tooltip-portal-20260709.txt -Value 'approval tooltip portal ok' -NoNewline",
      "1. Yes, proceed (y)",
      "3. No, and tell Codex what to do differently (esc)"
    ].join("\n"),
    "2026-06-22T10:03:00.000Z"
  );

  assert.equal(
    session.actionRequest?.reason,
    "Allow creating approval-tooltip-portal-20260709.txt in this workspace with exactly 'approval tooltip portal ok'?"
  );
});

test("does not replace a complete Codex approval reason with a shorter terminal frame", () => {
  const session = {
    ...sessionDetail(),
    actionRequest: {
      command: "Set-Content -LiteralPath .\\approval-tooltip-portal-20260709.txt -Value 'approval tooltip portal ok' -NoNewline",
      kind: "approval" as const,
      reason:
        "Allow creating approval-tooltip-portal-20260709.txt in this workspace with exactly 'approval tooltip portal ok'?",
      requestedAt: "2026-06-22T10:03:00.000Z"
    }
  };

  appendSessionLog(
    {
      emitServerEvent: () => {},
      getSession: () => session,
      schedulePersistState: () => {},
      toSummary: (updatedSession) => updatedSession,
      updateSession: (_sessionId, patch) => {
        Object.assign(session, patch);
      }
    },
    session.id,
    "stdout",
    [
      "Would you like to run the following command?",
      "Environment: local",
      "Reason: Allow creating approval-tooltip-portal-20260709.txt in this workspace with exactly 'approval tooltip portal",
      "$ Set-Content -LiteralPath .\\approval-tooltip-portal-20260709.txt -Value 'approval tooltip portal ok' -NoNewline",
      "1. Yes, proceed (y)",
      "3. No, and tell Codex what to do differently (esc)"
    ].join("\n"),
    "2026-06-22T10:03:10.000Z"
  );

  assert.equal(
    session.actionRequest?.reason,
    "Allow creating approval-tooltip-portal-20260709.txt in this workspace with exactly 'approval tooltip portal ok'?"
  );
  assert.equal(session.actionRequest?.requestedAt, "2026-06-22T10:03:00.000Z");
});

test("clears Codex approval prompts after the decision is accepted", () => {
  const session = {
    ...sessionDetail(),
    actionRequest: {
      command: "Set-Content -LiteralPath .\\approval-check.txt -Value 'ok' -NoNewline",
      kind: "approval" as const,
      reason: "Allow creating approval-check.txt?",
      requestedAt: "2026-06-22T10:03:00.000Z"
    }
  };
  const events: ServerEvent[] = [];

  appendSessionLog(
    {
      emitServerEvent: (event) => {
        events.push(event);
      },
      getSession: () => session,
      schedulePersistState: () => {},
      toSummary: (updatedSession) => updatedSession,
      updateSession: (_sessionId, patch) => {
        Object.assign(session, patch);
      }
    },
    session.id,
    "stdout",
    "✔ You approved codex to run Set-Content -LiteralPath .\\approval-check.txt -Value 'ok' -NoNewline this time",
    "2026-06-22T10:04:00.000Z"
  );

  assert.equal(session.actionRequest, null);
  assert.equal(events[1]?.type, "session.updated");
});
