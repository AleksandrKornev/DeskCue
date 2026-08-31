import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import styles from "@modules/agents/panel/styles.module.scss";

import { AgentSessionsToolbar } from "./AgentSessionsToolbar";

it("keeps mobile runtime filters behind an explicit disclosure", () => {
  render(
    <AgentSessionsToolbar
      isSearchLoading={false}
      localRuntimeTabs={[
        { id: "ollama", label: "Ollama", sessionCount: 3 },
        { id: "lm-studio", label: "LM Studio", sessionCount: 1 }
      ]}
      query=""
      selectedLocalRuntime={null}
      selectedSourceId="all"
      sourceCards={[
        {
          agentId: "codex",
          id: "codex",
          label: "Codex",
          sessionCount: 2,
          sessionCountLabel: "2",
          statusText: "2 resumable threads"
        },
        {
          agentId: "claude-code",
          id: "claude-code",
          label: "Claude Code",
          sessionCount: 1,
          sessionCountLabel: "1",
          statusText: "1 resumable thread"
        }
      ]}
      totalAgentSessionsCount="7"
      onQueryChange={vi.fn()}
      onSelectLocalRuntime={vi.fn()}
      onSelectSource={vi.fn()}
    />
  );

  const disclosure = screen.getByRole("button", { name: "Show 4 more filters" });

  expect(disclosure).toHaveAttribute("aria-expanded", "false");

  fireEvent.click(disclosure);

  expect(screen.getByRole("button", { name: "Hide extra filters" })).toHaveAttribute(
    "aria-expanded",
    "true"
  );
});

it("gives chat search a persistent label instead of relying on its placeholder", () => {
  render(
    <AgentSessionsToolbar
      isSearchLoading={false}
      localRuntimeTabs={[]}
      query=""
      selectedLocalRuntime={null}
      selectedSourceId="all"
      sourceCards={[]}
      totalAgentSessionsCount="0"
      onQueryChange={vi.fn()}
      onSelectLocalRuntime={vi.fn()}
      onSelectSource={vi.fn()}
    />
  );

  expect(screen.getByRole("searchbox", { name: "Search chats" })).toHaveAttribute(
    "placeholder",
    "Find a chat, workspace, or path"
  );
});

it("keeps the selected mobile filter visible and uses a singular disclosure label", () => {
  render(
    <AgentSessionsToolbar
      isSearchLoading={false}
      localRuntimeTabs={[
        { id: "ollama", label: "Ollama", sessionCount: 3 }
      ]}
      query=""
      selectedLocalRuntime={null}
      selectedSourceId="codex"
      sourceCards={[
        {
          agentId: "codex",
          id: "codex",
          label: "Codex",
          sessionCount: 2,
          sessionCountLabel: "2",
          statusText: "2 resumable threads"
        }
      ]}
      totalAgentSessionsCount="5"
      onQueryChange={vi.fn()}
      onSelectLocalRuntime={vi.fn()}
      onSelectSource={vi.fn()}
    />
  );

  expect(screen.getByRole("button", { name: "Codex 2" })).not.toHaveClass(
    styles.sourceTabMobileOptional
  );

  expect(screen.getByRole("button", { name: "Ollama 3" })).toHaveClass(
    styles.sourceTabMobileOptional
  );

  expect(screen.getByRole("button", { name: "Show 1 more filter" })).toBeInTheDocument();
});

it("keeps zero-count selected source and runtime filters visible", () => {
  const { rerender } = render(
    <AgentSessionsToolbar
      isSearchLoading={false}
      localRuntimeTabs={[]}
      query=""
      selectedLocalRuntime={null}
      selectedSourceId="codex"
      sourceCountsUnavailable
      sourceCards={[]}
      totalAgentSessionsCount="0"
      onQueryChange={vi.fn()}
      onSelectLocalRuntime={vi.fn()}
      onSelectSource={vi.fn()}
    />
  );

  const unavailableSource = screen.getByRole("button", {
    name: "Codex Session count unavailable"
  });

  expect(unavailableSource).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  expect(unavailableSource).toHaveTextContent("—");

  expect(screen.getByRole("button", { name: "All 0" })).toHaveAttribute(
    "aria-pressed",
    "false"
  );

  rerender(
    <AgentSessionsToolbar
      isSearchLoading={false}
      localRuntimeTabs={[]}
      query=""
      selectedLocalRuntime="ollama"
      selectedSourceId="all"
      sourceCards={[]}
      totalAgentSessionsCount="0"
      onQueryChange={vi.fn()}
      onSelectLocalRuntime={vi.fn()}
      onSelectSource={vi.fn()}
    />
  );

  expect(screen.getByRole("button", { name: "Ollama 0" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  expect(screen.getByRole("button", { name: "All 0" })).toHaveAttribute(
    "aria-pressed",
    "false"
  );
});

it("preserves focus when the selected runtime becomes empty", () => {
  const props = {
    isSearchLoading: false,
    query: "",
    selectedLocalRuntime: "ollama" as const,
    selectedSourceId: "all" as const,
    sourceCards: [],
    totalAgentSessionsCount: "0",
    onQueryChange: vi.fn(),
    onSelectLocalRuntime: vi.fn(),
    onSelectSource: vi.fn()
  };

  const { rerender } = render(
    <AgentSessionsToolbar
      {...props}
      localRuntimeTabs={[
        { id: "ollama", label: "Ollama", sessionCount: 1 },
        { id: "lm-studio", label: "LM Studio", sessionCount: 1 }
      ]}
    />
  );
  const selectedRuntime = screen.getByRole("button", { name: "Ollama 1" });

  selectedRuntime.focus();
  expect(selectedRuntime).toHaveFocus();

  rerender(
    <AgentSessionsToolbar
      {...props}
      localRuntimeTabs={[
        { id: "lm-studio", label: "LM Studio", sessionCount: 1 }
      ]}
    />
  );

  expect(screen.getByRole("button", { name: "Ollama 0" })).toHaveFocus();
  expect(screen.getByRole("button", { name: "All 0" })).toHaveAttribute(
    "aria-pressed",
    "false"
  );

  expect(within(screen.getByRole("group", {
    name: "Filter chats by agent or runtime"
  })).getAllByRole("button").slice(0, 3).map((button) => button.textContent?.trim())).toEqual([
    "All 0",
    "Ollama 0",
    "LM Studio 1"
  ]);
});
