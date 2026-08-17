import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DESKCUE_PROTOCOL_CAPABILITIES, DESKCUE_PROTOCOL_VERSION } from "@deskcue/protocol";
import type { ServerEvent, SessionDetail } from "@deskcue/protocol";
import { LIVE_UPDATES_OFFLINE_MESSAGE } from "@models/liveUpdatesConnection";
import type { SessionTab } from "@models/sessionTabs";
import type { LoadOptions } from "@modules/dashboard/model/data/dashboardLoad";
import type { DashboardStore } from "@modules/dashboard/model/store";
import {
  createCloudMachineDeskCueRuntime,
  initializeDeskCueRuntime,
  resetDeskCueRuntimeForTests
} from "@runtime";

import type { UseDashboardLiveUpdatesSocketArgs } from "./types";
import { useDashboardLiveUpdatesSocket } from "./useDashboardLiveUpdatesSocket";

const realtimeMocks = vi.hoisted(() => ({
  acknowledgeLiveUpdateCursor: vi.fn(),
  handleLiveUpdatesClose: vi.fn(() => false),
  openLiveUpdatesSocket: vi.fn(),
  parseLiveUpdateMessage: vi.fn(),
  sendLiveSessionPresence: vi.fn()
}));

const connectionMocks = vi.hoisted(() => {
  const state = { epoch: 0 };
  return {
    state,
    emitConnectionConfigChangedEvent: vi.fn(() => {
      state.epoch += 1;
      window.dispatchEvent(new Event("deskcue:connection-config-changed"));
    }),
    fetchSecurityStatus: vi.fn(() => Promise.resolve({})),
    isConnectionEpochCurrent: vi.fn((epoch: number) => epoch === state.epoch),
    readConnectionEpoch: vi.fn(() => state.epoch)
  };
});

vi.mock("@api/realtime", () => realtimeMocks);

vi.mock("@api/connection", () => ({
  CONNECTION_CONFIG_CHANGED_EVENT: "deskcue:connection-config-changed",
  emitConnectionConfigChangedEvent: connectionMocks.emitConnectionConfigChangedEvent,
  fetchSecurityStatus: connectionMocks.fetchSecurityStatus,
  invalidateConnectionConfigCache: vi.fn(),
  isConnectionConfigStorageKey: vi.fn(() => false),
  isConnectionEpochCurrent: connectionMocks.isConnectionEpochCurrent,
  isProtocolCompatibilityError: vi.fn(() => false),
  readConnectionEpoch: connectionMocks.readConnectionEpoch
}));

const protocolHello = {
  payload: {
    capabilities: [...DESKCUE_PROTOCOL_CAPABILITIES],
    version: DESKCUE_PROTOCOL_VERSION
  },
  type: "protocol.hello"
} satisfies ServerEvent;

type FakeSocket = Pick<WebSocket, "close" | "send" | "readyState"> & {
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onopen: ((event: Event) => void) | null;
};

function createFakeSocket(): FakeSocket {
  return {
    close: vi.fn(),
    onclose: null,
    onerror: null,
    onmessage: null,
    onopen: null,
    readyState: WebSocket.OPEN,
    send: vi.fn()
  };
}

function createStore(): DashboardStore {
  return {
    clearLiveUpdatesReconnectError: vi.fn(),
    incrementEventStreamAttempt: vi.fn(),
    liveUpdatesConnection: {
      lastSyncedAt: null,
      status: "synced"
    },
    markLiveUpdatesSynced: vi.fn(),
    setErrorIfEmpty: vi.fn(),
    setLiveUpdatesConnecting: vi.fn(),
    setLiveUpdatesOffline: vi.fn(),
    setLiveUpdatesReconnecting: vi.fn()
  } as unknown as DashboardStore;
}

