import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AgentSessionDetail } from "@deskcue/protocol";

import { AgentTranscriptPanel } from "./AgentTranscriptPanel";
import type { AgentTranscriptPanelProps } from "./types";

function createSession(): AgentSessionDetail {
  return {
    agentId: "codex",
    agentLabel: "Codex",
    attachMode: "resume",
    cliVersion: null,
    filePath: "thread.jsonl",
    id: "agent-1",
    model: null,
    originator: null,
    reviewedAt: null,
    source: null,
    sourceSessionId: "thread-1",
    title: "Recovered chat",
    transcript: [],
    updatedAt: "2026-08-30T12:00:00.000Z",
    workspaceName: "DeskCue",
    workspacePath: null,
    workState: "idle"
  };
}

function createProps(patch: Partial<AgentTranscriptPanelProps> = {}): AgentTranscriptPanelProps {
  return {
    attachedManagedSessionId: null,
    attachedManagedSessionInfo: null,
    attaching: false,
    isLoading: false,
    loadError: null,
    onAttach: () => undefined,
    onMarkReviewed: () => undefined,
    onOpenManagedSession: () => undefined,
    onRetryLoad: () => undefined,
    readyForReviewAgentSessionIds: new Set<string>(),
    selectedSessionId: "agent-1",
    session: null,
    sessionSummary: null,
    ...patch
  };
}

