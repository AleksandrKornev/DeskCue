import assert from "node:assert/strict";
import test from "node:test";

import type { AgentSessionSummary } from "@deskcue/protocol";

import { filterAgentSessionsByHierarchy } from "./sourceAgentSessions.ts";

function session(
  id: string,
  parentSessionId?: string
): AgentSessionSummary {
  return {
    id: `codex:${id}`,
    agentId: "codex",
    agentLabel: "Codex",
    attachMode: "resume",
    cliVersion: null,
    filePath: `${id}.jsonl`,
    model: null,
    originator: null,
    source: "codex",
    sourceSessionId: id,
    subagent: parentSessionId
      ? { depth: 1, nickname: id, parentSessionId, role: null }
      : null,
    title: id,
    updatedAt: "2026-09-04T10:00:00.000Z",
    workspaceName: "DeskCue",
    workspacePath: "D:\\work\\DeskCue",
    workState: "idle"
  };
}

test("agent-session hierarchy defaults to roots and can explicitly include all sessions", () => {
  const sessions = [
    session("parent"),
    session("child", "codex:parent"),
    session("nested", "codex:child")
  ];

  assert.deepEqual(
    filterAgentSessionsByHierarchy(sessions, {}).map((item) => item.id),
    ["codex:parent"]
  );

  assert.equal(filterAgentSessionsByHierarchy(sessions, { includeSubagents: true }).length, 3);
});

test("agent-session hierarchy returns only direct children for a parent", () => {
  const sessions = [
    session("parent"),
    session("child", "codex:parent"),
    session("nested", "codex:child")
  ];

  assert.deepEqual(
    filterAgentSessionsByHierarchy(sessions, {
      includeSubagents: true,
      parentSessionId: "codex:parent"
    }).map((item) => item.id),
    ["codex:child"]
  );
});