function TestHarness({
  activeTab = "overview",
  fakeSocket,
  loadSession,
  refreshTakenOverTranscriptNow = vi.fn(),
  store = createStore()
}: {
  activeTab?: SessionTab;
  fakeSocket: FakeSocket;
  loadSession: (sessionId: string, options?: LoadOptions) => Promise<SessionDetail | null>;
  refreshTakenOverTranscriptNow?: UseDashboardLiveUpdatesSocketArgs["refreshTakenOverTranscriptNow"];
  store?: DashboardStore;
}) {
  const activeTabRef = useRef<SessionTab>(activeTab);
  const activeTakenOverAgentSessionIdRef = useRef("codex:source-1");
  const loadSessionRef = useRef(loadSession);
  const selectedAgentSessionIdRef = useRef("codex:source-1");
  const selectedSessionIdRef = useRef("session-1");
  const selectedSessionRef = useRef<SessionDetail | null>(null);
  const storeRef = useRef(store);

  activeTabRef.current = activeTab;

  realtimeMocks.openLiveUpdatesSocket.mockReturnValue(fakeSocket);

  useDashboardLiveUpdatesSocket({
    activeTab,
    activeTabRef,
    activeTakenOverAgentSessionIdRef,
    eventStreamAttempt: 0,
    loadSessionRef,
    refreshTakenOverTranscriptNow,
    scheduleSelectedAgentSessionRefresh: vi.fn(),
    scheduleTakenOverTranscriptRefresh: vi.fn(),
    selectedAgentSessionIdRef,
    selectedSessionId: "session-1",
    selectedSessionIdRef,
    selectedSessionRef,
    store: storeRef.current
  });

  return null;
}

