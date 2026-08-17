import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveNavigateAgentSessionId } from "@modules/dashboard/shell/route/helpers";

import { resolveAgentRouteSyncActions } from "./helpers";

describe("dashboard route agent sync", () => {
  it("syncs an explicit route agent even when a managed session is stopped", () => {
    assert.deepEqual(
      resolveAgentRouteSyncActions({
        hasImplicitManagedAgentSessionSelection: false,
        isRouteSessionKnownStopped: true,
        pendingAgentRouteSelection: "",
        routeAgentSessionId: "codex:target",
        selectedAgentSessionId: "codex:stale"
      }),
      [{ kind: "set-selected-agent", value: "codex:target" }]
    );
  });

  it("keeps stopped managed session routes without an agent from clearing stale selection", () => {
    assert.deepEqual(
      resolveAgentRouteSyncActions({
        hasImplicitManagedAgentSessionSelection: false,
        isRouteSessionKnownStopped: true,
        pendingAgentRouteSelection: "",
        routeAgentSessionId: "",
        selectedAgentSessionId: "codex:stale"
      }),
      []
    );
  });

  it("does not override implicit managed session agent selection", () => {
    assert.deepEqual(
      resolveAgentRouteSyncActions({
        hasImplicitManagedAgentSessionSelection: true,
        isRouteSessionKnownStopped: false,
        pendingAgentRouteSelection: "",
        routeAgentSessionId: "codex:target",
        selectedAgentSessionId: "codex:stale"
      }),
      []
    );
  });

  it("clears matching pending agent selection and syncs selected agent", () => {
    assert.deepEqual(
      resolveAgentRouteSyncActions({
        hasImplicitManagedAgentSessionSelection: false,
        isRouteSessionKnownStopped: false,
        pendingAgentRouteSelection: "codex:target",
        routeAgentSessionId: "codex:target",
        selectedAgentSessionId: "codex:stale"
      }),
      [
        { kind: "clear-pending-agent" },
        { kind: "set-selected-agent", value: "codex:target" }
      ]
    );
  });

  it("waits when selected agent is already the pending route selection", () => {
    assert.deepEqual(
      resolveAgentRouteSyncActions({
        hasImplicitManagedAgentSessionSelection: false,
        isRouteSessionKnownStopped: false,
        pendingAgentRouteSelection: "codex:target",
        routeAgentSessionId: "codex:previous",
        selectedAgentSessionId: "codex:target"
      }),
      []
    );
  });

  it("falls back to current route agent when pending route selection went stale", () => {
    assert.deepEqual(
      resolveAgentRouteSyncActions({
        hasImplicitManagedAgentSessionSelection: false,
        isRouteSessionKnownStopped: false,
        pendingAgentRouteSelection: "codex:old-pending",
        routeAgentSessionId: "codex:route",
        selectedAgentSessionId: "codex:selected"
      }),
      [
        { kind: "clear-pending-agent" },
        { kind: "set-selected-agent", value: "codex:route" }
      ]
    );
  });
});

describe("dashboard route navigation", () => {
  it("prefers the current route agent over stale selected agent fallback", () => {
    assert.equal(
      resolveNavigateAgentSessionId({
        routeAgentSessionId: "codex:route",
        selectedAgentSessionId: "codex:stale"
      }),
      "codex:route"
    );
  });

  it("lets explicit next state clear the agent query", () => {
    assert.equal(
      resolveNavigateAgentSessionId({
        nextAgentSessionId: "",
        routeAgentSessionId: "codex:route",
        selectedAgentSessionId: "codex:stale"
      }),
      ""
    );
  });

  it("falls back to selected agent when the route has no agent", () => {
    assert.equal(
      resolveNavigateAgentSessionId({
        routeAgentSessionId: "",
        selectedAgentSessionId: "codex:selected"
      }),
      "codex:selected"
    );
  });
});
