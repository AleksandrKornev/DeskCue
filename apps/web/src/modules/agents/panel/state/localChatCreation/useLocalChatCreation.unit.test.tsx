import {
  act,
  renderHook,
  waitFor
} from "@testing-library/react";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

import type {
  CreateLocalLlmChatInput,
  LocalLlmChatSummary,
  RuntimeSummary
} from "@deskcue/protocol";
import { CONNECTION_CONFIG_CHANGED_EVENT } from "@api/connection/events";

type RequestOptions = { signal?: AbortSignal };
type InstalledModelsResponse = {
  models: Array<{ displayName: string; modelKey: string }>;
};

const apiMocks = vi.hoisted(() => ({
  create: vi.fn<(
    input: CreateLocalLlmChatInput,
    options?: RequestOptions
  ) => Promise<LocalLlmChatSummary>>(),
  getLmStudioModels: vi.fn<(
    options?: RequestOptions
  ) => Promise<InstalledModelsResponse>>(),
  getOllamaModels: vi.fn<(
    options?: RequestOptions
  ) => Promise<InstalledModelsResponse>>(),
  startLmStudioServer: vi.fn<(
    options?: RequestOptions
  ) => Promise<{ runtime: RuntimeSummary }>>(),
  startOllamaServer: vi.fn<(
    options?: RequestOptions
  ) => Promise<{ runtime: RuntimeSummary }>>()
}));

vi.mock("@api/endpoint/dashboard/endpoints", () => ({
  dashboardApi: {
    getLmStudioModels: apiMocks.getLmStudioModels,
    getOllamaModels: apiMocks.getOllamaModels,
    startLmStudioServer: apiMocks.startLmStudioServer,
    startOllamaServer: apiMocks.startOllamaServer
  }
}));

vi.mock("@api/endpoint/localLlmChats/endpoints", () => ({
  localLlmChatsApi: {
    create: apiMocks.create
  }
}));

import { useLocalChatCreation } from "./useLocalChatCreation";

function createChatSummary(): LocalLlmChatSummary {
  return {
    agentMode: "full_access",
    createdAt: "2026-08-06T10:00:00.000Z",
    generationError: null,
    generationState: "idle",
    id: "chat-1",
    model: "publisher/model",
    runtimeId: "lm-studio",
    title: "New local chat",
    toolCapability: null,
    updatedAt: "2026-08-06T10:00:00.000Z",
    workspace: null
  };
}

function createLmStudioRuntime(): RuntimeSummary {
  return {
    chatCapability: "native_session",
    endpoint: "http://127.0.0.1:1234",
    id: "lm-studio",
    installed: true,
    label: "LM Studio",
    lastActiveModel: null,
    loadedModelCount: 0,
    modelCount: 1,
    modelStoragePath: ".lmstudio",
    modelStorageSource: "runtime",
    running: true,
    statusText: "0 loaded, 1 local model"
  };
}

function createOllamaRuntime(): RuntimeSummary {
  return {
    chatCapability: "history_replay",
    endpoint: "http://127.0.0.1:11434",
    id: "ollama",
    installed: true,
    label: "Ollama",
    lastActiveModel: null,
    loadedModelCount: 0,
    modelCount: 1,
    modelStoragePath: ".ollama/models",
    modelStorageSource: "default",
    running: true,
    statusText: "1 local model available"
  };
}

