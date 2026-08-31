import { render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import type { AgentSessionSummary } from "@deskcue/protocol";

import { AgentSessionsAttention } from "./AgentSessionsAttention";

function createSession(
  id: string,
  sourceSessionId: string,
  workState: AgentSessionSummary["workState"]
) {
  return {
    agentId: "codex",
    agentLabel: "Codex",
    attachMode: "resume",
    filePath: `${id}.jsonl`,
    id,
    sourceSessionId,
    title: `Session ${id}`,
    updatedAt: "2026-08-29T10:00:00.000Z",
    workspaceName: "DeskCue",
    workState
  } as AgentSessionSummary;
}

it("groups approval and review work together without repeating it as active", () => {
  const approval = createSession("approval", "source-approval", "running");
  const review = createSession("review", "source-review", "idle");
  const active = createSession("active", "source-active", "running");

  render(
    <AgentSessionsAttention
      approvalRequestedSourceSessionIds={new Set([approval.sourceSessionId])}
      readyForReviewAgentSessionIds={new Set([review.id])}
      selectedAgentSessionId=""
      sessions={[approval, review, active]}
      workIndicatorsBySourceSessionId={new Map()}
      onSelectAgentSession={vi.fn()}
    />
  );

  expect(screen.getByRole("button", { name: /Needs attention\s*2/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Active agents\s*1/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Finished/ })).not.toBeInTheDocument();
  expect(screen.getAllByText("Session approval")).toHaveLength(1);
  expect(screen.getAllByText("Session review")).toHaveLength(1);
  expect(screen.getAllByText("Session active")).toHaveLength(1);
});

it("shows one preview per group when the mobile preview limit is requested", () => {
  const first = createSession("first-review", "source-first-review", "idle");
  const second = createSession("second-review", "source-second-review", "idle");

  render(
    <AgentSessionsAttention
      approvalRequestedSourceSessionIds={new Set()}
      previewLimit={1}
      readyForReviewAgentSessionIds={new Set([first.id, second.id])}
      selectedAgentSessionId=""
      sessions={[first, second]}
      workIndicatorsBySourceSessionId={new Map()}
      onSelectAgentSession={vi.fn()}
    />
  );

  expect(screen.getByText("Session first-review")).toBeInTheDocument();
  expect(screen.queryByText("Session second-review")).not.toBeInTheDocument();
  expect(screen.getByText("+1 more in the list")).toBeInTheDocument();
});

it("visibly disambiguates attention cards with otherwise identical copy", () => {
  const first = {
    ...createSession("first", "source-session-alpha", "idle"),
    title: "Same session"
  };

  const second = {
    ...createSession("second", "source-session-bravo", "idle"),
    title: "Same session"
  };

  render(
    <AgentSessionsAttention
      approvalRequestedSourceSessionIds={new Set()}
      readyForReviewAgentSessionIds={new Set([first.id, second.id])}
      selectedAgentSessionId=""
      sessions={[first, second]}
      workIndicatorsBySourceSessionId={new Map()}
      onSelectAgentSession={vi.fn()}
    />
  );

  const sessionButtons = screen.getAllByRole("button", { name: /Same session/ });

  expect(sessionButtons).toHaveLength(2);
  expect(new Set(sessionButtons.map((button) => button.textContent)).size).toBe(2);
  expect(screen.getByText("ID source-session-alpha")).toBeInTheDocument();
  expect(screen.getByText("ID source-session-bravo")).toBeInTheDocument();
});

it("keeps visible names distinct when source ids share the same suffix", () => {
  const first = {
    ...createSession("first", "provider-A-12345678", "idle"),
    title: "Same session"
  };

  const second = {
    ...createSession("second", "provider-B-12345678", "idle"),
    title: "Same session"
  };

  render(
    <AgentSessionsAttention
      approvalRequestedSourceSessionIds={new Set()}
      readyForReviewAgentSessionIds={new Set([first.id, second.id])}
      selectedAgentSessionId=""
      sessions={[first, second]}
      workIndicatorsBySourceSessionId={new Map()}
      onSelectAgentSession={vi.fn()}
    />
  );

  const sessionButtons = screen.getAllByRole("button", { name: /Same session/ });

  expect(new Set(sessionButtons.map((button) => button.textContent)).size).toBe(2);
  expect(screen.getByText("ID provider-A-12345678")).toBeInTheDocument();
  expect(screen.getByText("ID provider-B-12345678")).toBeInTheDocument();
});

it("bounds long colliding references while keeping the rendered cards distinct", () => {
  const first = {
    ...createSession(
      "first",
      `common-prefix-${"a".repeat(200)}-1234567890`,
      "idle"
    ),
    title: "Same session"
  };

  const second = {
    ...createSession(
      "second",
      `common-prefix-${"b".repeat(200)}-1234567890`,
      "idle"
    ),
    title: "Same session"
  };

  render(
    <AgentSessionsAttention
      approvalRequestedSourceSessionIds={new Set()}
      readyForReviewAgentSessionIds={new Set([first.id, second.id])}
      selectedAgentSessionId=""
      sessions={[first, second]}
      workIndicatorsBySourceSessionId={new Map()}
      onSelectAgentSession={vi.fn()}
    />
  );

  const sessionButtons = screen.getAllByRole("button", { name: /Same session/ });

  expect(sessionButtons).toHaveLength(2);
  expect(new Set(sessionButtons.map((button) => button.textContent)).size).toBe(2);
  const firstReference = screen.getByText("ID common-pre…1234567890 · 1");
  const secondReference = screen.getByText("ID common-pre…1234567890 · 2");

  expect(firstReference).toBeInTheDocument();
  expect(secondReference).toBeInTheDocument();
  expect(firstReference).toHaveAttribute("title", "Source session common-pre…1234567890 · 1");
  expect(secondReference).toHaveAttribute("title", "Source session common-pre…1234567890 · 2");
  expect(Math.max(...sessionButtons.map((button) => button.textContent?.length ?? 0))).toBeLessThan(100);
  expect(Math.max(firstReference.title.length, secondReference.title.length)).toBeLessThan(100);
});

it("collapses attention details after a chat is selected", async () => {
  const session = createSession("review", "source-review", "idle");
  const props = {
    approvalRequestedSourceSessionIds: new Set<string>(),
    readyForReviewAgentSessionIds: new Set([session.id]),
    sessions: [session],
    workIndicatorsBySourceSessionId: new Map(),
    onSelectAgentSession: vi.fn()
  };

  const { rerender } = render(
    <AgentSessionsAttention {...props} selectedAgentSessionId="" />
  );

  expect(screen.getByText("Session review")).toBeInTheDocument();

  rerender(<AgentSessionsAttention {...props} selectedAgentSessionId={session.id} />);

  await waitFor(() => {
    expect(screen.getByRole("button", { name: /Needs attention\s*1/ }))
      .toHaveAttribute("aria-expanded", "false");
  });

  expect(screen.queryByText("Session review")).not.toBeInTheDocument();
});
