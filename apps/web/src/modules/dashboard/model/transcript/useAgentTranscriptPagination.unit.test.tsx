import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CONNECTION_CONFIG_CHANGED_EVENT } from "@api/connection/events";
import type { AgentSessionTranscriptPageResponse } from "@api/endpoint/agentSessions/types";

const apiMocks = vi.hoisted(() => ({
  getTranscriptPage: vi.fn()
}));

vi.mock("@api/endpoint/agentSessions/endpoints", () => ({
  agentSessionsApi: {
    getTranscriptPage: apiMocks.getTranscriptPage
  }
}));

import { MAX_AGENT_TRANSCRIPT_HISTORY_BYTES } from "./constants";
import { estimateAgentTranscriptPageBytes } from "./helpers";
import { useAgentTranscriptPagination } from "./useAgentTranscriptPagination";

function transcriptPage(): AgentSessionTranscriptPageResponse {
  return {
    entries: [],
    hasMore: false,
    transcriptView: {} as AgentSessionTranscriptPageResponse["transcriptView"]
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

describe("useAgentTranscriptPagination", () => {
  it("rejects an old daemon's transcript page after the connection changes", async () => {
    const pageRequest = deferred<AgentSessionTranscriptPageResponse>();

    apiMocks.getTranscriptPage.mockReset().mockReturnValue(pageRequest.promise);
    const mergeFetchedAgentSessionTranscriptPage = vi.fn();
    const store = { mergeFetchedAgentSessionTranscriptPage } as never;
    const { result } = renderHook(() => useAgentTranscriptPagination(store));

    let loadPromise!: Promise<number>;

    act(() => {
      loadPromise = result.current.loadMoreAgentSessionTranscript("codex:one", "entry-1");
      window.dispatchEvent(new CustomEvent(CONNECTION_CONFIG_CHANGED_EVENT));
    });
    await act(async () => {
      pageRequest.resolve({
        entries: [],
        hasMore: false,
        transcriptView: {} as AgentSessionTranscriptPageResponse["transcriptView"]
      });
      await loadPromise;
    });

    expect(mergeFetchedAgentSessionTranscriptPage).not.toHaveBeenCalled();
    expect(result.current.agentTranscriptHasMoreById.size).toBe(0);
    expect(result.current.agentTranscriptHistoryIncompleteById.size).toBe(0);
  });

  it("deduplicates concurrent requests for the same transcript cursor", async () => {
    const pageRequest = deferred<AgentSessionTranscriptPageResponse>();

    apiMocks.getTranscriptPage.mockReset().mockReturnValue(pageRequest.promise);
    const store = { mergeFetchedAgentSessionTranscriptPage: vi.fn() } as never;
    const { result } = renderHook(() => useAgentTranscriptPagination(store));

    let first!: Promise<number>;
    let duplicate!: Promise<number>;

    act(() => {
      first = result.current.loadMoreAgentSessionTranscript("codex:one", "entry-1");
      duplicate = result.current.loadMoreAgentSessionTranscript("codex:one", "entry-1");
    });

    await expect(duplicate).resolves.toBe(0);
    await act(async () => {
      pageRequest.resolve({
        entries: [],
        hasMore: false,
        transcriptView: {} as AgentSessionTranscriptPageResponse["transcriptView"]
      });
      await first;
    });

    expect(apiMocks.getTranscriptPage).toHaveBeenCalledTimes(1);
    expect(result.current.agentTranscriptHasMoreById.get("codex:one")).toBe(false);
    expect(result.current.agentTranscriptHistoryIncompleteById.get("codex:one")).toBe(false);
  });

  it("does not let an old connection release the new connection's cursor", async () => {
    const oldRequest = deferred<AgentSessionTranscriptPageResponse>();
    const currentRequest = deferred<AgentSessionTranscriptPageResponse>();

    apiMocks.getTranscriptPage
      .mockReset()
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(currentRequest.promise);
    const store = { mergeFetchedAgentSessionTranscriptPage: vi.fn() } as never;
    const { result } = renderHook(() => useAgentTranscriptPagination(store));

    let oldLoad!: Promise<number>;
    let currentLoad!: Promise<number>;

    act(() => {
      oldLoad = result.current.loadMoreAgentSessionTranscript("codex:one", "entry-1");
      window.dispatchEvent(new CustomEvent(CONNECTION_CONFIG_CHANGED_EVENT));
      currentLoad = result.current.loadMoreAgentSessionTranscript("codex:one", "entry-1");
    });
    await act(async () => {
      oldRequest.resolve(transcriptPage());
      await oldLoad;
    });

    let duplicate!: Promise<number>;

    act(() => {
      duplicate = result.current.loadMoreAgentSessionTranscript("codex:one", "entry-1");
    });

    await expect(duplicate).resolves.toBe(0);
    expect(apiMocks.getTranscriptPage).toHaveBeenCalledTimes(2);

    await act(async () => {
      currentRequest.resolve(transcriptPage());
      await currentLoad;
    });
  });

  it("stops at the finite explicit-history window without requesting a repeated cursor", async () => {
    apiMocks.getTranscriptPage.mockReset().mockResolvedValue({
      entries: [{ id: "entry", role: "assistant", text: "history" }],
      hasMore: true,
      transcriptView: {} as AgentSessionTranscriptPageResponse["transcriptView"]
    });
    const mergeFetchedAgentSessionTranscriptPage = vi.fn();
    const store = { mergeFetchedAgentSessionTranscriptPage } as never;
    const { result } = renderHook(() => useAgentTranscriptPagination(store));

    for (let page = 0; page < 4; page += 1) {
      await act(async () => {
        await result.current.loadMoreAgentSessionTranscript("codex:one", `entry-${page}`);
      });
    }

    await act(async () => {
      await result.current.loadMoreAgentSessionTranscript("codex:one", "entry-4");
    });

    expect(apiMocks.getTranscriptPage).toHaveBeenCalledTimes(4);
    expect(mergeFetchedAgentSessionTranscriptPage).toHaveBeenCalledTimes(4);
    expect(result.current.agentTranscriptHasMoreById.get("codex:one")).toBe(false);
    expect(result.current.agentTranscriptHistoryIncompleteById.get("codex:one")).toBe(true);
  });

  it("stops immediately when an accepted page exactly fills the byte budget", async () => {
    const page = {
      entries: [{ id: "entry", role: "assistant" as const, text: "" }],
      hasMore: true,
      transcriptView: {} as AgentSessionTranscriptPageResponse["transcriptView"]
    };

    const emptyPageBytes = estimateAgentTranscriptPageBytes(page);
    const remainingBytes = MAX_AGENT_TRANSCRIPT_HISTORY_BYTES - emptyPageBytes;

    expect(remainingBytes % 2).toBe(0);
    page.entries[0].text = "x".repeat(remainingBytes / 2);
    expect(estimateAgentTranscriptPageBytes(page)).toBe(MAX_AGENT_TRANSCRIPT_HISTORY_BYTES);

    apiMocks.getTranscriptPage.mockReset().mockResolvedValue(page);
    const mergeFetchedAgentSessionTranscriptPage = vi.fn();
    const store = { mergeFetchedAgentSessionTranscriptPage } as never;
    const { result } = renderHook(() => useAgentTranscriptPagination(store));

    await act(async () => {
      await result.current.loadMoreAgentSessionTranscript("codex:one", "entry-1");
    });
    await act(async () => {
      await result.current.loadMoreAgentSessionTranscript("codex:one", "entry-2");
    });

    expect(apiMocks.getTranscriptPage).toHaveBeenCalledTimes(1);
    expect(mergeFetchedAgentSessionTranscriptPage).toHaveBeenCalledTimes(1);
    expect(result.current.agentTranscriptHasMoreById.get("codex:one")).toBe(false);
    expect(result.current.agentTranscriptHistoryIncompleteById.get("codex:one")).toBe(true);
  });
});
