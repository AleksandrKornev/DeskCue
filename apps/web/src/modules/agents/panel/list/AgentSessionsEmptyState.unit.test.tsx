import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentSessionsEmptyState } from "./AgentSessionsEmptyState";

describe("AgentSessionsEmptyState", () => {
  it("uses Retry as the return-focus fallback when the list is unavailable", () => {
    render(
      <AgentSessionsEmptyState
        hasSearchQuery={false}
        hasSourceSessions={false}
        isUnavailable
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Retry" }))
      .toHaveAttribute("data-chat-list-focus-fallback");
    expect(screen.getByRole("button", { name: "Retry" }))
      .toHaveAttribute("data-chat-list-focus-priority");
    expect(screen.getByText("Chat list is temporarily unavailable"))
      .not.toHaveAttribute("data-chat-list-focus-fallback");
  });

  it("uses the empty-state title as the fallback when no action is available", () => {
    render(
      <AgentSessionsEmptyState
        hasSearchQuery={false}
        hasSourceSessions={false}
      />
    );

    expect(screen.getByText("No chats for this source yet"))
      .toHaveAttribute("data-chat-list-focus-fallback");
  });
});
