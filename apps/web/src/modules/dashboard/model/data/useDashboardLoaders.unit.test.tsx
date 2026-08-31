import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AgentSessionsResponse,
  OverviewResponse,
  SessionDetail
} from "@deskcue/protocol";
import { AGENT_SESSIONS_INVALIDATED_EVENT } from "@models/agentSessions/contracts";

const apiMocks = vi.hoisted(() => ({
  fetchManagedSessionDetail: vi.fn(),
  fetchManagedSessionDetailWithMeta: vi.fn(),
  getAgentSessions: vi.fn(),
  getOverview: vi.fn(),
  getRuntimes: vi.fn()
}));

vi.mock("@api/endpoint/agentSessions/endpoints", () => ({
  agentSessionsApi: { getList: apiMocks.getAgentSessions }
}));
vi.mock("@api/endpoint/dashboard/endpoints", () => ({
  dashboardApi: {
    getOverview: apiMocks.getOverview,
    getRuntimes: apiMocks.getRuntimes
  }
}));
vi.mock("./managedSessionRequests", () => ({
  fetchManagedSessionDetail: apiMocks.fetchManagedSessionDetail,
  fetchManagedSessionDetailWithMeta: apiMocks.fetchManagedSessionDetailWithMeta
}));

import { useDashboardLoaders } from "./useDashboardLoaders";

function overview(id: string): OverviewResponse {
  return {
    clientContext: { canOpenNativeDialogs: false },
    sessions: [],
    workspaces: [{
      branch: null,
      createdAt: "2026-08-06T00:00:00.000Z",
      id,
      isGitRepo: false,
      name: id,
      path: `C:\\${id}`
    }]
  };
}

function createHarness() {
  const setOverview = vi.fn();
  const setAgentSessionsLoadState = vi.fn();
  const setAgentSessionsPage = vi.fn();
  const setSelectedSession = vi.fn();
  const mergeSelectedSessionView = vi.fn();
  const overviewRef = { current: overview("current") };
  const selectedSessionIdRef = { current: "" };
  const selectedSessionSelectionEpochRef = { current: 0 };

  return {
    args: {
      agentSessionsRef: { current: [] },
      appendAgentSessionsPage: vi.fn(),
      captureOverviewRevision: () => 7,
      overviewRef,
      runtimesRef: { current: [] },
      mergeSelectedSessionView,
      selectedSessionIdRef,
      selectedSessionSelectionEpochRef,
      selectedSessionRef: { current: null },
      setAgentSessionsLoadState,
      setAgentSessionsPage,
      setErrorIfEmpty: vi.fn(),
      setOverview: (value: OverviewResponse, requestRevision: number) => {
        overviewRef.current = value;
        setOverview(value, requestRevision);
      },
      setRuntimes: vi.fn(),
      setSelectedSession
    },
    mergeSelectedSessionView,
    selectedSessionIdRef,
    selectedSessionSelectionEpochRef,
    setAgentSessionsLoadState,
    setAgentSessionsPage,
    setOverview,
    setSelectedSession
  };
}

