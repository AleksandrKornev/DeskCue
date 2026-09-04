import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentSessionSummary } from "@deskcue/protocol";

const hookMocks = vi.hoisted(() => ({
  useSubagentSessions: vi.fn()
}));

vi.mock("./useSubagentSessions", () => ({
  useSubagentSessions: hookMocks.useSubagentSessions
}));

import { SubagentSessionsSupplement } from "./SubagentSessionsSupplement";

const child = {
  agentId: "codex",
  agentLabel: "Codex",
  attachMode: "read_only",
  cliVersion: null,
  filePath: "child.jsonl",
  id: "codex:child",
  model: null,
  originator: null,
  source: "codex",
  sourceSessionId: "child",
  subagent: {
    depth: 1,
    nickname: "Scout",
    parentSessionId: "codex:parent",
    role: "functional reviewer"
  },
  title: "Child task",
  updatedAt: "2026-09-04T10:00:00.000Z",
  workspaceName: "DeskCue",
  workspacePath: "D:\\work\\DeskCue",
  workState: "running"
} satisfies AgentSessionSummary;

function renderSupplement() {
  const onOpenSubagentSession = vi.fn();

  render(
    <SubagentSessionsSupplement
      knownSessions={[]}
      parentSessionId="codex:parent"
      onOpenSubagentSession={onOpenSubagentSession}
    />
  );

  fireEvent.click(screen.getByRole("button", { name: /Subagents/i }));
  fireEvent.click(screen.getByRole("button", { name: /Open subagent Scout/ }));

  return onOpenSubagentSession;
}

describe("SubagentSessionsSupplement", () => {
  beforeEach(() => {
    hookMocks.useSubagentSessions.mockReturnValue({
      hasMore: false,
      isLoading: false,
      loadFailed: false,
      retry: vi.fn(),
      sessions: [child]
    });
  });

  it("opens every child through the stable source-chat hierarchy", () => {
    const onOpenSubagentSession = renderSupplement();

    expect(onOpenSubagentSession).toHaveBeenCalledWith("codex:parent", "codex:child");
  });

  it("retries a failed child-list request without forwarding the click event", () => {
    const retry = vi.fn();

    hookMocks.useSubagentSessions.mockReturnValue({
      hasMore: false,
      isLoading: false,
      loadFailed: true,
      retry,
      sessions: []
    });

    render(
      <SubagentSessionsSupplement
        knownSessions={[]}
        parentSessionId="codex:parent"
        onOpenSubagentSession={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(retry).toHaveBeenCalledWith();
  });
});
