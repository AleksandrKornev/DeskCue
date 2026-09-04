import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import type { AgentSessionSummary } from "@deskcue/protocol";

import { AgentSessionsList } from "./AgentSessionsList";

function createAgentSession(id: string) {
  return {
    agentId: "codex",
    agentLabel: "Codex",
    attachMode: "resume",
    filePath: `${id}.jsonl`,
    id,
    sourceSessionId: `source-${id}`,
    title: `Session ${id}`,
    updatedAt: "2026-08-29T10:00:00.000Z",
    workspaceName: "DeskCue",
    workState: "idle"
  } as AgentSessionSummary;
}

it("does not render an empty Recent work section when every chat is previewed above", () => {
  const { container } = render(
    <AgentSessionsList
      attachedSourceSessionKeys={new Set()}
      canLoadMoreSessions={false}
      canShowFewerSessions={false}
      filteredSessionsCount={1}
      hasMoreSessions={false}
      hiddenSessionsCount={0}
      isLoading={false}
      isLoadingMoreSessions={false}
      localLlmChats={[]}
      query=""
      readyForReviewAgentSessionIds={new Set()}
      selectedAgentSessionId=""
      sessions={[]}
      title="Recent work"
      totalSessionsCountLabel="1"
      workIndicatorsBySourceSessionKey={new Map()}
      onOpenLocalLlmChat={vi.fn()}
      onSelectAgentSession={vi.fn()}
      onShowFewerSessions={vi.fn()}
      onShowMoreSessions={vi.fn()}
    />
  );

  expect(screen.queryByRole("heading", { name: "Recent work" })).not.toBeInTheDocument();
  expect(screen.queryByText("0 recent chats")).not.toBeInTheDocument();
  expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
});

it("keeps the Recent work load action when more chats are available", () => {
  render(
    <AgentSessionsList
      attachedSourceSessionKeys={new Set()}
      canLoadMoreSessions
      canShowFewerSessions={false}
      filteredSessionsCount={1}
      hasMoreSessions
      hiddenSessionsCount={0}
      isLoading={false}
      isLoadingMoreSessions={false}
      localLlmChats={[]}
      query=""
      readyForReviewAgentSessionIds={new Set()}
      selectedAgentSessionId=""
      sessions={[]}
      title="Recent work"
      totalSessionsCountLabel="1"
      workIndicatorsBySourceSessionKey={new Map()}
      onOpenLocalLlmChat={vi.fn()}
      onSelectAgentSession={vi.fn()}
      onShowFewerSessions={vi.fn()}
      onShowMoreSessions={vi.fn()}
    />
  );

  expect(screen.getByRole("heading", { name: "Recent work" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Load more chats" })).toBeInTheDocument();
});

it("provides a focus fallback while the chat list is recovering", () => {
  render(
    <AgentSessionsList
      attachedSourceSessionKeys={new Set()}
      canLoadMoreSessions={false}
      canShowFewerSessions={false}
      filteredSessionsCount={0}
      hasMoreSessions={false}
      hiddenSessionsCount={0}
      isLoading
      isLoadingMoreSessions={false}
      localLlmChats={[]}
      query=""
      readyForReviewAgentSessionIds={new Set()}
      selectedAgentSessionId=""
      sessions={[]}
      totalSessionsCountLabel="0"
      workIndicatorsBySourceSessionKey={new Map()}
      onOpenLocalLlmChat={vi.fn()}
      onSelectAgentSession={vi.fn()}
      onShowFewerSessions={vi.fn()}
      onShowMoreSessions={vi.fn()}
    />
  );

  expect(screen.getByText("Loading chats").parentElement)
    .toHaveAttribute("data-chat-list-focus-fallback");
  expect(screen.getByText("Loading chats").parentElement)
    .toHaveAttribute("data-chat-list-focus-priority");
});

it("preserves the actionable new-result state in Recent work", () => {
  const session = createAgentSession("review");

  render(
    <AgentSessionsList
      attachedSourceSessionKeys={new Set()}
      canLoadMoreSessions={false}
      canShowFewerSessions={false}
      filteredSessionsCount={1}
      hasMoreSessions={false}
      hiddenSessionsCount={0}
      isLoading={false}
      isLoadingMoreSessions={false}
      localLlmChats={[]}
      query=""
      readyForReviewAgentSessionIds={new Set([session.id])}
      selectedAgentSessionId=""
      sessions={[session]}
      title="Recent work"
      totalSessionsCountLabel="1"
      workIndicatorsBySourceSessionKey={new Map()}
      onOpenLocalLlmChat={vi.fn()}
      onSelectAgentSession={vi.fn()}
      onShowFewerSessions={vi.fn()}
      onShowMoreSessions={vi.fn()}
    />
  );

  expect(screen.getByRole("button", { name: /Session review.*New result/ })).toBeInTheDocument();
  expect(screen.queryByText("Finished")).not.toBeInTheDocument();
});

it("shows a matching subagent nickname and supporting role in search results", () => {
  const session = {
    ...createAgentSession("child"),
    subagent: {
      depth: 1,
      nickname: "Parfit",
      parentSessionId: "codex:parent",
      role: "adversarial reviewer"
    }
  };

  render(
    <AgentSessionsList
      attachedSourceSessionKeys={new Set()}
      canLoadMoreSessions={false}
      canShowFewerSessions={false}
      filteredSessionsCount={1}
      hasMoreSessions={false}
      hiddenSessionsCount={0}
      isLoading={false}
      isLoadingMoreSessions={false}
      localLlmChats={[]}
      query="Parfit"
      readyForReviewAgentSessionIds={new Set()}
      selectedAgentSessionId=""
      sessions={[session]}
      totalSessionsCountLabel="1"
      workIndicatorsBySourceSessionKey={new Map()}
      onOpenLocalLlmChat={vi.fn()}
      onSelectAgentSession={vi.fn()}
      onShowFewerSessions={vi.fn()}
      onShowMoreSessions={vi.fn()}
    />
  );

  expect(screen.getByText("Parfit")).toBeInTheDocument();
  expect(screen.getByText("adversarial reviewer")).toBeInTheDocument();
});
