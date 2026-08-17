import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAgentSessionsSearchState } from "./useAgentSessionsSearchState";

describe("useAgentSessionsSearchState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
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
});
