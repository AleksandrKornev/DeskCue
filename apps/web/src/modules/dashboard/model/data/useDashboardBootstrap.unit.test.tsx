import { act, render, renderHook, screen } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OverviewResponse, SessionDetail } from "@deskcue/protocol";

import type { ManagedSessionLoadOutcome, UseDashboardBootstrapArgs } from "./types";
import { useDashboardBootstrap } from "./useDashboardBootstrap";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

function ResolveOnLayout({ onResolve }: { onResolve?: () => void }) {
  useLayoutEffect(() => {
    onResolve?.();
  }, [onResolve]);

  return null;
}

function DashboardBootstrapHarness({
  args,
  onResolveLayout,
  sessionId
}: {
  args: UseDashboardBootstrapArgs;
  onResolveLayout?: () => void;
  sessionId: string;
}) {
  const { initialManagedSessionLoadState } = useDashboardBootstrap({
    ...args,
    initialManagedSessionId: sessionId
  });

  return (
    <>
      <ResolveOnLayout onResolve={onResolveLayout} />
      <output data-testid="initial-managed-session-kind">
        {initialManagedSessionLoadState.kind}
      </output>
    </>
  );
}

describe("useDashboardBootstrap initial route ownership", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not let an older same-route outcome replace a newer terminal state", async () => {
    vi.useFakeTimers();
    const olderLoad = deferred<ManagedSessionLoadOutcome>();
    const newerLoad = deferred<ManagedSessionLoadOutcome>();
    const loadSessionWithOutcome = vi.fn()
      .mockReturnValueOnce(olderLoad.promise)
      .mockReturnValueOnce(newerLoad.promise);
    const selectedSessionIdRef = { current: "" };
    const selectedSessionSelectionEpochRef = { current: 0 };
    const { result, unmount } = renderHook(() => useDashboardBootstrap({
      initialManagedSessionId: "session-a",
      loadAgentSessions: vi.fn(() => Promise.resolve([])),
      loadOverview: vi.fn(() => Promise.resolve({
        clientContext: { canOpenNativeDialogs: false },
        sessions: [],
        workspaces: []
      })),
      loadRuntimes: vi.fn(() => Promise.resolve([])),
      loadSession: vi.fn(() => Promise.resolve(null)),
      loadSessionWithOutcome,
      selectedSessionIdRef,
      selectedSessionSelectionEpochRef,
      setIsBootstrapping: vi.fn(),
      setSelectedSessionId: vi.fn()
    }));

    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });

    let retryPromise!: Promise<ManagedSessionLoadOutcome>;

    act(() => {
      retryPromise = result.current.retryInitialManagedSessionLoad?.() as
        Promise<ManagedSessionLoadOutcome>;
    });

    newerLoad.resolve({ kind: "loaded", session: { id: "session-a" } as SessionDetail });
    await act(async () => {
      await retryPromise;
    });

    expect(result.current.initialManagedSessionLoadState).toEqual({ kind: "loaded" });
    expect(selectedSessionSelectionEpochRef.current).toBe(1);

    olderLoad.resolve({ kind: "superseded" });
    await act(async () => {
      await olderLoad.promise;
      await Promise.resolve();
    });

    expect(result.current.initialManagedSessionLoadState).toEqual({ kind: "loaded" });
    unmount();
  });

  it("does not let a pending route-less bootstrap replace a newly claimed route", async () => {
    vi.useFakeTimers();
    const overviewLoad = deferred<OverviewResponse>();
    const selectedSessionIdRef = { current: "" };
    const selectedSessionSelectionEpochRef = { current: 0 };
    const setSelectedSessionId = vi.fn();
    const loadSession = vi.fn(() => Promise.resolve(null));
    const loadSessionWithOutcome = vi.fn(() => new Promise<ManagedSessionLoadOutcome>(() => {}));
    const sharedArgs = {
      loadAgentSessions: vi.fn(() => Promise.resolve([])),
      loadOverview: vi.fn(() => overviewLoad.promise),
      loadRuntimes: vi.fn(() => Promise.resolve([])),
      loadSession,
      loadSessionWithOutcome,
      selectedSessionIdRef,
      selectedSessionSelectionEpochRef,
      setIsBootstrapping: vi.fn(),
      setSelectedSessionId
    };

    const { rerender, unmount } = renderHook(
      ({ sessionId }: { sessionId?: string }) => useDashboardBootstrap({
        ...sharedArgs,
        initialManagedSessionId: sessionId
      }),
      { initialProps: { sessionId: undefined as string | undefined } }
    );

    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });

    rerender({ sessionId: "session-b" });

    await act(async () => {
      overviewLoad.resolve({
        clientContext: { canOpenNativeDialogs: false },
        sessions: [{ id: "session-a", status: "running" }],
        workspaces: []
      } as unknown as OverviewResponse);
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });

    expect(selectedSessionIdRef.current).toBe("session-b");
    expect(setSelectedSessionId).toHaveBeenCalledWith("session-b");
    expect(setSelectedSessionId).not.toHaveBeenCalledWith("session-a");
    expect(loadSession).not.toHaveBeenCalledWith("session-a", expect.anything());
    unmount();
  });

  it("advances the production selection epoch across an A-B-A route cycle", async () => {
    vi.useFakeTimers();
    const selectedSessionIdRef = { current: "" };
    const selectedSessionSelectionEpochRef = { current: 0 };
    const pendingOutcome = new Promise<ManagedSessionLoadOutcome>(() => {});
    const sharedArgs = {
      loadAgentSessions: vi.fn(() => Promise.resolve([])),
      loadOverview: vi.fn(() => Promise.resolve({
        clientContext: { canOpenNativeDialogs: false },
        sessions: [],
        workspaces: []
      })),
      loadRuntimes: vi.fn(() => Promise.resolve([])),
      loadSession: vi.fn(() => Promise.resolve(null)),
      loadSessionWithOutcome: vi.fn(() => pendingOutcome),
      selectedSessionIdRef,
      selectedSessionSelectionEpochRef,
      setIsBootstrapping: vi.fn(),
      setSelectedSessionId: vi.fn()
    };

    const { rerender, unmount } = renderHook(
      ({ sessionId }: { sessionId: string }) => useDashboardBootstrap({
        ...sharedArgs,
        initialManagedSessionId: sessionId
      }),
      { initialProps: { sessionId: "session-a" } }
    );

    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });

    rerender({ sessionId: "session-b" });
    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });

    rerender({ sessionId: "session-a" });
    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });

    expect(selectedSessionIdRef.current).toBe("session-a");
    expect(selectedSessionSelectionEpochRef.current).toBe(3);
    unmount();
  });

  it("invalidates the previous route before the next bootstrap timer starts", async () => {
    vi.useFakeTimers();
    const sessionALoad = deferred<ManagedSessionLoadOutcome>();
    const sessionBLoad = deferred<ManagedSessionLoadOutcome>();
    const loadSessionWithOutcome = vi.fn()
      .mockReturnValueOnce(sessionALoad.promise)
      .mockReturnValueOnce(sessionBLoad.promise);
    const selectedSessionIdRef = { current: "" };
    const selectedSessionSelectionEpochRef = { current: 0 };
    const sharedArgs = {
      loadAgentSessions: vi.fn(() => Promise.resolve([])),
      loadOverview: vi.fn(() => Promise.resolve({
        clientContext: { canOpenNativeDialogs: false },
        sessions: [],
        workspaces: []
      })),
      loadRuntimes: vi.fn(() => Promise.resolve([])),
      loadSession: vi.fn(() => Promise.resolve(null)),
      loadSessionWithOutcome,
      selectedSessionIdRef,
      selectedSessionSelectionEpochRef,
      setIsBootstrapping: vi.fn(),
      setSelectedSessionId: vi.fn()
    };

    const { result, rerender, unmount } = renderHook(
      ({ sessionId }: { sessionId: string }) => useDashboardBootstrap({
        ...sharedArgs,
        initialManagedSessionId: sessionId
      }),
      { initialProps: { sessionId: "session-a" } }
    );

    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });

    rerender({ sessionId: "session-b" });
    sessionALoad.resolve({ kind: "loaded", session: { id: "session-a" } as SessionDetail });
    await act(async () => {
      await sessionALoad.promise;
      await Promise.resolve();
    });

    expect(result.current.initialManagedSessionLoadState).toEqual({ kind: "loading" });
    expect(selectedSessionIdRef.current).toBe("session-b");
    expect(selectedSessionSelectionEpochRef.current).toBe(2);
    expect(loadSessionWithOutcome).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });

    expect(loadSessionWithOutcome).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("clears a terminal state as soon as the next route claims ownership", async () => {
    vi.useFakeTimers();
    const sessionALoad = deferred<ManagedSessionLoadOutcome>();
    const sessionBLoad = deferred<ManagedSessionLoadOutcome>();
    const selectedSessionIdRef = { current: "" };
    const selectedSessionSelectionEpochRef = { current: 0 };
    const loadSessionWithOutcome = vi.fn()
      .mockReturnValueOnce(sessionALoad.promise)
      .mockReturnValueOnce(sessionBLoad.promise);
    const sharedArgs = {
      loadAgentSessions: vi.fn(() => Promise.resolve([])),
      loadOverview: vi.fn(() => Promise.resolve({
        clientContext: { canOpenNativeDialogs: false },
        sessions: [],
        workspaces: []
      })),
      loadRuntimes: vi.fn(() => Promise.resolve([])),
      loadSession: vi.fn(() => Promise.resolve(null)),
      loadSessionWithOutcome,
      selectedSessionIdRef,
      selectedSessionSelectionEpochRef,
      setIsBootstrapping: vi.fn(),
      setSelectedSessionId: vi.fn()
    };

    const { result, rerender, unmount } = renderHook(
      ({ sessionId }: { sessionId: string }) => useDashboardBootstrap({
        ...sharedArgs,
        initialManagedSessionId: sessionId
      }),
      { initialProps: { sessionId: "session-a" } }
    );

    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });

    sessionALoad.resolve({ kind: "error", message: "A failed" });
    await act(async () => {
      await sessionALoad.promise;
      await Promise.resolve();
    });

    expect(result.current.initialManagedSessionLoadState.kind).toBe("error");

    rerender({ sessionId: "session-b" });

    expect(result.current.initialManagedSessionLoadState).toEqual({ kind: "loading" });
    expect(selectedSessionIdRef.current).toBe("session-b");
    expect(selectedSessionSelectionEpochRef.current).toBe(2);
    expect(loadSessionWithOutcome).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("claims the next route before an older load resolved from child layout can commit", async () => {
    vi.useFakeTimers();
    const sessionALoad = deferred<ManagedSessionLoadOutcome>();
    const sessionBLoad = deferred<ManagedSessionLoadOutcome>();
    const selectedSessionIdRef = { current: "" };
    const selectedSessionSelectionEpochRef = { current: 0 };
    const loadSessionWithOutcome = vi.fn()
      .mockReturnValueOnce(sessionALoad.promise)
      .mockReturnValueOnce(sessionBLoad.promise);
    const sharedArgs: UseDashboardBootstrapArgs = {
      loadAgentSessions: vi.fn(() => Promise.resolve([])),
      loadOverview: vi.fn(() => Promise.resolve({
        clientContext: { canOpenNativeDialogs: false },
        sessions: [],
        workspaces: []
      })),
      loadRuntimes: vi.fn(() => Promise.resolve([])),
      loadSession: vi.fn(() => Promise.resolve(null)),
      loadSessionWithOutcome,
      selectedSessionIdRef,
      selectedSessionSelectionEpochRef,
      setIsBootstrapping: vi.fn(),
      setSelectedSessionId: vi.fn()
    };

    const resolveSessionAFromLayout = () => {
      sessionALoad.resolve({
        kind: "loaded",
        session: { id: "session-a" } as SessionDetail
      });
    };

    const view = render(
      <DashboardBootstrapHarness args={sharedArgs} sessionId="session-a" />
    );

    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });

    view.rerender(
      <DashboardBootstrapHarness
        args={sharedArgs}
        onResolveLayout={resolveSessionAFromLayout}
        sessionId="session-b"
      />
    );

    await act(async () => {
      await sessionALoad.promise;
      await Promise.resolve();
    });

    expect(screen.getByTestId("initial-managed-session-kind")).toHaveTextContent("loading");
    expect(selectedSessionIdRef.current).toBe("session-b");
    expect(selectedSessionSelectionEpochRef.current).toBe(2);
    expect(loadSessionWithOutcome).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
