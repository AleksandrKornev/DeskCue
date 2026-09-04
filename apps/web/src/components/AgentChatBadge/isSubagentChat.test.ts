import assert from "node:assert/strict";
import test from "node:test";

import { isSubagentChat } from "./isSubagentChat.ts";

test("marks only source chats spawned as subagents", () => {
  assert.equal(isSubagentChat({ source: "vscode" }), false);
  assert.equal(isSubagentChat({ source: null }), false);
  assert.equal(isSubagentChat({
    source: {
      subagent: {
        thread_spawn: {
          parent_thread_id: "parent-thread"
        }
      }
    }
  }), true);
  assert.equal(isSubagentChat({
    subagent: {
      parentSessionId: "codex:parent-thread"
    }
  }), true);
});
