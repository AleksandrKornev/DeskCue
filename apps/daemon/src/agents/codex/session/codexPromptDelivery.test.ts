import assert from "node:assert/strict";
import test from "node:test";

import { settleCodexSessionAfterReplacementSpawnFailure } from "./codexPromptDelivery.ts";

test("settles a retired Codex session as read-only after replacement spawn fails", async () => {
  const events: string[] = [];
  const patches: Array<Record<string, unknown>> = [];
  const failedAt = "2026-08-21T00:00:00.000Z";

  await settleCodexSessionAfterReplacementSpawnFailure({
    stopGitPolling: (sessionId) => {
      assert.equal(sessionId, "session-1");
      events.push("stop-polling");
    },
    updateSession: (sessionId, patch) => {
      assert.equal(sessionId, "session-1");
      patches.push(patch);
      events.push("update");
    }
  }, {
    id: "session-1"
  } as never, failedAt);

  assert.deepEqual(events, ["stop-polling", "update"]);
  assert.deepEqual(patches, [{
    status: "read_only",
    finishedAt: failedAt,
    exitCode: null,
    replyState: {
      phase: "idle",
      promptText: null,
      requestedAt: null
    },
    actionRequest: null,
    promptRecovery: null
  }]);
});