describe("useLocalChatCreation", () => {
  beforeEach(() => {
    apiMocks.create.mockReset();
    apiMocks.getLmStudioModels.mockReset();
    apiMocks.getOllamaModels.mockReset();
    apiMocks.startLmStudioServer.mockReset();
    apiMocks.startOllamaServer.mockReset();
    apiMocks.getLmStudioModels.mockResolvedValue({ models: [] });
    apiMocks.getOllamaModels.mockResolvedValue({ models: [] });
    apiMocks.startLmStudioServer.mockResolvedValue({ runtime: createLmStudioRuntime() });
    apiMocks.startOllamaServer.mockResolvedValue({ runtime: createOllamaRuntime() });
  });

  it("loads and normalizes installed Ollama models when opened", async () => {
    apiMocks.getOllamaModels.mockResolvedValue({
      models: [
        { displayName: " Zebra ", modelKey: " zebra:latest " },
        { displayName: "Alpha", modelKey: "alpha:latest" },
        { displayName: "Duplicate", modelKey: "alpha:latest" }
      ]
    });
    const { result } = renderHook(() => useLocalChatCreation({ onCreated: vi.fn() }));

    act(() => result.current.open());
    await waitFor(() => expect(result.current.catalog.status).toBe("ready"));

    expect(apiMocks.startOllamaServer).toHaveBeenCalledTimes(1);
    expect(apiMocks.getOllamaModels).toHaveBeenCalledTimes(1);
    expect(apiMocks.getOllamaModels.mock.calls[0]?.[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(result.current.catalog.models).toEqual([
      { displayName: "Alpha", modelKey: "alpha:latest" },
      { displayName: "Zebra", modelKey: "zebra:latest" }
    ]);
    expect(result.current.selectedModelKey).toBe("");
  });

  it("follows the runtime contract before exposing the model catalog", async () => {
    let resolveStart!: (value: { runtime: RuntimeSummary }) => void;
    let resolveModels!: (value: InstalledModelsResponse) => void;
    apiMocks.startOllamaServer.mockReturnValue(new Promise((resolve) => {
      resolveStart = resolve;
    }));
    apiMocks.getOllamaModels.mockReturnValue(new Promise((resolve) => {
      resolveModels = resolve;
    }));
    const { result } = renderHook(() => useLocalChatCreation({ onCreated: vi.fn() }));

    act(() => result.current.open());
    await waitFor(() => expect(result.current.catalog.status).toBe("starting_runtime"));
    expect(apiMocks.getOllamaModels).not.toHaveBeenCalled();

    act(() => resolveStart({ runtime: createOllamaRuntime() }));
    await waitFor(() => expect(result.current.catalog.status).toBe("loading_models"));
    expect(result.current.catalog.runtime?.id).toBe("ollama");

    act(() => resolveModels({
      models: [{ displayName: "Model", modelKey: "model" }]
    }));
    await waitFor(() => expect(result.current.catalog.status).toBe("ready"));
    expect(result.current.catalog.models).toEqual([
      { displayName: "Model", modelKey: "model" }
    ]);
  });

  it("aborts the previous catalog and rejects its late result after a runtime switch", async () => {
    let resolveOllama!: (value: { models: Array<{ displayName: string; modelKey: string }> }) => void;
    let resolveLmStudio!: (value: { models: Array<{ displayName: string; modelKey: string }> }) => void;
    apiMocks.getOllamaModels.mockReturnValue(new Promise((resolve) => {
      resolveOllama = resolve;
    }));
    apiMocks.getLmStudioModels.mockReturnValue(new Promise((resolve) => {
      resolveLmStudio = resolve;
    }));
    const { result } = renderHook(() => useLocalChatCreation({ onCreated: vi.fn() }));

    act(() => result.current.open());
    await waitFor(() => expect(apiMocks.getOllamaModels).toHaveBeenCalledTimes(1));
    const ollamaSignal = apiMocks.getOllamaModels.mock.calls[0]?.[0]?.signal;
    act(() => result.current.setRuntimeId("lm-studio"));

    expect(ollamaSignal?.aborted).toBe(true);
    await waitFor(() => expect(apiMocks.getLmStudioModels).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolveOllama({ models: [{ displayName: "Old", modelKey: "old" }] });
      resolveLmStudio({ models: [{ displayName: "Current", modelKey: "current" }] });
      await Promise.resolve();
    });
    expect(result.current.catalog.models).toEqual([
      { displayName: "Current", modelKey: "current" }
    ]);
  });

  it("creates the selected chat, forwards the workspace, closes and reports it", async () => {
    const onCreated = vi.fn();
    const chat = createChatSummary();
    apiMocks.create.mockResolvedValue(chat);
    apiMocks.getLmStudioModels.mockResolvedValue({
      models: [{ displayName: "Model", modelKey: "publisher/model" }]
    });
    const { result } = renderHook(() => useLocalChatCreation({ onCreated }));

    act(() => result.current.open());
    await waitFor(() => expect(result.current.catalog.status).toBe("ready"));
    act(() => {
      result.current.setRuntimeId("lm-studio");
      result.current.setSelectedModelKey("publisher/model");
      result.current.setWorkspaceId("workspace-1");
    });
    await waitFor(() => expect(result.current.catalog.status).toBe("ready"));
    let created: LocalLlmChatSummary | null = null;
    await act(async () => {
      created = await result.current.create();
    });

    const [input, options] = apiMocks.create.mock.calls[0] ?? [];
    expect(input).toEqual({
      runtimeId: "lm-studio",
      model: "publisher/model",
      workspaceId: "workspace-1"
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(created).toBe(chat);
    expect(onCreated).toHaveBeenCalledWith(chat);
    expect(result.current.isOpen).toBe(false);
    expect(result.current.submitting).toBe(false);
  });

  it("aborts an active catalog operation on close", async () => {
    apiMocks.getOllamaModels.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useLocalChatCreation({ onCreated: vi.fn() }));

    act(() => result.current.open());
    await waitFor(() => expect(apiMocks.getOllamaModels).toHaveBeenCalledTimes(1));
    const catalogSignal = apiMocks.getOllamaModels.mock.calls[0]?.[0]?.signal;
    act(() => result.current.close());

    expect(catalogSignal?.aborted).toBe(true);
    expect(result.current.isOpen).toBe(false);
  });

  it("aborts an active create operation on close", async () => {
    apiMocks.getOllamaModels.mockResolvedValue({
      models: [{ displayName: "Model", modelKey: "model" }]
    });
    apiMocks.create.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useLocalChatCreation({ onCreated: vi.fn() }));

    act(() => result.current.open());
    await waitFor(() => expect(result.current.catalog.status).toBe("ready"));
    act(() => result.current.setSelectedModelKey("model"));
    let submitSignal: AbortSignal | undefined;
    act(() => {
      void result.current.create();
      submitSignal = apiMocks.create.mock.calls[0]?.[1]?.signal;
    });
    act(() => result.current.close());

    expect(submitSignal?.aborted).toBe(true);
    expect(result.current.isOpen).toBe(false);
  });

  it("aborts stale daemon work and reloads the open runtime catalog", async () => {
    apiMocks.getOllamaModels
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce({
        models: [{ displayName: "New daemon model", modelKey: "new" }]
      });
    const { result } = renderHook(() => useLocalChatCreation({ onCreated: vi.fn() }));

    act(() => result.current.open());
    await waitFor(() => expect(apiMocks.getOllamaModels).toHaveBeenCalledTimes(1));
    const oldSignal = apiMocks.getOllamaModels.mock.calls[0]?.[0]?.signal;
    act(() => {
      result.current.setSelectedModelKey("old");
      result.current.setWorkspaceId("old-workspace");
      window.dispatchEvent(new Event(CONNECTION_CONFIG_CHANGED_EVENT));
    });
    await waitFor(() => expect(apiMocks.getOllamaModels).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.catalog.status).toBe("ready"));

    expect(oldSignal?.aborted).toBe(true);
    expect(result.current.catalog.models).toEqual([
      { displayName: "New daemon model", modelKey: "new" }
    ]);
    expect(result.current.selectedModelKey).toBe("");
    expect(result.current.workspaceId).toBe("");
  });

  it("does not publish a chat created by the previous daemon", async () => {
    let resolveCreate!: (chat: LocalLlmChatSummary) => void;
    const onCreated = vi.fn();
    apiMocks.create.mockReturnValue(new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    apiMocks.getOllamaModels.mockResolvedValue({
      models: [{ displayName: "Model", modelKey: "model" }]
    });
    const { result } = renderHook(() => useLocalChatCreation({ onCreated }));

    act(() => result.current.open());
    await waitFor(() => expect(result.current.catalog.status).toBe("ready"));
    act(() => result.current.setSelectedModelKey("model"));
    let createResult: Promise<LocalLlmChatSummary | null> | undefined;
    act(() => {
      createResult = result.current.create();
    });
    const oldSignal = apiMocks.create.mock.calls[0]?.[1]?.signal;
    act(() => {
      window.dispatchEvent(new Event(CONNECTION_CONFIG_CHANGED_EVENT));
    });
    await act(async () => {
      resolveCreate(createChatSummary());
      await createResult;
    });

    expect(oldSignal?.aborted).toBe(true);
    expect(onCreated).not.toHaveBeenCalled();
    expect(result.current.submitting).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("uses the preferred runtime for initial load and after reset", async () => {
    const { result } = renderHook(() => useLocalChatCreation({
      defaultRuntimeId: "lm-studio",
      onCreated: vi.fn()
    }));

    act(() => result.current.open());
    await waitFor(() => expect(result.current.catalog.status).toBe("ready"));
    expect(result.current.runtimeId).toBe("lm-studio");
    expect(apiMocks.startLmStudioServer).toHaveBeenCalledTimes(1);
    expect(apiMocks.getLmStudioModels).toHaveBeenCalledTimes(1);
    expect(result.current.catalog.runtime?.running).toBe(true);

    act(() => result.current.setRuntimeId("ollama"));
    await waitFor(() => expect(result.current.catalog.status).toBe("ready"));
    act(() => result.current.close());
    expect(result.current.runtimeId).toBe("lm-studio");
  });

  it("retries the full LM Studio wake-up flow after startup fails", async () => {
    apiMocks.startLmStudioServer
      .mockRejectedValueOnce(new Error("LM Studio is still waking"))
      .mockResolvedValueOnce({ runtime: createLmStudioRuntime() });
    apiMocks.getLmStudioModels.mockResolvedValue({
      models: [{ displayName: "Model", modelKey: "model" }]
    });
    const { result } = renderHook(() => useLocalChatCreation({
      defaultRuntimeId: "lm-studio",
      onCreated: vi.fn()
    }));

    act(() => result.current.open());
    await waitFor(() => expect(result.current.catalog.status).toBe("error"));
    expect(result.current.catalog.error).toBe("LM Studio is still waking");
    expect(apiMocks.getLmStudioModels).not.toHaveBeenCalled();

    act(() => result.current.retryCatalog());
    await waitFor(() => expect(result.current.catalog.status).toBe("ready"));

    expect(apiMocks.startLmStudioServer).toHaveBeenCalledTimes(2);
    expect(apiMocks.getLmStudioModels).toHaveBeenCalledTimes(1);
    expect(result.current.catalog.models).toEqual([{ displayName: "Model", modelKey: "model" }]);
    expect(result.current.catalog.error).toBeNull();
  });

  it("keeps model catalog failures separate from create failures", async () => {
    apiMocks.getOllamaModels.mockRejectedValue(new Error("Ollama catalog unavailable"));
    const { result } = renderHook(() => useLocalChatCreation({ onCreated: vi.fn() }));

    act(() => result.current.open());
    await waitFor(() => expect(result.current.catalog.status).toBe("error"));

    expect(result.current.catalog.error).toBe("Ollama catalog unavailable");
    expect(result.current.error).toBeNull();
    expect(result.current.canCreate).toBe(false);
  });

  it("finishes submitting and exposes a create failure separately", async () => {
    apiMocks.getOllamaModels.mockResolvedValue({
      models: [{ displayName: "Model", modelKey: "model" }]
    });
    apiMocks.create.mockRejectedValue(new Error("Chat creation failed"));
    const { result } = renderHook(() => useLocalChatCreation({ onCreated: vi.fn() }));

    act(() => result.current.open());
    await waitFor(() => expect(result.current.catalog.status).toBe("ready"));
    act(() => result.current.setSelectedModelKey("model"));
    await act(async () => {
      await result.current.create();
    });

    expect(result.current.submitting).toBe(false);
    expect(result.current.error).toBe("Chat creation failed");
    expect(result.current.catalog.error).toBeNull();
    expect(result.current.isOpen).toBe(true);
  });
});
