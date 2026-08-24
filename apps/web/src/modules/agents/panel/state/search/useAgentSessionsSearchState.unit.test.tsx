import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearAgentBrowserQuery } from "@modules/agents/panel/state/agentBrowserListMemory";

import { useAgentSessionsSearchState } from "./useAgentSessionsSearchState";

describe("useAgentSessionsSearchState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearAgentBrowserQuery();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a server-side search scoped to the selected provider", async () => {
    const onSearchAgentSessions = vi.fn().mockResolvedValue([]);
    const onReloadAgentSessions = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useAgentSessionsSearchState({
      agentSessionsQuery: null,
      onReloadAgentSessions,
      onSearchAgentSessions,
      onSelectSource: vi.fn(),
      selectedSourceId: "claude-code"
    }));

    act(() => {
      result.current.setQuery("architecture");
    });
    await act(async () => {
      vi.advanceTimersByTime(360);
      await Promise.resolve();
    });

    expect(onSearchAgentSessions).toHaveBeenCalledWith("architecture", {
      silent: true,
      sourceId: "claude-code"
    });
  });

  it("reruns the same query when its provider scope changes", async () => {
    const onSearchAgentSessions = vi.fn().mockResolvedValue([]);
    const onReloadAgentSessions = vi.fn().mockResolvedValue([]);
    const initialProps: { selectedSourceId: "all" | "claude-code" } = {
      selectedSourceId: "all"
    };

    const { result, rerender } = renderHook(
      ({ selectedSourceId }: { selectedSourceId: "all" | "claude-code" }) =>
        useAgentSessionsSearchState({
          agentSessionsQuery: "architecture",
          onReloadAgentSessions,
          onSearchAgentSessions,
          onSelectSource: vi.fn(),
          selectedSourceId
        }),
      { initialProps }
    );

    act(() => {
      result.current.setQuery("architecture");
    });
    await act(async () => {
      vi.advanceTimersByTime(360);
      await Promise.resolve();
    });

    rerender({ selectedSourceId: "claude-code" });
    await act(async () => {
      vi.advanceTimersByTime(360);
      await Promise.resolve();
    });

    expect(onSearchAgentSessions).toHaveBeenLastCalledWith("architecture", {
      silent: true,
      sourceId: "claude-code"
    });

    expect(onSearchAgentSessions).toHaveBeenCalledTimes(2);
  });

  it("restores the query after leaving and returning to the chat browser", () => {
    const props = {
      agentSessionsQuery: null,
      onReloadAgentSessions: vi.fn().mockResolvedValue([]),
      onSearchAgentSessions: vi.fn().mockResolvedValue([]),
      onSelectSource: vi.fn(),
      selectedSourceId: "all" as const
    };

    const first = renderHook(() => useAgentSessionsSearchState(props));

    act(() => first.result.current.setQuery("01a02465"));
    first.unmount();

    const second = renderHook(() => useAgentSessionsSearchState(props));

    expect(second.result.current.query).toBe("01a02465");
  });
});
