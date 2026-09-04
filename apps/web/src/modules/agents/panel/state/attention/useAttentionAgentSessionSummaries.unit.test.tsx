import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AgentKind,
  AgentSessionsResponse,
  AgentSessionSummary
} from "@deskcue/protocol";
import { CONNECTION_CONFIG_CHANGED_EVENT } from "@api/connection/events";
import {
  AGENT_SESSIONS_INVALIDATED_EVENT,
  AGENT_SESSION_SUMMARY_UPDATED_EVENT
} from "@models/agentSessions/contracts";

const apiMocks = vi.hoisted(() => ({
  getList: vi.fn<(options: {
    includeLiveMetadata: boolean;
    limit: number;
    signal: AbortSignal;
    sourceId: AgentKind | "all";
  }) => Promise<AgentSessionsResponse>>()
}));

vi.mock("@api/endpoint/agentSessions/endpoints", () => ({
  agentSessionsApi: { getList: apiMocks.getList }
}));

import { useAttentionAgentSessionSummaries } from "./useAttentionAgentSessionSummaries";

function createSession(id: string, updatedAt: string) {
  return { id, updatedAt } as AgentSessionSummary;
}

describe("useAttentionAgentSessionSummaries", () => {
  beforeEach(() => {
    apiMocks.getList.mockReset();
  });

  it("loads the bounded source-scoped live-metadata page and preserves its completeness", async () => {
    const session = { id: "session-1" } as AgentSessionSummary;

    apiMocks.getList.mockResolvedValue({
      hasMore: true,
      sessions: [session]
    } as AgentSessionsResponse);

    const { result } = renderHook(() =>
      useAttentionAgentSessionSummaries(true, "claude-code")
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(apiMocks.getList).toHaveBeenCalledTimes(1);
    const options = apiMocks.getList.mock.calls[0]?.[0];

    expect(options?.includeLiveMetadata).toBe(true);

    expect(options?.limit).toBe(16);
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options?.sourceId).toBe("claude-code");
    expect(result.current).toEqual({ hasLoaded: true, hasMore: true, sessions: [session] });
  });

  it("does not load or subscribe while the mobile attention rail is disabled", async () => {
    apiMocks.getList.mockResolvedValue({ sessions: [] } as unknown as AgentSessionsResponse);
    const { rerender } = renderHook(
      ({ enabled }) => useAttentionAgentSessionSummaries(enabled),
      { initialProps: { enabled: false } }
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(apiMocks.getList).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await act(async () => {
      await Promise.resolve();
    });

    expect(apiMocks.getList).toHaveBeenCalledTimes(1);
  });

  it("aborts its request when the panel unmounts", () => {
    apiMocks.getList.mockReturnValue(new Promise<AgentSessionsResponse>(() => {}));
    const { unmount } = renderHook(() => useAttentionAgentSessionSummaries());
    const options = apiMocks.getList.mock.calls[0]?.[0];

    expect(options?.signal.aborted).toBe(false);
    unmount();
    expect(options?.signal.aborted).toBe(true);
  });

  it("rehydrates the unfiltered attention page after a live invalidation", async () => {
    vi.useFakeTimers();

    try {
      const first = { id: "session-1" } as AgentSessionSummary;
      const updated = { id: "session-2" } as AgentSessionSummary;

      apiMocks.getList
        .mockResolvedValueOnce({ sessions: [first] } as AgentSessionsResponse)
        .mockResolvedValueOnce({ sessions: [updated] } as AgentSessionsResponse);

      const { result } = renderHook(() => useAttentionAgentSessionSummaries());

      await act(async () => {
        await Promise.resolve();
      });
      act(() => {
        window.dispatchEvent(new Event(AGENT_SESSIONS_INVALIDATED_EVENT));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });

      expect(apiMocks.getList).toHaveBeenCalledTimes(2);
      expect(result.current).toEqual({ hasLoaded: true, hasMore: false, sessions: [updated] });
    } finally {
      vi.useRealTimers();
    }
  });

  it("merges a live summary burst without refetching the bounded page", async () => {
    const first = createSession("session-1", "2026-08-06T10:00:00.000Z");

    apiMocks.getList.mockResolvedValue({ sessions: [first] } as AgentSessionsResponse);

    const { result } = renderHook(() => useAttentionAgentSessionSummaries());

    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      for (let index = 1; index <= 20; index += 1) {
        window.dispatchEvent(new CustomEvent(AGENT_SESSION_SUMMARY_UPDATED_EVENT, {
          detail: {
            session: createSession(
              "session-2",
              `2026-08-06T10:00:${String(index).padStart(2, "0")}.000Z`
            )
          }
        }));
      }
    });

    expect(apiMocks.getList).toHaveBeenCalledTimes(1);
    expect(result.current.sessions.map((session) => session.id)).toEqual([
      "session-2",
      "session-1"
    ]);
    expect(result.current.sessions[0]?.updatedAt).toBe("2026-08-06T10:00:20.000Z");
  });

  it("marks the collection partial when a new live session overflows a full exact page", async () => {
    const pageSessions = Array.from({ length: 16 }, (_, index) => createSession(
      `session-${index}`,
      `2026-08-06T10:00:${String(index).padStart(2, "0")}.000Z`
    ));
    const liveSession = createSession("session-live", "2026-08-06T10:01:00.000Z");

    apiMocks.getList.mockResolvedValue({
      hasMore: false,
      sessions: pageSessions
    } as AgentSessionsResponse);

    const { result } = renderHook(() => useAttentionAgentSessionSummaries());

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      window.dispatchEvent(new CustomEvent(AGENT_SESSION_SUMMARY_UPDATED_EVENT, {
        detail: { session: liveSession }
      }));
    });

    expect(result.current.hasMore).toBe(true);
    expect(result.current.sessions).toHaveLength(16);
    expect(result.current.sessions[0]).toBe(liveSession);
  });

  it("does not regress a fresh page with a delayed live summary", async () => {
    const fresh = createSession("session-1", "2026-08-06T10:00:20.000Z");

    apiMocks.getList.mockResolvedValue({ sessions: [fresh] } as AgentSessionsResponse);

    const { result } = renderHook(() => useAttentionAgentSessionSummaries());

    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      window.dispatchEvent(new CustomEvent(AGENT_SESSION_SUMMARY_UPDATED_EVENT, {
        detail: {
          session: createSession("session-1", "2026-08-06T10:00:10.000Z")
        }
      }));
    });

    expect(result.current.sessions).toEqual([fresh]);
  });

  it("does not lose a live summary received while the initial page is loading", async () => {
    let resolvePage!: (page: AgentSessionsResponse) => void;

    apiMocks.getList.mockReturnValue(new Promise((resolve) => {
      resolvePage = resolve;
    }));
    const pageSession = createSession("session-1", "2026-08-06T10:00:00.000Z");
    const liveSession = createSession("session-2", "2026-08-06T10:00:01.000Z");

    const { result } = renderHook(() => useAttentionAgentSessionSummaries());

    act(() => {
      window.dispatchEvent(new CustomEvent(AGENT_SESSION_SUMMARY_UPDATED_EVENT, {
        detail: { session: liveSession }
      }));
    });
    await act(async () => {
      resolvePage({ sessions: [pageSession] } as AgentSessionsResponse);
      await Promise.resolve();
    });

    expect(apiMocks.getList).toHaveBeenCalledTimes(1);
    expect(result.current.sessions.map((session) => session.id)).toEqual([
      "session-2",
      "session-1"
    ]);
  });

  it("marks an exact full page partial when a concurrent live session overflows its merge", async () => {
    let resolvePage!: (page: AgentSessionsResponse) => void;

    apiMocks.getList.mockReturnValue(new Promise((resolve) => {
      resolvePage = resolve;
    }));
    const pageSessions = Array.from({ length: 16 }, (_, index) => createSession(
      `session-${index}`,
      `2026-08-06T10:00:${String(index).padStart(2, "0")}.000Z`
    ));
    const liveSession = createSession("session-live", "2026-08-06T10:01:00.000Z");

    const { result } = renderHook(() => useAttentionAgentSessionSummaries());

    act(() => {
      window.dispatchEvent(new CustomEvent(AGENT_SESSION_SUMMARY_UPDATED_EVENT, {
        detail: { session: liveSession }
      }));
    });
    await act(async () => {
      resolvePage({ hasMore: false, sessions: pageSessions } as AgentSessionsResponse);
      await Promise.resolve();
    });

    expect(result.current.hasMore).toBe(true);
    expect(result.current.sessions).toHaveLength(16);
    expect(result.current.sessions[0]).toBe(liveSession);
  });

  it("aborts and reloads once when the daemon connection changes", async () => {
    const next = createSession("new-daemon-session", "2026-08-06T10:00:00.000Z");

    apiMocks.getList
      .mockImplementationOnce(({ signal }) => new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }))
      .mockResolvedValueOnce({ sessions: [next] } as AgentSessionsResponse);

    const { result } = renderHook(() => useAttentionAgentSessionSummaries());
    const firstSignal = apiMocks.getList.mock.calls[0]?.[0].signal;

    act(() => {
      window.dispatchEvent(new Event(CONNECTION_CONFIG_CHANGED_EVENT));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(firstSignal?.aborted).toBe(true);
    expect(apiMocks.getList).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({ hasLoaded: true, hasMore: false, sessions: [next] });
  });

  it("aborts an old source page and ignores its late result after the source changes", async () => {
    let resolveCodexPage!: (page: AgentSessionsResponse) => void;
    const codex = createSession("codex-session", "2026-08-06T10:00:00.000Z");
    const claude = createSession("claude-session", "2026-08-06T10:00:01.000Z");

    apiMocks.getList
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveCodexPage = resolve;
      }))
      .mockResolvedValueOnce({ hasMore: false, sessions: [claude] } as AgentSessionsResponse);

    const { result, rerender } = renderHook(
      ({ sourceId }: { sourceId: AgentKind }) =>
        useAttentionAgentSessionSummaries(true, sourceId),
      { initialProps: { sourceId: "codex" as AgentKind } }
    );
    const codexSignal = apiMocks.getList.mock.calls[0]?.[0].signal;

    rerender({ sourceId: "claude-code" });
    await act(async () => {
      await Promise.resolve();
    });

    expect(codexSignal?.aborted).toBe(true);
    expect(apiMocks.getList.mock.calls[1]?.[0].sourceId).toBe("claude-code");
    expect(result.current).toEqual({ hasLoaded: true, hasMore: false, sessions: [claude] });

    await act(async () => {
      resolveCodexPage({ hasMore: true, sessions: [codex] } as AgentSessionsResponse);
      await Promise.resolve();
    });

    expect(result.current).toEqual({ hasLoaded: true, hasMore: false, sessions: [claude] });
  });

  it("keeps the initial page available as a layout-stable fallback until hydration settles", async () => {
    let resolvePage!: (page: AgentSessionsResponse) => void;

    apiMocks.getList.mockReturnValue(new Promise((resolve) => {
      resolvePage = resolve;
    }));

    const { result } = renderHook(() => useAttentionAgentSessionSummaries());

    expect(result.current).toEqual({ hasLoaded: false, hasMore: false, sessions: [] });

    const session = { id: "session-1" } as AgentSessionSummary;

    await act(async () => {
      resolvePage({ sessions: [session] } as AgentSessionsResponse);
      await Promise.resolve();
    });

    expect(result.current).toEqual({ hasLoaded: true, hasMore: false, sessions: [session] });
  });
});
