import assert from "node:assert/strict";
import test from "node:test";

import type { RouteViewState } from "@models/dashboardRoute";

import { shouldResetWindowScrollOnSessionRoute } from "./helpers";

function createRouteState(
  overrides: Partial<RouteViewState> = {}
): RouteViewState {
  return {
    agentSessionId: "",
    kind: "session",
    overlay: null,
    sessionId: "session-1",
    sourceId: "all",
    tab: "overview",
    ...overrides
  };
}

test("skips window scroll reset for live chat overview routes", () => {
  assert.equal(
    shouldResetWindowScrollOnSessionRoute(
      createRouteState({ agentSessionId: "codex:agent-1" })
    ),
    false
  );
});

test("keeps window scroll reset for non-chat session routes", () => {
  assert.equal(
    shouldResetWindowScrollOnSessionRoute(
      createRouteState({ agentSessionId: "codex:agent-1", tab: "diff" })
    ),
    true
  );
});

test("keeps window scroll reset for manual session overview routes", () => {
  assert.equal(shouldResetWindowScrollOnSessionRoute(createRouteState()), true);
});
