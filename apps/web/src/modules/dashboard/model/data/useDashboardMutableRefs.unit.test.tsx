import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { UseDashboardMutableRefsArgs } from "./types";
import { useDashboardMutableRefs } from "./useDashboardMutableRefs";

function createArgs(selectedSessionId = "session-a"): UseDashboardMutableRefsArgs {
  return {
    activeTab: "overview",
    agentSessions: [],
    overview: {
      clientContext: { canOpenNativeDialogs: false },
      sessions: [],
      workspaces: []
    },
    runtimes: [],
    selectedAgentSession: null,
    selectedAgentSessionId: "",
    selectedSession: null,
    selectedSessionId
  };
}

describe("useDashboardMutableRefs", () => {
  it("advances the selection epoch when a committed selection changes externally", () => {
    const { result, rerender } = renderHook(
      ({ args }: { args: UseDashboardMutableRefsArgs }) => useDashboardMutableRefs(args),
      { initialProps: { args: createArgs() } }
    );

    rerender({ args: createArgs("session-b") });

    expect(result.current.selectedSessionIdRef.current).toBe("session-b");
    expect(result.current.selectedSessionSelectionEpochRef.current).toBe(1);
  });

  it("keeps a request epoch when selection was synchronized before the request started", () => {
    const { result, rerender } = renderHook(
      ({ args }: { args: UseDashboardMutableRefsArgs }) => useDashboardMutableRefs(args),
      { initialProps: { args: createArgs() } }
    );

    result.current.selectedSessionIdRef.current = "session-b";
    rerender({ args: createArgs("session-b") });

    expect(result.current.selectedSessionIdRef.current).toBe("session-b");
    expect(result.current.selectedSessionSelectionEpochRef.current).toBe(0);
  });
});
