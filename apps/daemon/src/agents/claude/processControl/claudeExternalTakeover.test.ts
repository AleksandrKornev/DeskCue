import assert from "node:assert/strict";
import test from "node:test";

import { canTakeOverStoppedExternalClaudeSession } from "./claudeExternalTakeover.ts";

test("allows DeskCue takeover only after external Claude controls are both clear", async () => {
  const allowed = await canTakeOverStoppedExternalClaudeSession("source-1", {
    getProcessCapability: async () => ({
      kind: "unavailable",
      reason: "no_exact_session_process"
    }),
    getBackgroundControl: async (sourceSessionId) => ({
      kind: "observe_only",
      reason: "session_not_listed",
      sourceSessionId
    })
  });

  assert.equal(allowed, true);
});

test("keeps the chat observe-only while Claude still reports an interactive session", async () => {
  const allowed = await canTakeOverStoppedExternalClaudeSession("source-1", {
    getProcessCapability: async () => ({
      kind: "unavailable",
      reason: "no_exact_session_process"
    }),
    getBackgroundControl: async (sourceSessionId) => ({
      kind: "observe_only",
      reason: "interactive_session",
      sourceSessionId
    })
  });

  assert.equal(allowed, false);
});
