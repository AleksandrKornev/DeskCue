import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useDashboardRouteViewModel } from "./useDashboardRouteViewModel";

describe("useDashboardRouteViewModel session recovery", () => {
  it("keeps a missing route session focused for its recovery surface", () => {
    const { result } = renderHook(() => useDashboardRouteViewModel({
      activeTakenOverAgentSession: null,
      attachingAgentSessionId: "",
      initialManagedSessionLoadState: { kind: "missing" },
      isActiveTakenOverAgentSessionLoading: false,
      isAgentBrowserListMode: false,
      isAgentSessionLoading: false,
      isBootstrapping: false,
      isDashboardPinned: false,
      managedSessions: [],
      openingAgentSessionId: "",
      overviewSessions: [],
      routeState: {
        agentSessionId: "",
        kind: "session",
        overlay: null,
        sessionId: "route-session",
        sourceId: "all",
        tab: "overview"
      },
      selectedAgentSession: null,
      selectedAgentSessionId: "",
      selectedSession: null,
      selectedSessionId: "route-session",
      selectedSourceId: "all"
    }));

    expect(result.current.effectiveSelectedSessionId).toBe("route-session");
    expect(result.current.hasManagedFocus).toBe(true);
    expect(result.current.showBootstrapShell).toBe(false);
  });
});
