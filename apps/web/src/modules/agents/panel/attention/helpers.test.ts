import assert from "node:assert/strict";
import test from "node:test";

import type { AgentSessionSummary } from "@deskcue/protocol";

import { buildAttentionSessionGroups } from "./helpers.ts";

function session(id: string, subagent = false): AgentSessionSummary {
  return {
    agentId: "codex",
    agentLabel: "Codex",
    attachMode: "resume",
    cliVersion: null,
    filePath: `${id}.jsonl`,
    id: `codex:${id}`,
    model: null,
    originator: null,
    source: "codex",
    sourceSessionId: id,
    subagent: subagent
      ? {
          depth: 1,
          nickname: "Scout",
          parentSessionId: "codex:parent",
          role: null
        }
      : undefined,
    title: id,
    updatedAt: "2026-09-04T10:00:00.000Z",
    workspaceName: "DeskCue",
    workspacePath: "D:\\work\\DeskCue",
    workState: "running"
  };
}

test("keeps subagent activity nested unless the child needs approval", () => {
  const parent = session("parent");
  const child = session("child", true);
  const childKey = "codex:child";
  const common = {
    readyForReviewAgentSessionIds: new Set([child.id]),
    sessions: [parent, child],
    workIndicatorsBySourceSessionKey: new Map()
  };

  const ordinary = buildAttentionSessionGroups({
    ...common,
    approvalRequestedSourceSessionKeys: new Set()
  });

  assert.deepEqual(ordinary.activeAgents.map((item) => item.id), [parent.id]);
  assert.deepEqual(ordinary.newResults, []);

  const approval = buildAttentionSessionGroups({
    ...common,
    approvalRequestedSourceSessionKeys: new Set([childKey])
  });

  assert.deepEqual(approval.approvalRequests.map((item) => item.id), [child.id]);
});
