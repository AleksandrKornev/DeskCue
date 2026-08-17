import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalLlmChatDetail } from "@deskcue/protocol";

import { useLocalLlmChatController } from "./useLocalLlmChatController";

const apiMocks = vi.hoisted(() => ({
  get: vi.fn()
}));

vi.mock("@api/endpoint/localLlmChats/endpoints", () => ({
  localLlmChatsApi: {
    get: apiMocks.get
  }
}));

function createDetail(
  id: string,
  generationState: LocalLlmChatDetail["generationState"],
  updatedAt: string
): LocalLlmChatDetail {
  return {
    actionRequests: [],
    agentMode: "read_only",
    changeSets: [],
    createdAt: "2026-08-06T00:00:00.000Z",
    events: [],
    generationError: null,
    generationState,
    history: {
      changeSets: { hasMore: false, nextCursor: null },
      events: { hasMore: false, nextCursor: null },
      messages: { hasMore: false, nextCursor: null }
    },
    id,
    messages: [],
    model: "test-model",
    pendingAssistantText: null,
    pendingLmStudioPrompt: null,
    runtimeId: "ollama",
    title: id,
    toolCapability: null,
    updatedAt,
    workspace: null
  };
}

function createMessage(id: string, timestamp: string) {
  return {
    id,
    role: "assistant" as const,
    status: "complete" as const,
    text: id,
    timestamp
  };
}