describe("AgentTranscriptPanel load recovery", () => {
  it("keeps parent subagent navigation visible beside the source transcript actions", () => {
    render(
      <AgentTranscriptPanel
        {...createProps({
          session: createSession(),
          subagentSupplement: <section aria-label="Subagents">3 running · 54 total</section>
        })}
      />
    );

    expect(screen.getByRole("region", { name: "Subagents" })).toHaveTextContent("54 total");
    expect(screen.getByRole("button", { name: "Continue chat" })).toBeInTheDocument();
  });

  it("retains the parent hierarchy when a subagent opens its managed chat", () => {
    const onAttach = vi.fn();
    const onOpenManagedSession = vi.fn();
    const session = {
      ...createSession(),
      subagent: {
        depth: 1,
        nickname: "Scout",
        parentSessionId: "codex:parent",
        role: "reviewer"
      }
    };

    const { rerender } = render(
      <AgentTranscriptPanel
        {...createProps({
          onAttach,
          parentAgentSessionId: "codex:parent",
          session
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue chat" }));
    expect(onAttach).toHaveBeenCalledWith({
      subagentParentSessionId: "codex:parent"
    });

    rerender(
      <AgentTranscriptPanel
        {...createProps({
          attachedManagedSessionId: "managed-1",
          attachedManagedSessionInfo: {
            id: "managed-1",
            status: "running",
            viewerCount: 1
          },
          onOpenManagedSession,
          parentAgentSessionId: "codex:parent",
          session
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Open live chat" }));
    expect(onOpenManagedSession).toHaveBeenCalledWith("managed-1", {
      subagentParentSessionId: "codex:parent"
    });
  });

  it("replaces a summary-only preview with recovery instead of a false empty state", () => {
    render(
      <AgentTranscriptPanel
        {...createProps({
          loadError: "DeskCue couldn't load this local transcript.",
          sessionSummary: createSession()
        })}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load chat");
    expect(screen.getAllByText("Chat unavailable", { selector: "span" })).toHaveLength(2);
    expect(screen.queryByText("Loading chat")).not.toBeInTheDocument();
    expect(screen.queryByText("No message preview available")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue chat" })).not.toBeInTheDocument();
  });

  it("moves owned Retry focus to the recovered chat without stealing unrelated focus", () => {
    const onRetryLoad = vi.fn();
    const { rerender } = render(
      <AgentTranscriptPanel
        {...createProps({
          loadError: "DeskCue couldn't load this local transcript.",
          onRetryLoad
        })}
      />
    );

    const retryButton = screen.getByRole("button", { name: "Retry" });

    retryButton.focus();

    fireEvent.click(retryButton);
    expect(onRetryLoad).toHaveBeenCalledTimes(1);

    rerender(
      <AgentTranscriptPanel
        {...createProps({
          isLoading: true,
          loadError: "DeskCue couldn't load this local transcript.",
          onRetryLoad
        })}
      />
    );

    expect(screen.getByRole("button", { name: "Retrying…" })).toHaveFocus();

    rerender(<AgentTranscriptPanel {...createProps({ session: createSession() })} />);

    expect(screen.getByLabelText("Recovered chat chat details")).toHaveFocus();
  });

  it("does not move focus after the user leaves Retry during recovery", () => {
    const { rerender } = render(
      <div>
        <button type="button">Outside action</button>
        <AgentTranscriptPanel
          {...createProps({
            loadError: "DeskCue couldn't load this local transcript.",
            sessionSummary: createSession()
          })}
        />
      </div>
    );

    const retryButton = screen.getByRole("button", { name: "Retry" });
    const outsideButton = screen.getByRole("button", { name: "Outside action" });

    retryButton.focus();

    fireEvent.click(retryButton);
    outsideButton.focus();
    fireEvent.blur(retryButton, { relatedTarget: outsideButton });

    rerender(
      <div>
        <button type="button">Outside action</button>
        <AgentTranscriptPanel {...createProps({ session: createSession() })} />
      </div>
    );

    expect(screen.getByRole("button", { name: "Outside action" })).toHaveFocus();
  });

  it("does not carry Retry focus ownership across chat selections", () => {
    const sessionA = createSession();
    const sessionB = { ...createSession(), id: "agent-2", title: "Another chat" };
    const { rerender } = render(
      <AgentTranscriptPanel
        {...createProps({ loadError: "Unable to load A.", sessionSummary: sessionA })}
      />
    );

    const retryButton = screen.getByRole("button", { name: "Retry" });

    retryButton.focus();
    fireEvent.click(retryButton);

    rerender(
      <AgentTranscriptPanel
        {...createProps({
          loadError: "Unable to load B.",
          selectedSessionId: sessionB.id,
          sessionSummary: sessionB
        })}
      />
    );

    rerender(
      <AgentTranscriptPanel
        {...createProps({
          selectedSessionId: sessionA.id,
          session: sessionA,
          sessionSummary: sessionA
        })}
      />
    );

    expect(screen.getByLabelText("Recovered chat chat details")).not.toHaveFocus();
  });

  it("does not show a stale detail after the selected summary changes", () => {
    const staleSession = createSession();
    const selectedSummary = { ...createSession(), id: "agent-2", title: "Selected chat" };

    render(
      <AgentTranscriptPanel
        {...createProps({
          isLoading: true,
          selectedSessionId: selectedSummary.id,
          session: staleSession,
          sessionSummary: selectedSummary
        })}
      />
    );

    expect(screen.getByText("Selected chat")).toBeInTheDocument();
    expect(screen.queryByText("Recovered chat")).not.toBeInTheDocument();
    expect(screen.getByText("Loading chat preview")).toBeInTheDocument();
  });

  it("presents resumable chats as ready with runtime identity and a connected-client hint", () => {
    const { container } = render(
      <AgentTranscriptPanel
        {...createProps({
          attachedManagedSessionId: "managed-1",
          attachedManagedSessionInfo: {
            id: "managed-1",
            status: "running",
            viewerCount: 1
          },
          session: createSession()
        })}
      />
    );

    expect(screen.getByText("Ready", { selector: "span" })).toBeInTheDocument();
    expect(screen.queryByText("Ready to continue")).not.toBeInTheDocument();
    expect(screen.getByText("Codex", { selector: "span" })).toBeInTheDocument();
    expect(container.querySelector('[data-runtime-icon="codex"]')).toBeInTheDocument();
    expect(screen.getByText("1 connected DeskCue client")).toBeInTheDocument();
  });
});
