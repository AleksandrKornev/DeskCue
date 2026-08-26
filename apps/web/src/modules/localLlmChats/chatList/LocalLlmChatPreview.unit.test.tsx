import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import type { LocalLlmChatSummary, RuntimeSummary } from "@deskcue/protocol";

import { LocalLlmChatPreview } from "./LocalLlmChatPreview";

vi.mock("@modules/localLlmChats/managedSession/controllers/useLocalLlmChatController", () => ({
  useLocalLlmChatController: () => ({ detail: null, error: null })
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
  generationState: LocalLlmChatSummary["generationState"]
): LocalLlmChatSummary {
  return {
    agentMode: "ask",
    createdAt: "2026-08-26T10:00:00.000Z",
    generationError: generationState === "failed" ? "Runtime unavailable" : null,
    generationState,
    id: "chat-1",
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
});
