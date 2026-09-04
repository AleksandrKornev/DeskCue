import assert from "node:assert/strict";
import test from "node:test";

import { formatAgentSessionTitle } from "./sessionDisplay.ts";

test("uses a subagent nickname as the stable chat identity", () => {
  assert.equal(
    formatAgentSessionTitle({
      subagent: {
        depth: 1,
        nickname: "Copernicus",
        parentSessionId: "codex:parent",
        role: "visual reviewer"
      },
      title: "Codex session 01a06be0"
    }),
    "Copernicus"
  );
});

test("falls back to the native session title", () => {
  assert.equal(
    formatAgentSessionTitle({ subagent: null, title: "Release audit" }),
    "Release audit"
  );
});
