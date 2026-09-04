import assert from "node:assert/strict";
import test from "node:test";

import type { AgentSessionSummary } from "@deskcue/protocol";

import { filterAndSortAgentSessionsByQuery } from "./helpers.ts";

function session(
  id: string,
  updatedAt: string,
  subagent?: AgentSessionSummary["subagent"]
): AgentSessionSummary {
  return {
    id,
    agentId: "codex",
    agentLabel: "Codex",
    attachMode: "resume",
    cliVersion: null,
    filePath: `${id}.jsonl`,
    model: null,
    originator: null,
    source: "codex",
    sourceSessionId: id,
    subagent,
    title: id,
    updatedAt,
    workspaceName: "DeskCue",
    workspacePath: "D:\\work\\DeskCue",
    workState: "idle"
  };
}

test("keeps subagent sessions out of the unfiltered Recent work list", () => {
  const sessions = [
    session("child", "2026-09-04T10:01:00.000Z", {
      depth: 1,
      nickname: "Scout",
      parentSessionId: "codex:parent",
      role: null
    }),
    session("parent", "2026-09-04T10:00:00.000Z")
  ];

  assert.deepEqual(
    filterAndSortAgentSessionsByQuery(sessions, "").map((item) => item.id),
    ["parent"]
  );
});

test("lets explicit search find a subagent session", () => {
  const sessions = [
    session("child", "2026-09-04T10:01:00.000Z", {
      depth: 1,
      nickname: "Scout",
      parentSessionId: "codex:parent",
      role: null
    }),
    session("parent", "2026-09-04T10:00:00.000Z")
  ];

  assert.deepEqual(
    filterAndSortAgentSessionsByQuery(sessions, "Scout").map((item) => item.id),
    ["child"]
  );
});
