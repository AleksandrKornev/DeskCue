import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import type { AgentSessionSummary, LocalLlmChatSummary } from "@deskcue/protocol";

import { AttentionSection } from "./attention/AttentionSection";
import { AgentSessionsList } from "./list/AgentSessionsList";
import { AgentSessionsToolbar } from "./toolbar/AgentSessionsToolbar";

it("shows the official runtime marks in source and local runtime tabs", () => {
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

  const allButton = screen.getByRole("button", { name: "All 7" });
  expect(allButton).not.toHaveAttribute("aria-label");

  const expectedIcons = [
    ["Codex 2", "codex"],
    ["Claude Code 1", "claude-code"],
    ["Ollama 3", "ollama"],
    ["LM Studio 1", "lm-studio"]
  ] as const;
  for (const [buttonName, runtimeId] of expectedIcons) {
    const button = screen.getByRole("button", { name: buttonName });
    expect(button).not.toHaveAttribute("aria-label");
    const icon = button.querySelector("svg");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveAttribute("data-runtime-icon", runtimeId);
  }
});

it("shows the matching runtime mark on every agent and local chat card", () => {
  const agentSession = {
    agentId: "claude-code",
    agentLabel: "Claude Code",
    attachMode: "resume",
    filePath: "claude-session.jsonl",
    id: "agent-session-1",
    sourceSessionId: "source-session-1",
    title: "Review the auth flow",
    updatedAt: "2026-08-14T10:00:00.000Z",
    workspaceName: "DeskCue",
    workState: "idle"
  } as AgentSessionSummary;
  const localChat = {
    generationState: "idle",
    id: "local-chat-1",
    runtimeId: "ollama",
    title: "Compare local output",
    updatedAt: "2026-08-14T09:00:00.000Z",
    workspace: null
  } as LocalLlmChatSummary;
  const { container } = render(
    <AgentSessionsList
      attachedSourceSessionKeys={new Set()}
      canLoadMoreSessions={false}
      canShowFewerSessions={false}
      filteredSessionsCount={2}
      hasMoreSessions={false}
      hiddenSessionsCount={0}
      isLoading={false}
      isLoadingMoreSessions={false}
      localLlmChats={[localChat]}
      query=""
      readyForReviewAgentSessionIds={new Set()}
      selectedAgentSessionId=""
      sessions={[agentSession]}
      totalSessionsCountLabel="2"
      workIndicatorsBySourceSessionId={new Map()}
      onOpenLocalLlmChat={vi.fn()}
      onSelectAgentSession={vi.fn()}
      onShowFewerSessions={vi.fn()}
      onShowMoreSessions={vi.fn()}
    />
  );

  const cardMarks = container.querySelectorAll<HTMLElement>("[data-chat-runtime-icon]");
  expect(cardMarks).toHaveLength(2);
  expect([...cardMarks].map((mark) => mark.dataset.chatRuntimeIcon)).toEqual([
    "claude-code",
    "ollama"
  ]);
  const expectedLabels = ["Claude Code", "Ollama"];
  for (const [index, mark] of [...cardMarks].entries()) {
    expect(mark.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(mark).toHaveTextContent(expectedLabels[index] ?? "");
  }
});

it("shows the runtime mark on compact attention cards", () => {
  const session = {
    agentId: "codex",
    agentLabel: "Codex",
    id: "attention-session-1",
    sourceSessionId: "source-session-1",
    title: "Continue the active task",
    workspaceName: "DeskCue",
    workState: "running"
  } as AgentSessionSummary;
  const { container } = render(
    <AttentionSection
      label="Running"
      selectedAgentSessionId=""
      sessions={[session]}
      tone="active"
      workIndicatorsBySourceSessionId={new Map()}
      onSelectAgentSession={vi.fn()}
    />
  );

  const mark = container.querySelector<HTMLElement>("[data-attention-runtime-icon='codex']");
  expect(mark?.querySelector("svg")).toHaveAttribute("data-runtime-icon", "codex");
  expect(mark?.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  expect(mark).toHaveTextContent("Codex");
});
