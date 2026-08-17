import assert from "node:assert/strict";
import test from "node:test";

import { buildReadOnlySourceAgentSessionShell } from "./sourceAgentSessionShell.ts";

const NOW = "2026-08-12T10:00:00.000Z";

test("builds a read-only source shell while preserving provider source fields", () => {
  const session = buildReadOnlySourceAgentSessionShell({
    adapterId: "test-source-agent",
    command: "test-agent resume source-session (read-only)",
    git: {
      branch: "main",
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: true,
      lastUpdatedAt: NOW
    },
    now: NOW,
    sourceSessionFilePath: "D:\\agent\\source-session.jsonl",
    sourceSessionId: "source-session",
    workspace: {
      id: "workspace-1",
      name: "Workspace",
      path: "D:\\workspace",
      isGitRepo: true,
      branch: "main",
      createdAt: NOW
    }
  });

  assert.equal(session.adapterId, "test-source-agent");
  assert.equal(session.sourceSessionFilePath, "D:\\agent\\source-session.jsonl");
  assert.equal(session.sourceSessionId, "source-session");
  assert.equal(session.status, "read_only");
  assert.equal(session.startedAt, NOW);
  assert.equal(session.finishedAt, NOW);
  assert.deepEqual(session.logs, []);
  assert.deepEqual(session.inputHistory, []);
});