describe("useLocalLlmChatController", () => {
  beforeEach(() => {
    apiMocks.get.mockReset();
  });

  it("reports a refresh discarded by an in-flight mutation as retryable", async () => {
    const initial = createDetail("chat-1", "idle", "initial");
    apiMocks.get.mockResolvedValue(initial);
    const { result } = renderHook(() => useLocalLlmChatController("chat-1"));
    await waitFor(() => expect(result.current.detail?.updatedAt).toBe("initial"));

    let resolveMutation!: (detail: LocalLlmChatDetail) => void;
    const mutationResponse = new Promise<LocalLlmChatDetail>((resolve) => {
      resolveMutation = resolve;
    });
    let mutationPromise!: Promise<LocalLlmChatDetail>;
    act(() => {
      mutationPromise = result.current.mutateDetail(() => mutationResponse);
    });

    apiMocks.get.mockResolvedValueOnce(createDetail("chat-1", "idle", "terminal"));
    let refreshResult: LocalLlmChatDetail | null = initial;
    await act(async () => {
      refreshResult = await result.current.refresh();
    });
    expect(refreshResult).toBeNull();
    expect(result.current.detail?.updatedAt).toBe("initial");

    await act(async () => {
      resolveMutation(createDetail("chat-1", "running", "mutation"));
      await mutationPromise;
    });
    expect(result.current.detail?.updatedAt).toBe("mutation");
  });

  it("does not accept an old A mutation after switching A-B-A", async () => {
    apiMocks.get.mockImplementation((chatId: string) =>
      Promise.resolve(createDetail(chatId, "idle", `initial-${chatId}`))
    );
    const { rerender, result } = renderHook(
      ({ chatId }) => useLocalLlmChatController(chatId),
      { initialProps: { chatId: "chat-a" } }
    );
    await waitFor(() => expect(result.current.detail?.updatedAt).toBe("initial-chat-a"));

    let resolveOldMutation!: (detail: LocalLlmChatDetail) => void;
    const oldMutationResponse = new Promise<LocalLlmChatDetail>((resolve) => {
      resolveOldMutation = resolve;
    });
    let oldMutationPromise!: Promise<LocalLlmChatDetail>;
    act(() => {
      oldMutationPromise = result.current.mutateDetail(() => oldMutationResponse);
    });

    rerender({ chatId: "chat-b" });
    await waitFor(() => expect(result.current.detail?.id).toBe("chat-b"));
    rerender({ chatId: "chat-a" });
    await waitFor(() => expect(result.current.detail?.updatedAt).toBe("initial-chat-a"));

    let resolveNewMutation!: (detail: LocalLlmChatDetail) => void;
    const newMutationResponse = new Promise<LocalLlmChatDetail>((resolve) => {
      resolveNewMutation = resolve;
    });
    let newMutationPromise!: Promise<LocalLlmChatDetail>;
    act(() => {
      newMutationPromise = result.current.mutateDetail(() => newMutationResponse);
    });

    await act(async () => {
      resolveOldMutation(createDetail("chat-a", "idle", "stale-old-a"));
      await oldMutationPromise;
    });
    expect(result.current.detail?.updatedAt).toBe("initial-chat-a");

    await act(async () => {
      resolveNewMutation(createDetail("chat-a", "running", "new-a"));
      await newMutationPromise;
    });
    expect(result.current.detail?.updatedAt).toBe("new-a");
  });

  it("stops at the finite history window without advancing another cursor", async () => {
    let historyPage = 0;
    apiMocks.get.mockImplementation((chatId: string, options?: { tail?: string }) => {
      if (options?.tail !== "history") {
        return Promise.resolve({
          ...createDetail(chatId, "idle", "initial"),
          history: {
            changeSets: { hasMore: false, nextCursor: null },
            events: { hasMore: false, nextCursor: null },
            messages: { hasMore: true, nextCursor: "cursor-0" }
          }
        });
      }
      historyPage += 1;
      return Promise.resolve({
        ...createDetail(chatId, "idle", `history-${historyPage}`),
        history: {
          changeSets: { hasMore: false, nextCursor: null },
          events: { hasMore: false, nextCursor: null },
          messages: { hasMore: true, nextCursor: `cursor-${historyPage}` }
        },
        messages: [{
          id: `history-message-${historyPage}`,
          role: "assistant",
          status: "complete",
          text: `history ${historyPage}`,
          timestamp: `2026-08-0${historyPage}T00:00:00.000Z`
        }]
      });
    });
    const { result } = renderHook(() => useLocalLlmChatController("chat-1"));
    await waitFor(() => expect(result.current.detail?.updatedAt).toBe("initial"));

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await act(async () => {
        await result.current.loadEarlierHistory();
      });
    }
    expect(result.current.historyWindowFull).toBe(true);
    expect(result.current.detail?.history.messages.nextCursor).toBe("cursor-4");

    await act(async () => {
      await expect(result.current.loadEarlierHistory()).resolves.toBe(0);
    });
    expect(historyPage).toBe(4);
    expect(result.current.detail?.history.messages.nextCursor).toBe("cursor-4");
  });

  it("keeps explicitly loaded history after a compact mutation response", async () => {
    const initial = {
      ...createDetail("chat-1", "idle", "initial"),
      history: {
        changeSets: { hasMore: false, nextCursor: null },
        events: { hasMore: false, nextCursor: null },
        messages: { hasMore: true, nextCursor: "cursor-0" }
      }
    };
    const historyPage = {
      ...createDetail("chat-1", "idle", "history"),
      history: {
        changeSets: { hasMore: false, nextCursor: null },
        events: { hasMore: false, nextCursor: null },
        messages: { hasMore: true, nextCursor: "cursor-1" }
      },
      messages: [createMessage("history-message", "2026-08-01T00:00:00.000Z")]
    };
    apiMocks.get
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(historyPage);
    const { result } = renderHook(() => useLocalLlmChatController("chat-1"));
    await waitFor(() => expect(result.current.detail?.updatedAt).toBe("initial"));

    await act(async () => {
      await result.current.loadEarlierHistory();
    });
    expect(result.current.detail?.messages.map((message) => message.id))
      .toContain("history-message");

    const mutationResponse = {
      ...createDetail("chat-1", "idle", "mutation"),
      messages: [createMessage("mutation-message", "2026-08-06T00:00:00.000Z")]
    };
    await act(async () => {
      await result.current.mutateDetail(() => Promise.resolve(mutationResponse));
    });

    expect(result.current.detail?.messages.map((message) => message.id))
      .toEqual(["history-message", "mutation-message"]);
    expect(result.current.detail?.history.messages.nextCursor).toBe("cursor-1");
  });
});
