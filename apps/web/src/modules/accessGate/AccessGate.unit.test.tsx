import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchSecurityStatus: vi.fn(),
  handleLiveUpdatesClose: vi.fn(() => false),
  invalidateConnectionConfigCache: vi.fn(),
  isConnectionConfigStorageKey: vi.fn(() => false),
  openAccessMonitorSocket: vi.fn()
}));

vi.mock("@api/connection", () => ({
  CONNECTION_CONFIG_CHANGED_EVENT: "deskcue:connection-config-changed",
  emitConnectionConfigChangedEvent: () => {
    window.dispatchEvent(new Event("deskcue:connection-config-changed"));
  },
  fetchSecurityStatus: mocks.fetchSecurityStatus,
  invalidateConnectionConfigCache: mocks.invalidateConnectionConfigCache,
  isConnectionConfigStorageKey: mocks.isConnectionConfigStorageKey
}));

vi.mock("@api/realtime", () => ({
  handleLiveUpdatesClose: mocks.handleLiveUpdatesClose,
  openAccessMonitorSocket: mocks.openAccessMonitorSocket
}));

vi.mock("@api/transport/httpClient", () => ({
  API_UNAUTHORIZED_EVENT: "deskcue:api-unauthorized",
  isApiUnauthorizedError: (error: unknown) =>
    error instanceof Error && error.message === "unauthorized"
}));

vi.mock("./AccessCheckingScreen", () => ({
  AccessCheckingScreen: () => <div>Checking access</div>
}));

import { AccessGate } from "./AccessGate";

function createSocket() {
  return {
    close: vi.fn(),
    onclose: null,
    onerror: null,
    onopen: null
  } as unknown as WebSocket;
}

function LocationProbe() {
  const location = useLocation();

  return (
    <output data-testid="location">
      {JSON.stringify({
        hash: location.hash,
        pathname: location.pathname,
        search: location.search
      })}
    </output>
  );
}

function renderAccessGate(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AccessGate>
        <LocationProbe />
        <Routes>
          <Route path="/connect" element={<div>Connect page</div>} />
          <Route path="*" element={<div>Dashboard page</div>} />
        </Routes>
      </AccessGate>
    </MemoryRouter>
  );
}

function readRenderedLocation() {
  return JSON.parse(screen.getByTestId("location").textContent ?? "null") as {
    hash: string;
    pathname: string;
    search: string;
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((nextResolve) => {
      resolve = nextResolve;
    }),
    resolve
  };
}

describe("AccessGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleLiveUpdatesClose.mockReturnValue(false);
    mocks.isConnectionConfigStorageKey.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the access monitor after authorization and closes it on unmount", async () => {
    const socket = createSocket();
    mocks.fetchSecurityStatus.mockResolvedValue({});
    mocks.openAccessMonitorSocket.mockReturnValue(socket);

    const view = renderAccessGate("/");

    expect(await screen.findByText("Dashboard page")).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.openAccessMonitorSocket).toHaveBeenCalledTimes(1);
    });

    view.unmount();
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it("keeps authorized access after the access-check timeout window has elapsed", async () => {
    vi.useFakeTimers();
    const socket = createSocket();
    mocks.fetchSecurityStatus.mockResolvedValue({});
    mocks.openAccessMonitorSocket.mockReturnValue(socket);

    renderAccessGate("/");
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Dashboard page")).toBeInTheDocument();
    expect(mocks.openAccessMonitorSocket).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_001);
    });

    expect(screen.getByText("Dashboard page")).toBeInTheDocument();
    expect(screen.queryByText("Connect page")).not.toBeInTheDocument();
    expect(mocks.openAccessMonitorSocket).toHaveBeenCalledTimes(1);
    expect(socket.close).not.toHaveBeenCalled();
  });

  it("redirects an unauthorized route to connect and preserves the full return path", async () => {
    mocks.fetchSecurityStatus.mockRejectedValue(new Error("unauthorized"));

    renderAccessGate("/sessions/session-1?tab=activity#entry-2");

    expect(await screen.findByText("Connect page")).toBeInTheDocument();
    const location = readRenderedLocation();
    expect(location.pathname).toBe("/connect");
    expect(new URLSearchParams(location.search).get("from"))
      .toBe("/sessions/session-1?tab=activity#entry-2");
    expect(mocks.openAccessMonitorSocket).not.toHaveBeenCalled();
  });

  it("does not expose the dashboard after the bounded access check timeout", async () => {
    vi.useFakeTimers();
    mocks.fetchSecurityStatus.mockReturnValue(new Promise(() => undefined));
    mocks.openAccessMonitorSocket.mockReturnValue(createSocket());

    renderAccessGate("/");
    expect(screen.getByText("Checking access")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });

    expect(screen.getByText("Connect page")).toBeInTheDocument();
    expect(mocks.openAccessMonitorSocket).not.toHaveBeenCalled();
  });

  it("keeps a connection failure out of cached dashboard routes", async () => {
    mocks.fetchSecurityStatus.mockRejectedValue(new Error("network offline"));

    renderAccessGate("/");

    expect(await screen.findByText("Connect page")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard page")).not.toBeInTheDocument();
    expect(mocks.openAccessMonitorSocket).not.toHaveBeenCalled();
  });

  it("invalidates and rechecks access after a connection storage change", async () => {
    mocks.fetchSecurityStatus.mockResolvedValue({});
    mocks.openAccessMonitorSocket.mockReturnValue(createSocket());
    mocks.isConnectionConfigStorageKey.mockReturnValue(true);

    renderAccessGate("/");
    expect(await screen.findByText("Dashboard page")).toBeInTheDocument();
    expect(mocks.fetchSecurityStatus).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: "deskcue.accessDeviceId"
      }));
    });

    await waitFor(() => {
      expect(mocks.fetchSecurityStatus).toHaveBeenCalledTimes(2);
    });
    expect(mocks.invalidateConnectionConfigCache).toHaveBeenCalledTimes(1);
  });

  it("closes the old access socket while a changed daemon is verified", async () => {
    vi.useFakeTimers();
    const nextAccessCheck = deferred<object>();
    const firstSocket = createSocket();
    const secondSocket = createSocket();
    mocks.fetchSecurityStatus
      .mockResolvedValueOnce({})
      .mockReturnValueOnce(nextAccessCheck.promise);
    mocks.openAccessMonitorSocket
      .mockReturnValueOnce(firstSocket)
      .mockReturnValueOnce(secondSocket);

    renderAccessGate("/");
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Dashboard page")).toBeInTheDocument();
    expect(mocks.openAccessMonitorSocket).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event("deskcue:connection-config-changed"));
    });
    expect(screen.getByText("Checking access")).toBeInTheDocument();
    expect(firstSocket.close).toHaveBeenCalledTimes(1);

    await act(async () => {
      nextAccessCheck.resolve({});
      await nextAccessCheck.promise;
    });
    expect(screen.getByText("Dashboard page")).toBeInTheDocument();
    expect(mocks.openAccessMonitorSocket).toHaveBeenCalledTimes(2);

    act(() => {
      firstSocket.onclose?.(new CloseEvent("close"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(mocks.openAccessMonitorSocket).toHaveBeenCalledTimes(2);
  });
});
