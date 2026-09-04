import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalLlmChatSummary, RuntimeSummary } from "@deskcue/protocol";

import { LocalLlmChatPreview } from "./LocalLlmChatPreview";

const controller = vi.hoisted(() => ({
  detail: { id: "chat-1", messages: [] },
  error: null,
  refresh: vi.fn(),
  setError: vi.fn()
}));

vi.mock("@modules/localLlmChats/managedSession/controllers/useLocalLlmChatController", () => ({
  useLocalLlmChatController: () => controller
}));

const runtime: RuntimeSummary = {
  endpoint: "http://127.0.0.1:11434",
  id: "ollama",
  installed: true,
  label: "Ollama",
  lastActiveModel: null,
  loadedModelCount: 0,
  modelCount: 1,
  running: true,
  statusText: "1 local model available"
};

function createChat(
  generationState: LocalLlmChatSummary["generationState"],
  id = "chat-1"
): LocalLlmChatSummary {
  return {
    agentMode: "ask",
    createdAt: "2026-08-26T10:00:00.000Z",
    generationError: generationState === "failed" ? "Runtime unavailable" : null,
    generationState,
    id,
    model: "qwen3:4b",
    runtimeId: "ollama",
    title: "Local chat",
    toolCapability: null,
    updatedAt: "2026-08-26T10:00:00.000Z",
    workspace: null
  };
}

function renderPreview(
  generationState: LocalLlmChatSummary["generationState"],
  runtimeOverride: RuntimeSummary | null = runtime
) {
  render(
    <MemoryRouter>
      <LocalLlmChatPreview
        chat={createChat(generationState)}
        runtime={runtimeOverride}
      />
    </MemoryRouter>
  );
}

describe("LocalLlmChatPreview", () => {
  beforeEach(() => {
    Object.assign(controller, { detail: { id: "chat-1", messages: [] }, error: null });
    controller.refresh.mockReset();
    controller.setError.mockReset();
  });

  it.each([
    ["running", "Generating"],
    ["waiting_approval", "Needs approval"],
    ["failed", "Failed"],
    ["interrupted", "Interrupted"],
    ["idle", "Idle"]
  ] as const)("shows %s lifecycle truth", (generationState, label) => {
    renderPreview(generationState);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
  });

  it("does not call an idle chat ready when its runtime is offline", () => {
    renderPreview("idle", { ...runtime, running: false });

    expect(screen.getByText("Runtime offline")).toBeInTheDocument();
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
  });

  it("keeps missing and unavailable runtime states distinct", () => {
    const { rerender } = render(
      <MemoryRouter>
        <LocalLlmChatPreview chat={createChat("idle")} runtime={null} />
      </MemoryRouter>
    );

    expect(screen.getByText("Runtime status unavailable")).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <LocalLlmChatPreview
          chat={createChat("idle")}
          runtime={{ ...runtime, installed: false, running: false }}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("Runtime unavailable")).toBeInTheDocument();
  });

  it("labels the initial preview request as loading", () => {
    Object.assign(controller, { detail: null });

    renderPreview("idle");

    expect(screen.getByText("Loading preview", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Loading chat preview")).toBeInTheDocument();
  });

  it("never renders another chat detail under the selected chat header", () => {
    Object.assign(controller, {
      detail: {
        id: "chat-1",
        messages: [{ id: "message-a", role: "assistant", text: "private chat A content" }]
      }
    });

    render(
      <MemoryRouter>
        <LocalLlmChatPreview chat={createChat("idle", "chat-2")} runtime={runtime} />
      </MemoryRouter>
    );

    expect(screen.getByText("Loading chat preview")).toBeInTheDocument();
    expect(screen.queryByText("private chat A content")).not.toBeInTheDocument();
  });

  it("shows a safe alert and keeps Retry focused through recovery", async () => {
    let resolveRefresh: ((detail: { id: string; messages: never[] }) => void) | undefined;
    const recoveredDetail = { id: "chat-1", messages: [] as never[] };

    Object.assign(controller, { error: "private runtime transport detail" });

    controller.refresh.mockImplementation(() => new Promise((resolve) => {
      resolveRefresh = resolve;
    }));

    const { rerender } = render(
      <MemoryRouter>
        <LocalLlmChatPreview chat={createChat("idle")} runtime={runtime} />
      </MemoryRouter>
    );

    const alert = screen.getByRole("alert");
    const retryButton = screen.getByRole("button", { name: "Retry preview" });

    expect(alert).toHaveTextContent("Unable to load local chat preview");
    expect(alert).not.toHaveTextContent("private runtime transport detail");
    expect(screen.getAllByText("Preview unavailable", { selector: "span" })).toHaveLength(2);
    expect(screen.queryByText("Loading preview")).not.toBeInTheDocument();

    retryButton.focus();
    fireEvent.click(retryButton);

    expect(screen.getByRole("button", { name: "Retrying…" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Retrying…" }));
    expect(controller.refresh).toHaveBeenCalledTimes(1);

    Object.assign(controller, { detail: recoveredDetail, error: null });
    resolveRefresh?.(recoveredDetail);

    rerender(
      <MemoryRouter>
        <LocalLlmChatPreview chat={createChat("idle")} runtime={runtime} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Ollama chat preview content")).toHaveFocus();
    });

    expect(screen.getByRole("status")).toHaveTextContent("Preview loaded");
    expect(screen.getByLabelText("Ollama chat preview content")).not.toHaveAttribute("aria-live");
  });

  it("ignores a stale retry completion after selecting another chat", async () => {
    let resolveRefresh: ((detail: { id: string; messages: never[] }) => void) | undefined;
    const staleDetail = { id: "chat-1", messages: [] as never[] };

    Object.assign(controller, { error: "private runtime transport detail" });

    controller.refresh.mockImplementation(() => new Promise((resolve) => {
      resolveRefresh = resolve;
    }));

    const { rerender } = render(
      <MemoryRouter>
        <LocalLlmChatPreview chat={createChat("idle")} runtime={runtime} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry preview" }));

    Object.assign(controller, { error: "private chat-b transport detail" });

    rerender(
      <MemoryRouter>
        <LocalLlmChatPreview chat={createChat("idle", "chat-2")} runtime={runtime} />
      </MemoryRouter>
    );

    await act(async () => {
      resolveRefresh?.(staleDetail);
      await Promise.resolve();
    });

    expect(controller.setError).not.toHaveBeenCalledWith(null);
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load local chat preview");
    expect(screen.getByRole("button", { name: "Retry preview" })).toBeEnabled();
  });

  it("does not commit a successful retry after the preview unmounts", async () => {
    let resolveRefresh: ((detail: { id: string; messages: never[] }) => void) | undefined;
    const staleDetail = { id: "chat-1", messages: [] as never[] };

    Object.assign(controller, { error: "private runtime transport detail" });

    controller.refresh.mockImplementation(() => new Promise((resolve) => {
      resolveRefresh = resolve;
    }));

    const { unmount } = render(
      <MemoryRouter>
        <LocalLlmChatPreview chat={createChat("idle")} runtime={runtime} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry preview" }));
    unmount();

    await act(async () => {
      resolveRefresh?.(staleDetail);
      await Promise.resolve();
    });

    expect(controller.setError).not.toHaveBeenCalledWith(null);
  });
});