function agentSessionsPage(): AgentSessionsResponse {
  return {
    hasMore: false,
    limit: 8,
    offset: 0,
    query: null,
    sessions: [],
    sourceCounts: [],
    totalCount: 0,
    totalCountExact: true
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

describe("useDashboardLoaders request ownership", () => {
  beforeEach(() => {
    Object.values(apiMocks).forEach((mock) => mock.mockReset());
  });

  it("does not let an older overview response overwrite the latest load", async () => {
    const first = deferred<OverviewResponse>();
    const latest = overview("latest");

    apiMocks.getOverview
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(latest);
    const harness = createHarness();
    const { result } = renderHook(() => useDashboardLoaders(harness.args));

    const oldLoad = result.current.loadOverview();

    await act(async () => {
      await result.current.loadOverview();
    });

    first.resolve(overview("stale"));
    await act(async () => {
      await oldLoad;
    });

    expect(harness.setOverview).toHaveBeenCalledTimes(1);
    expect(harness.setOverview).toHaveBeenCalledWith(latest, 7);
  });

  it("does not publish an in-flight overview after its runtime tree unmounts", async () => {
    const pending = deferred<OverviewResponse>();

    apiMocks.getOverview.mockReturnValueOnce(pending.promise);
    const harness = createHarness();
    const { result, unmount } = renderHook(() => useDashboardLoaders(harness.args));

    const loading = result.current.loadOverview();

    unmount();

    pending.resolve(overview("previous-machine"));
    await act(async () => {
      await loading;
    });

    expect(harness.setOverview).not.toHaveBeenCalled();
  });

  it("does not publish a failure from a superseded agent-session request", async () => {
    const first = deferred<AgentSessionsResponse>();

    apiMocks.getAgentSessions
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(agentSessionsPage());
    const harness = createHarness();
    const { result } = renderHook(() => useDashboardLoaders(harness.args));

    const oldLoad = result.current.loadAgentSessions();

    await act(async () => {
      await result.current.loadAgentSessions();
    });

    first.reject(new Error("stale network failure"));
    await act(async () => {
      await oldLoad;
    });

    expect(harness.setAgentSessionsLoadState).not.toHaveBeenCalledWith("failed");
    expect(harness.setAgentSessionsPage).toHaveBeenCalledTimes(1);
  });

  it("keeps a populated agent list ready during a silent exact-count refresh", async () => {
    apiMocks.getAgentSessions.mockResolvedValueOnce(agentSessionsPage());
    const harness = createHarness();

    harness.args.agentSessionsRef.current = [{ id: "codex:existing" }] as never;
    const { result } = renderHook(() => useDashboardLoaders(harness.args));

    await act(async () => {
      await result.current.loadAgentSessions({ silent: true });
    });

    expect(harness.setAgentSessionsLoadState).not.toHaveBeenCalledWith("loading");
    expect(harness.setAgentSessionsPage).toHaveBeenCalledTimes(1);
  });

  it("reconciles an invalidated live count without exposing a loading state", async () => {
    vi.useFakeTimers();
    apiMocks.getAgentSessions.mockResolvedValueOnce(agentSessionsPage());
    const harness = createHarness();

    harness.args.agentSessionsRef.current = [{ id: "codex:existing" }] as never;
    const { unmount } = renderHook(() => useDashboardLoaders(harness.args));

    try {
      window.dispatchEvent(new Event(AGENT_SESSIONS_INVALIDATED_EVENT));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(150);
      });

      expect(apiMocks.getAgentSessions).toHaveBeenCalledTimes(1);
      expect(harness.setAgentSessionsLoadState).not.toHaveBeenCalledWith("loading");
      expect(harness.setAgentSessionsPage).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });

  it("reconciles an invalidated source list inside its active source scope", async () => {
    vi.useFakeTimers();
    apiMocks.getAgentSessions.mockResolvedValue(agentSessionsPage());
    const harness = createHarness();

    harness.args.agentSessionsRef.current = [{ id: "claude-code:existing" }] as never;
    const { result, unmount } = renderHook(() => useDashboardLoaders(harness.args));

    try {
      await act(async () => {
        await result.current.loadAgentSessions({ sourceId: "claude-code" });
      });

      apiMocks.getAgentSessions.mockClear();

      window.dispatchEvent(new Event(AGENT_SESSIONS_INVALIDATED_EVENT));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(150);
      });

      expect(apiMocks.getAgentSessions).toHaveBeenCalledWith(expect.objectContaining({
        sourceId: "claude-code"
      }));
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });

  it("reconciles an invalidated search inside its active query and source scope", async () => {
    vi.useFakeTimers();
    apiMocks.getAgentSessions.mockResolvedValue(agentSessionsPage());
    const harness = createHarness();

    harness.args.agentSessionsRef.current = [{ id: "codex:existing" }] as never;
    const { result, unmount } = renderHook(() => useDashboardLoaders(harness.args));

    try {
      await act(async () => {
        await result.current.searchAgentSessions("forimex", { sourceId: "codex" });
      });

      apiMocks.getAgentSessions.mockClear();

      window.dispatchEvent(new Event(AGENT_SESSIONS_INVALIDATED_EVENT));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(150);
      });

      expect(apiMocks.getAgentSessions).toHaveBeenCalledWith(expect.objectContaining({
        query: "forimex",
        sourceId: "codex"
      }));
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });

  it("keeps the latest managed-session detail when forced loads overlap", async () => {
    const first = deferred<SessionDetail | null>();
    const latest = { id: "managed-1", lastActivityAt: "latest" } as SessionDetail;

    apiMocks.fetchManagedSessionDetail
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(latest);
    const harness = createHarness();

    harness.selectedSessionIdRef.current = "managed-1";
    const { result } = renderHook(() => useDashboardLoaders(harness.args));

    const oldLoad = result.current.loadSession("managed-1", { force: true });

    await act(async () => {
      await result.current.loadSession("managed-1", { force: true });
    });

    first.resolve({ id: "managed-1", lastActivityAt: "stale" } as SessionDetail);
    await act(async () => {
      await oldLoad;
    });

    expect(harness.setSelectedSession).toHaveBeenCalledTimes(1);
    expect(harness.setSelectedSession).toHaveBeenCalledWith(latest);
  });

  it("keeps debug and chat request ownership independent", async () => {
    const debugLoad = deferred<SessionDetail | null>();
    const chatSession = { id: "managed-1", lastActivityAt: "chat" } as SessionDetail;
    const debugSession = { id: "managed-1", lastActivityAt: "debug" } as SessionDetail;

    apiMocks.fetchManagedSessionDetail
      .mockReturnValueOnce(debugLoad.promise)
      .mockResolvedValueOnce(chatSession);
    const harness = createHarness();

    harness.selectedSessionIdRef.current = "managed-1";
    const { result } = renderHook(() => useDashboardLoaders(harness.args));

    const pendingDebug = result.current.loadSession("managed-1", {
      force: true,
      sessionView: "debug"
    });

    await act(async () => {
      await result.current.loadSession("managed-1", {
        force: true,
        sessionView: "chat"
      });
    });

    debugLoad.resolve(debugSession);
    await act(async () => {
      await pendingDebug;
    });

    expect(harness.mergeSelectedSessionView).toHaveBeenCalledTimes(2);
    expect(harness.mergeSelectedSessionView).toHaveBeenNthCalledWith(1, chatSession, "chat");
    expect(harness.mergeSelectedSessionView).toHaveBeenNthCalledWith(2, debugSession, "debug");
  });

  it("keeps initial-route outcome ownership independent from automatic chat hydration", async () => {
    const initialLoad = deferred<{
      data: SessionDetail | null;
      etag: string | null;
      notModified: boolean;
      status: number;
    }>();
    const chatSession = { id: "managed-1", lastActivityAt: "chat" } as SessionDetail;

    apiMocks.fetchManagedSessionDetailWithMeta.mockReturnValueOnce(initialLoad.promise);
    apiMocks.fetchManagedSessionDetail.mockResolvedValueOnce(chatSession);

    const harness = createHarness();

    harness.selectedSessionIdRef.current = "managed-1";
    const { result } = renderHook(() => useDashboardLoaders(harness.args));

    const initialOutcome = result.current.loadSessionWithOutcome("managed-1", {
      requestScope: "initial-route",
      sessionView: "chat"
    });

    await act(async () => {
      await result.current.loadSession("managed-1", { sessionView: "chat" });
    });

    initialLoad.reject(new Error("Initial route request failed"));

    await expect(initialOutcome).resolves.toEqual({
      kind: "error",
      message: "Initial route request failed"
    });
  });

  it("rejects an ABA managed-session response from an older selection epoch", async () => {
    const staleLoad = deferred<SessionDetail | null>();

    apiMocks.fetchManagedSessionDetail.mockReturnValueOnce(staleLoad.promise);
    const harness = createHarness();

    harness.selectedSessionIdRef.current = "managed-1";
    const { result } = renderHook(() => useDashboardLoaders(harness.args));

    const pendingLoad = result.current.loadSession("managed-1", {
      force: true,
      sessionView: "debug"
    });

    harness.selectedSessionSelectionEpochRef.current += 2;
    staleLoad.resolve({ id: "managed-1", lastActivityAt: "stale" } as SessionDetail);
    await act(async () => {
      await pendingLoad;
    });

    expect(harness.mergeSelectedSessionView).not.toHaveBeenCalled();
    expect(harness.setSelectedSession).not.toHaveBeenCalled();
  });
});
