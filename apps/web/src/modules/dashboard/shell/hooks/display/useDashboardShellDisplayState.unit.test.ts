import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { InitialManagedSessionLoadState } from "@modules/dashboard/model/data";

import { useDashboardShellDisplayState } from "./useDashboardShellDisplayState";

vi.mock("@runtime", () => ({
  getDeskCueRuntime: () => ({
    readAppPath: (pathname: string) => pathname
  })
}));

function readDisplayState(initialManagedSessionLoadState: InitialManagedSessionLoadState) {
  const { result } = renderHook(() => useDashboardShellDisplayState({
      activeTab: "overview",
      effectiveSelectedAgentSessionId: "",
      effectiveSelectedSessionId: "session-1",
      hasManagedFocus: true,
      initialManagedSessionLoadState,
      isAgentSessionLoading: false,
      isBootstrapping: false,
      isCompactViewport: true,
      isExitingToDashboard: false,
      isTakenOverAgentSessionLoading: false,
      routeState: {
        agentSessionId: "",
        kind: "session",
        overlay: null,
        sessionId: "session-1",
        sourceId: "all",
        tab: "overview"
      },
      selectedAgentSession: null,
      selectedSession: null,
      showBootstrapShell: true,
      takenOverAgentSessionForPanel: null
    }));

  return result.current;
}

describe("dashboard session recovery display state", () => {
  it.each([
    { kind: "error", message: "Safe recovery message" },
    { kind: "missing" },
    { kind: "retrying", message: "Safe recovery message" }
  ] satisfies InitialManagedSessionLoadState[])(
    "keeps the recovery surface visible for $kind",
    (loadState) => {
      expect(readDisplayState(loadState).shouldShowBootstrapShell).toBe(false);
    }
  );

  it("keeps the hydration shell for the initial loading state", () => {
    expect(readDisplayState({ kind: "loading" }).shouldShowBootstrapShell).toBe(true);
  });
});
