import assert from "node:assert/strict";
import test from "node:test";

import type { AgentSessionSummary } from "@deskcue/protocol";

import {
  mergeSubagentSessions,
  readSubagentDisplayText,
  readSubagentStatus,
  selectDirectSubagentSessions
} from "./model.ts";

function session(
  id: string,
  parentSessionId: string,
  workState: AgentSessionSummary["workState"] = "idle"
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
    subagent: {
      depth: 1,
      nickname: id === "running" ? "Scout" : null,
      parentSessionId,
      role: id === "running" ? "functional reviewer" : null
    },
    title: `${id} task`,
    updatedAt: id === "older" ? "2026-09-04T09:00:00.000Z" : "2026-09-04T10:00:00.000Z",
    workspaceName: "DeskCue",
    workspacePath: "D:\\work\\DeskCue",
    workState
  };
}

test("selects direct children with running sessions first", () => {
  const sessions = [
    session("older", "codex:parent"),
    session("nested", "codex:child", "running"),
    session("running", "codex:parent", "running")
  ];

  assert.deepEqual(
    selectDirectSubagentSessions(sessions, "codex:parent").map((item) => item.id),
    ["codex:running", "codex:older"]
  );
});

test("merges realtime-known children over fetched snapshots", () => {
  const fetched = session("running", "codex:parent");
  const live = session("running", "codex:parent", "running");

  assert.equal(mergeSubagentSessions([fetched], [live])[0]?.workState, "running");
});

test("does not let an older known child overwrite a fresher fetched snapshot", () => {
  const fetched = {
    ...session("running", "codex:parent", "running"),
    updatedAt: "2026-09-04T10:02:00.000Z"
  };

  const staleKnown = {
    ...session("running", "codex:parent", "idle"),
    updatedAt: "2026-09-04T10:01:00.000Z"
  };

  const merged = mergeSubagentSessions([fetched], [staleKnown]);

  assert.equal(merged[0]?.workState, "running");
  assert.equal(merged[0]?.updatedAt, "2026-09-04T10:02:00.000Z");
});

test("prefers a nickname and role while retaining useful fallbacks", () => {
  assert.deepEqual(readSubagentDisplayText(session("running", "codex:parent")), {
    detail: "functional reviewer",
    label: "Scout"
  });
  assert.deepEqual(readSubagentDisplayText(session("older", "codex:parent")), {
    detail: "Codex",
    label: "older task"
  });
});

test("does not call an unobserved idle child finished", () => {
  const idle = session("older", "codex:parent");
  const completed = {
    ...idle,
    turnState: {
      activityAt: null,
      completedAt: "2026-09-04T10:00:00.000Z",
      evidence: "terminal_lifecycle" as const,
      fingerprint: "turn-1",
      phase: "completed" as const,
      startedAt: "2026-09-04T09:59:00.000Z"
    }
  };

  assert.deepEqual(readSubagentStatus(idle), { label: "Idle", tone: "idle" });
  assert.deepEqual(readSubagentStatus(completed), { label: "Finished", tone: "finished" });
});
