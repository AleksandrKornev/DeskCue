import assert from "node:assert/strict";
import test from "node:test";

import { buildReadOnlyClaudeSessionShell } from "./claudeReadOnlySession.ts";

test("builds an observe-only Claude shell without a managed terminal", () => {
  const session = buildReadOnlyClaudeSessionShell({
    agentSession: {
      id: "claude-code:source-session",
      agentId: "claude-code",
      agentLabel: "Claude Code",
      sourceSessionId: "source-session",
      title: "Claude chat",
      workspacePath: "D:\\workspace",
      workspaceName: "workspace",
      updatedAt: "2026-07-30T10:00:00.000Z",
      model: null,
      originator: null,
      cliVersion: null,
      source: "claude.projects",
      filePath: "D:\\claude.jsonl",
      attachMode: "resume",
      workState: "running"
    },
    git: {
      branch: null,
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: false,
      lastUpdatedAt: "2026-07-30T10:00:00.000Z"
    },
    now: "2026-07-30T10:00:00.000Z",
    observeOnly: true,
    workspace: {
      id: "workspace-1",
      name: "workspace",
      path: "D:\\workspace",
      isGitRepo: false,
      branch: null,
      createdAt: "2026-07-30T10:00:00.000Z"
    }
  });

  assert.equal(session.status, "read_only");
  assert.match(session.command, /observe-only/);
  assert.equal(session.sourceSessionId, "source-session");
});
