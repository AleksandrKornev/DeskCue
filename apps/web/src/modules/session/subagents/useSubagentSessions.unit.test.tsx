import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentSessionSummary, AgentSessionsResponse } from "@deskcue/protocol";
import { AGENT_SESSION_SUMMARY_UPDATED_EVENT } from "@models/agentSessions/contracts";

const apiMocks = vi.hoisted(() => ({
  getList: vi.fn()
}));

vi.mock("@api/endpoint/agentSessions/endpoints", () => ({
  agentSessionsApi: {
    getList: apiMocks.getList
  }
}));

import { useSubagentSessions } from "./useSubagentSessions";

function child(id: string, parentSessionId = "codex:parent"): AgentSessionSummary {
  return {
    id: `codex:${id}`,
    agentId: "codex",
    agentLabel: "Codex",
    attachMode: "read_only",
    cliVersion: null,
    filePath: `${id}.jsonl`,
    model: null,
    originator: null,
    source: "codex",
    sourceSessionId: id,
    subagent: { depth: 1, nickname: id, parentSessionId, role: null },
    title: id,
    updatedAt: "2026-09-04T10:00:00.000Z",
    workspaceName: "DeskCue",
    workspacePath: "D:\\work\\DeskCue",
    workState: "idle"
  };
}

function page(sessions: AgentSessionSummary[]): AgentSessionsResponse {
  return {
    hasMore: false,
    limit: 100,
    offset: 0,
    query: null,
    sessions,
    sourceCounts: [{ agentId: "codex", count: sessions.length, exact: true }],
    totalCount: sessions.length,
    totalCountExact: true
  };
}

describe("useSubagentSessions", () => {
  beforeEach(() => {
    apiMocks.getList.mockReset();
  });

  it("loads only direct children for the selected parent", async () => {
    let resolvePage!: (value: AgentSessionsResponse) => void;
    const pendingPage = new Promise<AgentSessionsResponse>((resolve) => {
      resolvePage = resolve;
    });

    apiMocks.getList.mockReturnValue(pendingPage);
    const { result } = renderHook(() => useSubagentSessions([], "codex:parent"));

    expect(result.current.isLoading).toBe(true);
    await act(async () => {
      resolvePage(page([child("Scout")]));
      await pendingPage;
    });

    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    expect(result.current.isLoading).toBe(false);
    expect(apiMocks.getList).toHaveBeenCalledWith(expect.objectContaining({
      includeLiveMetadata: true,
      limit: 100,
      parentSessionId: "codex:parent"
    }));
  });

  it("ignores a late response from the previous parent", async () => {
    let resolveFirst!: (value: AgentSessionsResponse) => void;
    const first = new Promise<AgentSessionsResponse>((resolve) => {
      resolveFirst = resolve;
    });

    apiMocks.getList
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(page([child("Current", "codex:current")]));

    const { rerender, result } = renderHook(
      ({ parentSessionId }) => useSubagentSessions([], parentSessionId),
      { initialProps: { parentSessionId: "codex:parent" } }
    );

    rerender({ parentSessionId: "codex:current" });
    await waitFor(() => expect(result.current.sessions[0]?.id).toBe("codex:Current"));

    await act(async () => {
      resolveFirst(page([child("Stale")]));
      await first;
    });

    expect(result.current.sessions.map((session) => session.id)).toEqual(["codex:Current"]);
  });

  it("applies a direct-child realtime summary without waiting for invalidation", async () => {
    apiMocks.getList.mockResolvedValue(page([]));

    const { result } = renderHook(() => useSubagentSessions([], "codex:parent"));

    await waitFor(() => expect(apiMocks.getList).toHaveBeenCalledOnce());

    act(() => {
      window.dispatchEvent(new CustomEvent(AGENT_SESSION_SUMMARY_UPDATED_EVENT, {
        detail: { session: child("Live") }
      }));
    });

    expect(result.current.sessions.map((session) => session.id)).toEqual(["codex:Live"]);
  });

  it("keeps a newer realtime child when an older request finishes later", async () => {
    let resolvePage!: (value: AgentSessionsResponse) => void;
    const pendingPage = new Promise<AgentSessionsResponse>((resolve) => {
      resolvePage = resolve;
    });
    const live = {
      ...child("Live"),
      updatedAt: "2026-09-04T10:02:00.000Z",
      workState: "running" as const
    };

    apiMocks.getList.mockReturnValue(pendingPage);
    const { result } = renderHook(() => useSubagentSessions([], "codex:parent"));

    await waitFor(() => expect(apiMocks.getList).toHaveBeenCalledOnce());

    act(() => {
      window.dispatchEvent(new CustomEvent(AGENT_SESSION_SUMMARY_UPDATED_EVENT, {
        detail: { session: live }
      }));
    });
    await act(async () => {
      resolvePage(page([{
        ...child("Live"),
        updatedAt: "2026-09-04T10:01:00.000Z"
      }]));
      await pendingPage;
    });

    expect(result.current.sessions[0]?.workState).toBe("running");
    expect(result.current.sessions[0]?.updatedAt).toBe("2026-09-04T10:02:00.000Z");
  });

  it("exposes a retry after an initial child-list failure", async () => {
    apiMocks.getList.mockRejectedValueOnce(new Error("offline"));

    const { result } = renderHook(() => useSubagentSessions([], "codex:parent"));

    await waitFor(() => expect(result.current.loadFailed).toBe(true));
    apiMocks.getList.mockResolvedValueOnce(page([child("Recovered")]));
    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.loadFailed).toBe(false);
    expect(result.current.sessions.map((session) => session.id)).toEqual(["codex:Recovered"]);
  });

  it("drops a child removed from a later authoritative page", async () => {
    apiMocks.getList
      .mockResolvedValueOnce(page([child("Removed")]))
      .mockResolvedValueOnce(page([]));

    const { result } = renderHook(() => useSubagentSessions([], "codex:parent"));

    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.sessions).toEqual([]);
  });
});
