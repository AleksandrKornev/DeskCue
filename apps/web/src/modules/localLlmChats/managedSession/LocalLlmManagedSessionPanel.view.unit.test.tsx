import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import type { SubmitEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalLlmChatDetail } from "@deskcue/protocol";
import { localLlmChatsApi } from "@api/endpoint/localLlmChats/endpoints";
import type { ManagedSessionPanelProps } from "@modules/session/types";

import { LocalLlmManagedSessionPanel } from "./LocalLlmManagedSessionPanel";

type CapturedManagedSessionPanelProps = Omit<ManagedSessionPanelProps, "onSetPreview"> & {
  onSetPreview: (event: SubmitEvent<HTMLFormElement>) => Promise<void>;
};

const controller = vi.hoisted(() => ({
  detail: null as LocalLlmChatDetail | null,
  error: "private local runtime transport detail",
  historyWindowFull: false,
  hydrateChangeSet: vi.fn(),
  loadEarlierHistory: vi.fn(),
  localLiveConnection: { lastSyncedAt: null, status: "offline" },
  mutateDetail: vi.fn(),
  refresh: vi.fn(),
  refreshByChatId: new Map<
    string,
    (tail?: "initial" | "live") => Promise<LocalLlmChatDetail | null>
  >(),
  setError: vi.fn()
}));
const managedSessionPanel = vi.hoisted(() => ({
  props: null as CapturedManagedSessionPanelProps | null
}));

vi.mock("./controllers/useLocalLlmChatController", () => ({
  useLocalLlmChatController: (chatId: string) => ({
    ...controller,
    refresh: controller.refreshByChatId.get(chatId) ?? controller.refresh
  })
}));

vi.mock("./controllers/useLmStudioChatController", () => ({
  useLmStudioChatController: () => ({
    activeRuntime: null,
    discardPendingPrompt: vi.fn(),
    modelDialogOpen: false,
    models: null,
    selectedModelKey: "",
    setModelDialogOpen: vi.fn(),
    setSelectedModelKey: vi.fn(),
    startAndSendPendingPrompt: vi.fn(),
    starting: false,
    updateModel: vi.fn(),
    updatingModel: false
  })
}));

vi.mock("./localLlmManagedSessionAdapter", () => ({
  buildLocalSessionAdapter: (detail: LocalLlmChatDetail) => ({
    agentSession: { id: `local-llm:${detail.id}`, transcript: [] },
    detail,
    session: { id: `local-llm:${detail.id}` }
  }),
  hasMoreLocalLlmHistory: () => false
}));

vi.mock("./LocalLlmManagedSessionDialogs", () => ({
  LocalLlmManagedSessionDialogs: () => null
}));

vi.mock("@modules/session/index", () => ({
  ManagedSessionPanel: (props: CapturedManagedSessionPanelProps) => {
    managedSessionPanel.props = props;

    return <div>Recovered local chat content</div>;
  }
}));