describe("useDashboardLiveUpdatesSocket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectionMocks.state.epoch = 0;
    realtimeMocks.parseLiveUpdateMessage.mockReturnValue(protocolHello);
    resetDeskCueRuntimeForTests();
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    vi.useRealTimers();
    resetDeskCueRuntimeForTests();
  });

  it("resyncs the selected session when live updates reconnect", async () => {
    vi.useFakeTimers();
    const fakeSocket = createFakeSocket();
    const loadSession = vi.fn(() => Promise.resolve(null));
    const store = createStore();

    render(<TestHarness fakeSocket={fakeSocket} loadSession={loadSession} store={store} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    act(() => {
      fakeSocket.onopen?.(new Event("open"));
    });

    expect(store.markLiveUpdatesSynced).not.toHaveBeenCalled();
    expect(loadSession).not.toHaveBeenCalled();

    act(() => {
      fakeSocket.onmessage?.(new MessageEvent("message", { data: "hello" }));
    });

    expect(loadSession).toHaveBeenCalledWith("session-1", {
      silent: true,
      sessionView: "chat"
    });
  });

  it("keeps the live socket open across tab callback churn and uses the latest callbacks", async () => {
    vi.useFakeTimers();
    const fakeSocket = createFakeSocket();
    const loadSession = vi.fn(() => Promise.resolve(null));
    const initialRefresh = vi.fn();
    const latestRefresh = vi.fn();

    const { rerender } = render(
      <TestHarness
        activeTab="overview"
        fakeSocket={fakeSocket}
        loadSession={loadSession}
        refreshTakenOverTranscriptNow={initialRefresh}
      />
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    rerender(
      <TestHarness
        activeTab="diff"
        fakeSocket={fakeSocket}
        loadSession={loadSession}
        refreshTakenOverTranscriptNow={latestRefresh}
      />
    );

    expect(realtimeMocks.openLiveUpdatesSocket).toHaveBeenCalledTimes(1);
    expect(fakeSocket.close).not.toHaveBeenCalled();
    expect(realtimeMocks.sendLiveSessionPresence).toHaveBeenLastCalledWith(
      fakeSocket,
      "session-1",
      "diff"
    );

    act(() => {
      fakeSocket.onmessage?.(new MessageEvent("message", { data: "hello" }));
    });

    expect(initialRefresh).not.toHaveBeenCalled();
    expect(latestRefresh).toHaveBeenCalledWith(undefined, {
      allowDuringPromptPolling: true,
      reason: "reconnect"
    });
  });

  it("ignores callbacks from a socket opened for a previous connection epoch", async () => {
    vi.useFakeTimers();
    const fakeSocket = createFakeSocket();
    const store = createStore();
    const loadSession = vi.fn(() => Promise.resolve(null));

    render(<TestHarness fakeSocket={fakeSocket} loadSession={loadSession} store={store} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    act(() => {
      connectionMocks.state.epoch += 1;
      window.dispatchEvent(new Event("deskcue:connection-config-changed"));
      fakeSocket.onopen?.(new Event("open"));
      fakeSocket.onmessage?.(new MessageEvent("message", { data: "hello" }));
    });

    expect(fakeSocket.close).toHaveBeenCalled();
    expect(store.markLiveUpdatesSynced).not.toHaveBeenCalled();
    expect(loadSession).not.toHaveBeenCalled();
  });

  it("keeps the dashboard unsynced when the daemon protocol is incompatible", async () => {
    vi.useFakeTimers();
    const fakeSocket = createFakeSocket();
    const store = createStore();
    realtimeMocks.parseLiveUpdateMessage.mockReturnValue({
      ...protocolHello,
      payload: {
        ...protocolHello.payload,
        version: DESKCUE_PROTOCOL_VERSION + 1
      }
    });

    render(
      <TestHarness
        fakeSocket={fakeSocket}
        loadSession={vi.fn(() => Promise.resolve(null))}
        store={store}
      />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    act(() => {
      fakeSocket.onmessage?.(new MessageEvent("message", { data: "hello" }));
    });

    expect(store.markLiveUpdatesSynced).not.toHaveBeenCalled();
    expect(store.setLiveUpdatesOffline).toHaveBeenCalled();
    expect(store.setErrorIfEmpty).toHaveBeenCalledWith(
      "This DeskCue page is incompatible with the connected daemon. Reload DeskCue."
    );
    expect(fakeSocket.close).toHaveBeenCalled();
  });

  it("does not mark an invalid realtime payload as synced", async () => {
    vi.useFakeTimers();
    const fakeSocket = createFakeSocket();
    const store = createStore();
    realtimeMocks.parseLiveUpdateMessage.mockImplementation(() => {
      throw new Error("invalid event");
    });

    render(
      <TestHarness
        fakeSocket={fakeSocket}
        loadSession={vi.fn(() => Promise.resolve(null))}
        store={store}
      />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    act(() => {
      fakeSocket.onmessage?.(new MessageEvent("message", { data: "{}" }));
    });

    expect(store.markLiveUpdatesSynced).not.toHaveBeenCalled();
    expect(realtimeMocks.acknowledgeLiveUpdateCursor).not.toHaveBeenCalled();
  });

  it("reconnects a Cloud socket without probing the local-only security endpoint", async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", "/machines/machine-1/deskcue/");
    const cloudRuntime = createCloudMachineDeskCueRuntime(window.location);
    initializeDeskCueRuntime({
      ...cloudRuntime,
      features: { ...cloudRuntime.features, realtime: true }
    });
    const fakeSocket = createFakeSocket();
    const store = createStore();

    render(
      <TestHarness
        fakeSocket={fakeSocket}
        loadSession={vi.fn(() => Promise.resolve(null))}
        store={store}
      />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    act(() => {
      fakeSocket.onclose?.(new CloseEvent("close", { code: 1006 }));
    });

    expect(connectionMocks.fetchSecurityStatus).not.toHaveBeenCalled();
    expect(store.setLiveUpdatesReconnecting).toHaveBeenCalled();
  });

  it("surfaces browser offline state and reconnects when the network returns", async () => {
    vi.useFakeTimers();
    const fakeSocket = createFakeSocket();
    const store = createStore();

    render(
      <TestHarness
        fakeSocket={fakeSocket}
        loadSession={vi.fn(() => Promise.resolve(null))}
        store={store}
      />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(store.setLiveUpdatesOffline).toHaveBeenCalledTimes(1);
    expect(store.setErrorIfEmpty).toHaveBeenCalledWith(LIVE_UPDATES_OFFLINE_MESSAGE);
    expect(fakeSocket.close).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(store.setLiveUpdatesReconnecting).toHaveBeenCalledTimes(1);
    expect(store.incrementEventStreamAttempt).toHaveBeenCalledTimes(1);
  });
});
