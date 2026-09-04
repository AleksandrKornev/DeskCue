import assert from "node:assert/strict";
import test from "node:test";

import {
  isDirectSubagentOf,
  isTopLevelAgentSession,
  readSpawnedSubagent
} from "./sourceAgentSubagents.ts";

test("projects Codex thread-spawn metadata into a bounded provider-neutral relation", () => {
  const subagent = readSpawnedSubagent("codex", {
    subagent: {
      thread_spawn: {
        agent_nickname: "Scout",
        agent_path: "root/scout",
        agent_role: "functional reviewer",
        depth: 2,
        parent_thread_id: "parent-thread"
      }
    }
  });

  assert.deepEqual(subagent, {
    depth: 2,
    nickname: "Scout",
    parentSessionId: "codex:parent-thread",
    role: "functional reviewer"
  });
});

test("rejects incomplete provider metadata and ignores unrelated subagent shapes", () => {
  assert.equal(readSpawnedSubagent("codex", null), null);
  assert.equal(readSpawnedSubagent("codex", { subagent: { other: true } }), null);
  assert.equal(readSpawnedSubagent("codex", {
    subagent: { thread_spawn: { agent_nickname: "Scout" } }
  }), null);
});

test("matches direct children without treating nested or root sessions as siblings", () => {
  const child = {
    subagent: {
      depth: 1,
      nickname: null,
      parentSessionId: "codex:parent",
      role: null
    }
  };

  assert.equal(isTopLevelAgentSession(child), false);
  assert.equal(isDirectSubagentOf(child, "codex:parent"), true);
  assert.equal(isDirectSubagentOf(child, "codex:another-parent"), false);
  assert.equal(isTopLevelAgentSession({}), true);
});