function getManagedSessionPanelProps(): CapturedManagedSessionPanelProps {
  if (!managedSessionPanel.props) throw new Error("Expected ManagedSessionPanel to render");

  return managedSessionPanel.props;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

function submitWithReactEvent<Result>(
  action: (event: SubmitEvent<HTMLFormElement>) => Result
): Result {
  let result!: Result;
  let submitted = false;
  const view = render(
    <form
      aria-label="Test submit"
      onSubmit={(event) => {
        result = action(event);
        submitted = true;
      }}
    >
      <button type="submit">Submit</button>
    </form>
  );

  const form = view.getByRole("form", { name: "Test submit" });
  const submitter = view.getByRole("button", { name: "Submit" });

  fireEvent(form, new globalThis.SubmitEvent("submit", {
    bubbles: true,
    cancelable: true,
    submitter
  }));
  view.unmount();
  if (!submitted) throw new Error("Expected the React submit handler to run");

  return result;
}

function createDetail(id: string): LocalLlmChatDetail {
  return {
    actionRequests: [],
    agentMode: "read_only",
    changeSets: [],
    createdAt: "2026-08-30T10:00:00.000Z",
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
    model: "qwen3:4b",
    pendingAssistantText: null,
    pendingLmStudioPrompt: null,
    runtimeId: "ollama",
    title: "Recovered chat",
    toolCapability: null,
    updatedAt: "2026-08-30T10:00:00.000Z",
    workspace: null
  };
}

describe("LocalLlmManagedSessionPanel initial load recovery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    Object.assign(controller, {
      detail: null,
      error: "private local runtime transport detail"
    });

    controller.refresh.mockReset();
    controller.refreshByChatId.clear();
    controller.setError.mockReset();
    controller.mutateDetail.mockReset();
    managedSessionPanel.props = null;
  });

  it("shows safe recovery copy and retries the initial detail request", () => {
    controller.refresh.mockResolvedValue(null);
    const onExit = vi.fn();

    render(
      <LocalLlmManagedSessionPanel
        chatId="chat-1"
        runtimes={[]}
        workspaces={[]}
        onExit={onExit}
      />
    );

    const alert = screen.getByRole("alert");

    expect(alert).toHaveTextContent("Session unavailable");
    expect(alert).toHaveTextContent(
      "The local chat may have changed or its runtime may be unavailable."
    );

    expect(alert).not.toHaveTextContent("private local runtime transport detail");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(controller.refresh).toHaveBeenCalledWith("initial");

    fireEvent.click(screen.getByRole("button", { name: "Back to chats" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("does not render detail owned by the previous route chat", () => {
    Object.assign(controller, { detail: createDetail("chat-a"), error: null });

    render(
      <LocalLlmManagedSessionPanel
        chatId="chat-b"
        runtimes={[]}
        workspaces={[]}
        onExit={vi.fn()}
      />
    );

    expect(screen.queryByLabelText("Local chat loaded")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading local chat" })).toBeInTheDocument();
  });

  it("keeps field validation out of the global error channel", async () => {
    Object.assign(controller, { detail: createDetail("chat-1"), error: null });

    render(
      <LocalLlmManagedSessionPanel
        chatId="chat-1"
        runtimes={[]}
        workspaces={[]}
        onExit={vi.fn()}
      />
    );

    act(() => {
      getManagedSessionPanelProps().onChangePreviewPort("70000");
    });

    void submitWithReactEvent(getManagedSessionPanelProps().onSetPreview);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await act(async () => {
      expect(await getManagedSessionPanelProps()
        .onChangePreviewNetworkMode("deskcue-host")).toBe(false);
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    act(() => {
      getManagedSessionPanelProps().onChangePreviewPort("5173");
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(controller.setError).not.toHaveBeenCalled();
  });

  it("does not restore a stale preview failure after the port changes", async () => {
    let rejectPreview: ((reason: Error) => void) | undefined;

    Object.assign(controller, { detail: createDetail("chat-1"), error: null });

    controller.mutateDetail.mockImplementation(() => new Promise((_resolve, reject) => {
      rejectPreview = reject;
    }));

    render(
      <LocalLlmManagedSessionPanel
        chatId="chat-1"
        runtimes={[]}
        workspaces={[]}
        onExit={vi.fn()}
      />
    );

    act(() => {
      getManagedSessionPanelProps().onChangePreviewPort("5173");
    });

    const update = submitWithReactEvent(getManagedSessionPanelProps().onSetPreview);

    act(() => {
      getManagedSessionPanelProps().onChangePreviewPort("3000");
    });

    await act(async () => {
      rejectPreview?.(new Error("old preview request failed"));
      await update;
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(controller.setError).not.toHaveBeenCalled();
  });

  it("does not replace a newer preview draft when an older request succeeds", async () => {
    let resolvePreview!: (detail: LocalLlmChatDetail) => void;
    const initialDetail = createDetail("chat-1");
    const previewResponse = {
      ...initialDetail,
      preview: {
        active: true,
        networkMode: "device-direct" as const,
        port: 5173,
        targetUrl: "http://127.0.0.1:5173"
      }
    };

    const previewRequest = new Promise<LocalLlmChatDetail>((resolve) => {
      resolvePreview = resolve;
    });

    Object.assign(controller, { detail: initialDetail, error: null });
    vi.spyOn(localLlmChatsApi, "updatePreview").mockReturnValue(previewRequest);

    controller.mutateDetail.mockImplementation(async (mutation: () => Promise<LocalLlmChatDetail>) => {
      const nextDetail = await mutation();

      controller.detail = nextDetail;
      return nextDetail;
    });

    const view = render(
      <LocalLlmManagedSessionPanel
        chatId="chat-1"
        runtimes={[]}
        workspaces={[]}
        onExit={vi.fn()}
      />
    );

    act(() => {
      getManagedSessionPanelProps().onChangePreviewPort("5173");
    });

    const update = submitWithReactEvent(getManagedSessionPanelProps().onSetPreview);

    act(() => {
      getManagedSessionPanelProps().onChangePreviewPort("3000");
    });

    await act(async () => {
      resolvePreview(previewResponse);
      await update;
    });

    view.rerender(
      <LocalLlmManagedSessionPanel
        chatId="chat-1"
        runtimes={[]}
        workspaces={[]}
        onExit={vi.fn()}
      />
    );

    expect(managedSessionPanel.props?.previewPort).toBe("3000");
  });

  it("serializes configure and network-mode changes with the latest preview port", async () => {
    const configureRequest = deferred<LocalLlmChatDetail>();
    const networkModeRequest = deferred<LocalLlmChatDetail>();
    const initialDetail = createDetail("chat-1");
    let activeRequests = 0;
    let maxActiveRequests = 0;

    Object.assign(controller, { detail: initialDetail, error: null });

    vi.spyOn(localLlmChatsApi, "updatePreview")
      .mockImplementationOnce(() => {
        activeRequests += 1;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);

        return configureRequest.promise.finally(() => {
          activeRequests -= 1;
        });
      })
      .mockImplementationOnce(() => {
        activeRequests += 1;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);

        return networkModeRequest.promise.finally(() => {
          activeRequests -= 1;
        });
      });

    controller.mutateDetail.mockImplementation(async (
      mutation: () => Promise<LocalLlmChatDetail>
    ) => {
      const nextDetail = await mutation();

      controller.detail = nextDetail;
      return nextDetail;
    });

    render(
      <LocalLlmManagedSessionPanel
        chatId="chat-1"
        runtimes={[]}
        workspaces={[]}
        onExit={vi.fn()}
      />
    );

    let changeNetworkMode!: Promise<boolean>;

    act(() => {
      getManagedSessionPanelProps().onChangePreviewPort("5173");
    });

    const configure = submitWithReactEvent(getManagedSessionPanelProps().onSetPreview);

    act(() => {
      changeNetworkMode = Promise.resolve(
        getManagedSessionPanelProps().onChangePreviewNetworkMode("deskcue-host")
      );
    });

    expect(localLlmChatsApi.updatePreview).toHaveBeenCalledTimes(1);
    expect(localLlmChatsApi.updatePreview).toHaveBeenLastCalledWith("chat-1", {
      networkMode: "device-direct",
      port: 5173
    });

    await act(async () => {
      configureRequest.resolve({
        ...initialDetail,
        preview: {
          active: true,
          networkMode: "device-direct",
          port: 5173,
          targetUrl: "http://127.0.0.1:5173"
        }
      });
      await configure;
      await Promise.resolve();
    });

    expect(localLlmChatsApi.updatePreview).toHaveBeenCalledTimes(2);
    expect(localLlmChatsApi.updatePreview).toHaveBeenLastCalledWith("chat-1", {
      networkMode: "deskcue-host",
      port: 5173
    });

    await act(async () => {
      networkModeRequest.resolve({
        ...initialDetail,
        preview: {
          active: true,
          networkMode: "deskcue-host",
          port: 5173,
          targetUrl: "http://127.0.0.1:5173"
        }
      });

      expect(await changeNetworkMode).toBe(true);
    });

    expect(maxActiveRequests).toBe(1);
  });

  it("discards a hidden pending network mode when a newer port edit supersedes it", async () => {
    const configureRequest = deferred<LocalLlmChatDetail>();
    const initialDetail = createDetail("chat-1");
    const configuredDetail = {
      ...initialDetail,
      preview: {
        active: true,
        networkMode: "device-direct" as const,
        port: 5173,
        targetUrl: "http://127.0.0.1:5173"
      }
    };

    Object.assign(controller, { detail: initialDetail, error: null });

    vi.spyOn(localLlmChatsApi, "updatePreview")
      .mockReturnValueOnce(configureRequest.promise)
      .mockResolvedValueOnce({
        ...configuredDetail,
        preview: {
          ...configuredDetail.preview,
          port: 4000,
          targetUrl: "http://127.0.0.1:4000"
        }
      });

    controller.mutateDetail.mockImplementation(async (
      mutation: () => Promise<LocalLlmChatDetail>
    ) => {
      const nextDetail = await mutation();

      controller.detail = nextDetail;
      return nextDetail;
    });

    render(
      <LocalLlmManagedSessionPanel
        chatId="chat-1"
        runtimes={[]}
        workspaces={[]}
        onExit={vi.fn()}
      />
    );

    act(() => {
      getManagedSessionPanelProps().onChangePreviewPort("5173");
    });

    const configure = submitWithReactEvent(getManagedSessionPanelProps().onSetPreview);
    let changeNetworkMode!: Promise<boolean>;

    act(() => {
      changeNetworkMode = Promise.resolve(
        getManagedSessionPanelProps().onChangePreviewNetworkMode("deskcue-host")
      );
      getManagedSessionPanelProps().onChangePreviewPort("4000");
    });

    await act(async () => {
      configureRequest.resolve(configuredDetail);
      await configure;
      expect(await changeNetworkMode).toBe(false);
    });

    expect(localLlmChatsApi.updatePreview).toHaveBeenCalledTimes(1);

    const latestConfigure = submitWithReactEvent(getManagedSessionPanelProps().onSetPreview);

    await act(async () => {
      await latestConfigure;
    });

    expect(localLlmChatsApi.updatePreview).toHaveBeenCalledTimes(2);
    expect(localLlmChatsApi.updatePreview).toHaveBeenLastCalledWith("chat-1", {
      networkMode: "device-direct",
      port: 4000
    });
  });

  it.each(["configure", "stop"] as const)(
    "rolls back a hidden network mode when the current %s request fails",
    async (action) => {
      const networkModeRequest = deferred<LocalLlmChatDetail>();
      const currentRequest = deferred<LocalLlmChatDetail>();
      const initialDetail = {
        ...createDetail("chat-1"),
        preview: {
          active: true,
          networkMode: "device-direct" as const,
          port: 5173,
          targetUrl: "http://127.0.0.1:5173"
        }
      };

      Object.assign(controller, { detail: initialDetail, error: null });

      vi.spyOn(localLlmChatsApi, "updatePreview")
        .mockReturnValueOnce(networkModeRequest.promise)
        .mockReturnValueOnce(currentRequest.promise)
        .mockResolvedValueOnce(initialDetail);

      controller.mutateDetail.mockImplementation(async (
        mutation: () => Promise<LocalLlmChatDetail>
      ) => {
        const nextDetail = await mutation();

        controller.detail = nextDetail;
        return nextDetail;
      });

      render(
        <LocalLlmManagedSessionPanel
          chatId="chat-1"
          runtimes={[]}
          workspaces={[]}
          onExit={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(getManagedSessionPanelProps().previewPort).toBe("5173");
      });

      let changeNetworkMode!: Promise<boolean>;

      act(() => {
        changeNetworkMode = Promise.resolve(
          getManagedSessionPanelProps().onChangePreviewNetworkMode("deskcue-host")
        );
      });

      let currentMutation!: Promise<boolean | void>;

      if (action === "configure") {
        currentMutation = submitWithReactEvent(getManagedSessionPanelProps().onSetPreview);
      } else {
        act(() => {
          currentMutation = Promise.resolve(getManagedSessionPanelProps().onStopPreview());
        });
      }

      expect(localLlmChatsApi.updatePreview).toHaveBeenCalledTimes(1);

      await act(async () => {
        networkModeRequest.reject(new Error("stale network mode failure"));
        expect(await changeNetworkMode).toBe(false);
      });

      await waitFor(() => {
        expect(localLlmChatsApi.updatePreview).toHaveBeenCalledTimes(2);
      });

      expect(localLlmChatsApi.updatePreview).toHaveBeenLastCalledWith("chat-1", {
        networkMode: "deskcue-host",
        port: action === "configure" ? 5173 : null
      });

      await act(async () => {
        currentRequest.reject(new Error(`current ${action} failure`));
        await currentMutation;
      });

      const latestConfigure = submitWithReactEvent(getManagedSessionPanelProps().onSetPreview);

      await act(async () => {
        await latestConfigure;
      });

      expect(localLlmChatsApi.updatePreview).toHaveBeenCalledTimes(3);
      expect(localLlmChatsApi.updatePreview).toHaveBeenLastCalledWith("chat-1", {
        networkMode: "device-direct",
        port: 5173
      });
    }
  );

  it("shows a global failure independently of field validation", () => {
    Object.assign(controller, { detail: createDetail("chat-1"), error: null });
    const view = render(
      <LocalLlmManagedSessionPanel
        chatId="chat-1"
        runtimes={[]}
        workspaces={[]}
        onExit={vi.fn()}
      />
    );

    act(() => {
      getManagedSessionPanelProps().onChangePreviewPort("70000");
    });

    void submitWithReactEvent(getManagedSessionPanelProps().onSetPreview);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    controller.error = "Session connection is offline";
    view.rerender(
      <LocalLlmManagedSessionPanel
        chatId="chat-1"
        runtimes={[]}
        workspaces={[]}
        onExit={vi.fn()}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Session connection is offline");
  });

  it("moves owned Retry focus to the recovered local chat", async () => {
    let resolveRefresh: ((detail: LocalLlmChatDetail) => void) | undefined;
    const recoveredDetail = createDetail("chat-1");

    controller.refresh.mockImplementation(() => new Promise((resolve) => {
      resolveRefresh = resolve;
    }));

    const view = render(
      <StrictMode>
        <LocalLlmManagedSessionPanel
          chatId="chat-1"
          runtimes={[]}
          workspaces={[]}
          onExit={vi.fn()}
        />
      </StrictMode>
    );
    const retryButton = screen.getByRole("button", { name: "Retry" });

    retryButton.focus();
    fireEvent.click(retryButton);
    Object.assign(controller, { detail: recoveredDetail, error: null });

    await act(async () => {
      resolveRefresh?.(recoveredDetail);
      await Promise.resolve();
    });

    view.rerender(
      <StrictMode>
        <LocalLlmManagedSessionPanel
          chatId="chat-1"
          runtimes={[]}
          workspaces={[]}
          onExit={vi.fn()}
        />
      </StrictMode>
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Local chat loaded")).toHaveFocus();
    });
  });

  it("ignores a rejected retry after an A-B-A navigation cycle", async () => {
    let rejectOldRetry: ((reason: Error) => void) | undefined;
    const oldChatRefresh = vi.fn(() => new Promise<LocalLlmChatDetail | null>((_resolve, reject) => {
      rejectOldRetry = reject;
    }));
    const otherChatRefresh = vi.fn(() => Promise.resolve(null));
    const currentChatRefresh = vi.fn(() => Promise.resolve(null));

    controller.refreshByChatId.set("chat-a", oldChatRefresh);

    const view = render(
      <LocalLlmManagedSessionPanel
        chatId="chat-a"
        runtimes={[]}
        workspaces={[]}
        onExit={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    controller.refreshByChatId.set("chat-b", otherChatRefresh);
    view.rerender(
      <LocalLlmManagedSessionPanel
        chatId="chat-b"
        runtimes={[]}
        workspaces={[]}
        onExit={vi.fn()}
      />
    );

    controller.refreshByChatId.set("chat-a", currentChatRefresh);
    view.rerender(
      <LocalLlmManagedSessionPanel
        chatId="chat-a"
        runtimes={[]}
        workspaces={[]}
        onExit={vi.fn()}
      />
    );

    await act(async () => {
      rejectOldRetry?.(new Error("late failure from old chat A"));
      await Promise.resolve();
    });

    expect(controller.setError).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Retry" })).not.toHaveFocus();
  });

  it("does not claim recovery focus after a programmatic Retry click", async () => {
    let resolveRefresh: ((detail: LocalLlmChatDetail) => void) | undefined;
    const recoveredDetail = createDetail("chat-1");

    controller.refresh.mockImplementation(() => new Promise((resolve) => {
      resolveRefresh = resolve;
    }));

    const view = render(
      <LocalLlmManagedSessionPanel
        chatId="chat-1"
        runtimes={[]}
        workspaces={[]}
        onExit={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    Object.assign(controller, { detail: recoveredDetail, error: null });

    await act(async () => {
      resolveRefresh?.(recoveredDetail);
      await Promise.resolve();
    });

    view.rerender(
      <LocalLlmManagedSessionPanel
        chatId="chat-1"
        runtimes={[]}
        workspaces={[]}
        onExit={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Local chat loaded")).not.toHaveFocus();
  });

  it("does not steal focus moved elsewhere before deferred recovery focus runs", async () => {
    let resolveRefresh: ((detail: LocalLlmChatDetail) => void) | undefined;
    const recoveredDetail = createDetail("chat-1");
    const animationFrames: FrameRequestCallback[] = [];
    const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      });

    controller.refresh.mockImplementation(() => new Promise((resolve) => {
      resolveRefresh = resolve;
    }));

    const renderView = () => (
      <>
        <button type="button">Outside focus target</button>
        <LocalLlmManagedSessionPanel
          chatId="chat-1"
          runtimes={[]}
          workspaces={[]}
          onExit={vi.fn()}
        />
      </>
    );
    const view = render(renderView());
    const retryButton = screen.getByRole("button", { name: "Retry" });

    retryButton.focus();
    fireEvent.click(retryButton);
    Object.assign(controller, { detail: recoveredDetail, error: null });

    await act(async () => {
      resolveRefresh?.(recoveredDetail);
      await Promise.resolve();
    });

    view.rerender(renderView());
    screen.getByRole("button", { name: "Outside focus target" }).focus();

    act(() => {
      animationFrames.shift()?.(performance.now());
    });

    expect(screen.getByRole("button", { name: "Outside focus target" })).toHaveFocus();
    expect(screen.getByLabelText("Local chat loaded")).not.toHaveFocus();

    requestAnimationFrame.mockRestore();
  });
});
