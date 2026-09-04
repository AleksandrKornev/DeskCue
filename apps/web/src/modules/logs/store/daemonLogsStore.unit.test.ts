import { beforeEach, describe, expect, it, vi } from "vitest";

import { daemonApi } from "@api/endpoint/daemon/endpoints";

import { DaemonLogsStore } from "./daemonLogsStore";

vi.mock("@api/endpoint/daemon/endpoints", () => ({
  daemonApi: {
    getLogs: vi.fn()
  }
}));

function logsResponse(message: string) {
  return {
    entries: [{
      context: null,
      level: "info" as const,
      message,
      timestamp: "2026-08-06T00:00:00.000Z"
    }],
    filePath: "deskcue.log",
    truncated: false
  };
}

describe("DaemonLogsStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not apply an old daemon response after the connection changes", async () => {
    let resolveOld!: (value: ReturnType<typeof logsResponse>) => void;

    vi.mocked(daemonApi.getLogs)
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveOld = resolve;
      }))
      .mockResolvedValueOnce(logsResponse("new daemon"));
    const store = new DaemonLogsStore();

    store.loadOnMount();
    store.handleConnectionConfigChanged();
    await vi.waitFor(() => {
      expect(store.entries[0]?.message).toBe("new daemon");
    });

    resolveOld(logsResponse("old daemon"));
    await Promise.resolve();

    expect(store.entries[0]?.message).toBe("new daemon");
  });

  it("marks load failures as errors and clears the error after recovery", async () => {
    vi.mocked(daemonApi.getLogs)
      .mockRejectedValueOnce(new Error("Daemon logs unavailable"))
      .mockResolvedValueOnce(logsResponse("recovered"));
    const store = new DaemonLogsStore();

    await store.refresh();

    expect(store.status).toBe("Daemon logs unavailable");
    expect(store.statusIsError).toBe(true);

    await store.refresh();

    expect(store.status).toBe("");
    expect(store.statusIsError).toBe(false);
  });

  it("exposes background refresh activity without clearing an existing error", async () => {
    let rejectRefresh!: (error: Error) => void;

    vi.mocked(daemonApi.getLogs)
      .mockRejectedValueOnce(new Error("Daemon logs unavailable"))
      .mockReturnValueOnce(new Promise((_, reject) => {
        rejectRefresh = reject;
      }));
    const store = new DaemonLogsStore();

    await store.refresh();
    const backgroundRefresh = store.refresh(false);

    expect(store.refreshing).toBe(true);
    expect(store.loading).toBe(false);
    expect(store.status).toBe("Daemon logs unavailable");
    expect(store.statusIsError).toBe(true);

    rejectRefresh(new Error("Daemon logs unavailable"));
    await backgroundRefresh;

    expect(store.refreshing).toBe(false);
    expect(store.status).toBe("Daemon logs unavailable");
    expect(store.statusIsError).toBe(true);
  });
});
