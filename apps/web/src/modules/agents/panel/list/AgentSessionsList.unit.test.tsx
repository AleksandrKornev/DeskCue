import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { AgentSessionsList } from "./AgentSessionsList";

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
      workIndicatorsBySourceSessionId={new Map()}
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
      workIndicatorsBySourceSessionId={new Map()}
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
      workIndicatorsBySourceSessionId={new Map()}
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
