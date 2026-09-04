import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CloudConnectionStatusResponse } from "@deskcue/protocol";

const cloudMocks = vi.hoisted(() => ({
  getConnection: vi.fn()
}));

vi.mock("@api/endpoint/cloud/endpoints", () => ({
  cloudApi: {
    getConnection: cloudMocks.getConnection
  }
}));

import { useCloudConnectionStatus } from "./useCloudConnectionStatus";

function createDeferred<T>() {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });

  return { promise, reject, resolve };
}

function createStatus(displayName: string): CloudConnectionStatusResponse {
  return {
    cloudOrigin: "https://cloud.example.test",
    connected: true,
    connectorIncluded: true,
    displayName,
    enabled: true,
    lastConnectedAt: null,
    lastErrorCode: null,
    machineId: "machine-1",
    pendingEventCount: 0,
    remoteControlEnabled: false,
    remoteFilesEnabled: false,
    remotePreviewEnabled: false,
    remoteReadEnabled: false,
    sessionLabelDisclosureEnabled: false,
    state: "connected"
  };
}

describe("useCloudConnectionStatus", () => {
  beforeEach(() => {
    cloudMocks.getConnection.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the newest refresh result when requests resolve out of order", async () => {
    const olderRequest = createDeferred<CloudConnectionStatusResponse>();
    const newerRequest = createDeferred<CloudConnectionStatusResponse>();

    cloudMocks.getConnection
      .mockReturnValueOnce(olderRequest.promise)
      .mockReturnValueOnce(newerRequest.promise);

    const view = renderHook(() => useCloudConnectionStatus());

    await waitFor(() => expect(cloudMocks.getConnection).toHaveBeenCalledOnce());

    act(() => {
      void view.result.current.refresh();
    });
    await act(async () => {
      newerRequest.resolve(createStatus("Newer status"));
      await newerRequest.promise;
    });

    expect(view.result.current.status?.displayName).toBe("Newer status");
    expect(view.result.current.loading).toBe(false);

    await act(async () => {
      olderRequest.resolve(createStatus("Older status"));
      await olderRequest.promise;
    });

    expect(view.result.current.status?.displayName).toBe("Newer status");
    view.unmount();
  });

  it("exposes pending state and ignores a stale failure after a newer success", async () => {
    const olderRequest = createDeferred<CloudConnectionStatusResponse>();
    const newerRequest = createDeferred<CloudConnectionStatusResponse>();

    cloudMocks.getConnection
      .mockReturnValueOnce(olderRequest.promise)
      .mockReturnValueOnce(newerRequest.promise);

    const view = renderHook(() => useCloudConnectionStatus());

    await waitFor(() => expect(cloudMocks.getConnection).toHaveBeenCalledOnce());

    act(() => {
      void view.result.current.refresh();
    });

    expect(view.result.current.loading).toBe(true);

    await act(async () => {
      newerRequest.resolve(createStatus("Current status"));
      await newerRequest.promise;
    });
    await act(async () => {
      olderRequest.reject(new Error("stale failure"));

      try {
        await olderRequest.promise;
      } catch {
        // The hook consumes this stale rejection and must not expose it.
      }
    });

    expect(view.result.current.error).toBeNull();
    expect(view.result.current.status?.displayName).toBe("Current status");
    view.unmount();
  });

  it("keeps an authoritative mutation result over an older status refresh", async () => {
    const olderRequest = createDeferred<CloudConnectionStatusResponse>();

    cloudMocks.getConnection.mockReturnValueOnce(olderRequest.promise);

    const view = renderHook(() => useCloudConnectionStatus());

    await waitFor(() => expect(cloudMocks.getConnection).toHaveBeenCalledOnce());

    act(() => {
      view.result.current.setStatus({
        ...createStatus("Disconnected by mutation"),
        connected: false,
        enabled: false,
        state: "disconnected"
      });
    });

    await act(async () => {
      olderRequest.resolve(createStatus("Stale connected poll"));
      await olderRequest.promise;
    });

    expect(view.result.current.status?.displayName).toBe("Disconnected by mutation");
    expect(view.result.current.status?.enabled).toBe(false);
    expect(view.result.current.loading).toBe(false);
    view.unmount();
  });

  it("keeps a failed status hidden until a retry succeeds", async () => {
    const retryRequest = createDeferred<CloudConnectionStatusResponse>();

    cloudMocks.getConnection
      .mockResolvedValueOnce(createStatus("Initially connected"))
      .mockRejectedValueOnce(new Error("Cloud offline"))
      .mockReturnValueOnce(retryRequest.promise);

    const view = renderHook(() => useCloudConnectionStatus());

    await waitFor(() => expect(view.result.current.status?.displayName).toBe("Initially connected"));

    await act(async () => {
      await view.result.current.refresh();
    });

    expect(view.result.current.error).toBe("Cloud offline");
    expect(view.result.current.status?.displayName).toBe("Initially connected");

    act(() => {
      void view.result.current.refresh();
    });

    expect(view.result.current.loading).toBe(true);
    expect(view.result.current.error).toBe("Cloud offline");

    await act(async () => {
      retryRequest.resolve(createStatus("Recovered connection"));
      await retryRequest.promise;
    });

    expect(view.result.current.error).toBeNull();
    expect(view.result.current.status?.displayName).toBe("Recovered connection");
    view.unmount();
  });
});
