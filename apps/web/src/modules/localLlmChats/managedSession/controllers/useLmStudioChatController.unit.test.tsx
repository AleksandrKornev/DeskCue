import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalLlmChatDetail, RuntimeSummary } from "@deskcue/protocol";
import type { LmStudioInstalledModel } from "@api/endpoint/dashboard/endpoints";

import { useLmStudioChatController } from "./useLmStudioChatController";

const apiMocks = vi.hoisted(() => ({
  discardPendingLmStudioPrompt: vi.fn(),
  getLmStudioModels: vi.fn(),
  prepareLmStudioModel: vi.fn(),
  send: vi.fn(),
  updateModel: vi.fn()
}));

vi.mock("@api/endpoint/dashboard/endpoints", () => ({
  dashboardApi: {
    getLmStudioModels: apiMocks.getLmStudioModels,
    prepareLmStudioModel: apiMocks.prepareLmStudioModel
  }
}));

vi.mock("@api/endpoint/localLlmChats/endpoints", () => ({
  localLlmChatsApi: {
    discardPendingLmStudioPrompt: apiMocks.discardPendingLmStudioPrompt,
    send: apiMocks.send,
    updateModel: apiMocks.updateModel
  }
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function createDetail(
  id: string,
  model: string,
  withPendingPrompt: boolean
): LocalLlmChatDetail {
  return {
    actionRequests: [],
    agentMode: "read_only",
    changeSets: [],
    createdAt: "2026-08-06T00:00:00.000Z",
    events: [],
    generationError: null,
    generationState: "idle",
    history: {
      changeSets: { hasMore: false, nextCursor: null },
      events: { hasMore: false, nextCursor: null },
      messages: { hasMore: false, nextCursor: null }
    },
    id,
    messages: [],
    model,
    pendingAssistantText: null,
    pendingLmStudioPrompt: withPendingPrompt
      ? {
        reason: "server_off",
        requestedAt: "2026-08-06T00:00:00.000Z",
        text: "test prompt"
      }
      : null,
    runtimeId: "lm-studio",
    title: id,
    toolCapability: null,
    updatedAt: "2026-08-06T00:00:00.000Z",
    workspace: null
  };
}

function createRuntime(modelKey: string): RuntimeSummary {
  return {
    endpoint: "http://127.0.0.1:1234",
    id: "lm-studio",
    installed: true,
    label: "LM Studio",
    lastActiveModel: modelKey,
    loadedModelCount: 1,
    modelCount: 2,
    running: true,
    statusText: "Ready"
  };
}

function createInstalledModels(): LmStudioInstalledModel[] {
  return ["model-a", "model-b"].map((modelKey) => ({
    displayName: modelKey,
    modelKey,
    path: `C:\\models\\${modelKey}`
  }));
}

function createPreparedModel(modelKey: string) {
  return {
    alreadyRunning: false,
    model: createInstalledModels().find((model) => model.modelKey === modelKey)!,
    modelLoadRequested: true,
    runtime: createRuntime(modelKey),
    startRequested: true
  };
}

describe("useLmStudioChatController ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not revive an old prepared prompt after an A-B-A chat switch", async () => {
    const preparing = createDeferred<ReturnType<typeof createPreparedModel>>();
    apiMocks.prepareLmStudioModel.mockReturnValue(preparing.promise);
    const mutateDetail = vi.fn(async (
      mutation: () => Promise<LocalLlmChatDetail>
    ) => mutation());
    const setError = vi.fn();
    const detailA = createDetail("chat-a", "model-a", true);
    const detailB = createDetail("chat-b", "model-b", false);
    const { rerender, result } = renderHook(
      ({ chatId, detail }) => useLmStudioChatController({
        chatId,
        detail,
        mutateDetail,
        runtime: null,
        setError
      }),
      { initialProps: { chatId: detailA.id, detail: detailA } }
    );

    let prepareAndSend!: Promise<void>;
    act(() => {
      prepareAndSend = result.current.startAndSendPendingPrompt();
    });
    expect(result.current.starting).toBe(true);
    setError.mockClear();

    rerender({ chatId: detailB.id, detail: detailB });
    await waitFor(() => expect(result.current.starting).toBe(false));
    rerender({ chatId: detailA.id, detail: detailA });

    await act(async () => {
      preparing.resolve(createPreparedModel("model-a"));
      await prepareAndSend;
    });

    expect(mutateDetail).not.toHaveBeenCalled();
    expect(apiMocks.send).not.toHaveBeenCalled();
    expect(setError).not.toHaveBeenCalled();
  });

  it("ignores an older model-dialog response after switching chats", async () => {
    const modelsForA = createDeferred<{ models: LmStudioInstalledModel[] }>();
    const modelsForB = createDeferred<{ models: LmStudioInstalledModel[] }>();
    apiMocks.getLmStudioModels
      .mockReturnValueOnce(modelsForA.promise)
      .mockReturnValueOnce(modelsForB.promise);
    const detailA = createDetail("chat-a", "model-a", false);
    const detailB = createDetail("chat-b", "model-b", false);
    const mutateDetail = vi.fn();
    const setError = vi.fn();
    const { rerender, result } = renderHook(
      ({ chatId, detail }) => useLmStudioChatController({
        chatId,
        detail,
        mutateDetail,
        runtime: null,
        setError
      }),
      { initialProps: { chatId: detailA.id, detail: detailA } }
    );

    act(() => result.current.setModelDialogOpen(true));
    await waitFor(() => expect(apiMocks.getLmStudioModels).toHaveBeenCalledTimes(1));

    rerender({ chatId: detailB.id, detail: detailB });
    act(() => result.current.setModelDialogOpen(true));
    await waitFor(() => expect(apiMocks.getLmStudioModels).toHaveBeenCalledTimes(2));

    await act(async () => {
      modelsForB.resolve({ models: createInstalledModels() });
      await modelsForB.promise;
    });
    expect(result.current.selectedModelKey).toBe("model-b");

    await act(async () => {
      modelsForA.resolve({ models: createInstalledModels() });
      await modelsForA.promise;
    });
    expect(result.current.selectedModelKey).toBe("model-b");
  });
});
