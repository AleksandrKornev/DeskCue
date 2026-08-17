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
    store.resetForConnectionChange();
    store.loadOnMount();
    await vi.waitFor(() => {
      expect(store.entries[0]?.message).toBe("new daemon");
    });

    resolveOld(logsResponse("old daemon"));
    await Promise.resolve();

    expect(store.entries[0]?.message).toBe("new daemon");
  });
});
