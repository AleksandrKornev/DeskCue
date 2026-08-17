import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalLlmChatSummary } from "@deskcue/protocol";
import {
  API_UNAUTHORIZED_EVENT,
  CONNECTION_CONFIG_CHANGED_EVENT
} from "@api/connection/events";
import { LOCAL_LLM_CHAT_UPDATED_EVENT } from "@models/live/localLlmChatEvents";

const apiMocks = vi.hoisted(() => ({
  list: vi.fn<() => Promise<LocalLlmChatSummary[]>>()
}));

vi.mock("@api/endpoint/localLlmChats/endpoints", () => ({
  localLlmChatsApi: { list: apiMocks.list }
}));

import { useLocalLlmChatSummaries } from "./useLocalLlmChatSummaries";

function chat(id: string, runtimeId: LocalLlmChatSummary["runtimeId"]): LocalLlmChatSummary {
  return {
    agentMode: "ask",
    createdAt: "2026-08-05T00:00:00.000Z",
    generationError: null,
    generationState: "idle",
    id,
    model: "test-model",
    runtimeId,
    title: `Chat ${id}`,
    toolCapability: null,
    updatedAt: "2026-08-05T00:00:00.000Z",
    workspace: null
  };
}

describe("useLocalLlmChatSummaries", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiMocks.list.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reloads the summary list after local chat socket updates", async () => {
    const initial = [chat("ollama-1", "ollama")];
    const updated = [...initial, chat("lm-studio-1", "lm-studio")];
    apiMocks.list.mockResolvedValueOnce(initial).mockResolvedValueOnce(updated);

    const { result } = renderHook(() => useLocalLlmChatSummaries());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.chats).toEqual(initial);

    act(() => {
      window.dispatchEvent(new CustomEvent(LOCAL_LLM_CHAT_UPDATED_EVENT));
      vi.advanceTimersByTime(499);
    });
    expect(apiMocks.list).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(apiMocks.list).toHaveBeenCalledTimes(2);
    expect(result.current.chats).toEqual(updated);
  });

  it("does not restore an old daemon's summaries after authorization is cleared", async () => {
    let resolveList: ((value: LocalLlmChatSummary[]) => void) | undefined;
    apiMocks.list.mockImplementationOnce(() => new Promise((resolve) => {
      resolveList = resolve;
    }));

    const { result } = renderHook(() => useLocalLlmChatSummaries());
    act(() => {
      window.dispatchEvent(new CustomEvent(API_UNAUTHORIZED_EVENT));
    });
    await act(async () => {
      resolveList?.([chat("old-daemon", "ollama")]);
      await Promise.resolve();
    });

    expect(result.current.chats).toEqual([]);
    expect(apiMocks.list).toHaveBeenCalledTimes(1);
  });

  it("clears and reloads summaries when the daemon connection changes", async () => {
    const oldChats = [chat("old-daemon", "ollama")];
    const newChats = [chat("new-daemon", "lm-studio")];
    apiMocks.list.mockResolvedValueOnce(oldChats).mockResolvedValueOnce(newChats);

    const { result } = renderHook(() => useLocalLlmChatSummaries());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.chats).toEqual(oldChats);

    await act(async () => {
      window.dispatchEvent(new CustomEvent(CONNECTION_CONFIG_CHANGED_EVENT));
      await Promise.resolve();
    });

    expect(apiMocks.list).toHaveBeenCalledTimes(2);
    expect(result.current.chats).toEqual(newChats);
  });
});
