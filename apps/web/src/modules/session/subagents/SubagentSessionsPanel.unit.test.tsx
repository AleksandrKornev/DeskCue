import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentSessionSummary } from "@deskcue/protocol";

import { SubagentSessionsPanel } from "./SubagentSessionsPanel";
import {
  readSubagentPanelViewState,
  writeSubagentPanelViewState
} from "./viewState";

function session(id: string, workState: AgentSessionSummary["workState"]): AgentSessionSummary {
  return {
    id: `codex:${id}`,
    agentId: "codex",
    agentLabel: "Codex",
    attachMode: "read_only",
    cliVersion: null,
    filePath: `${id}.jsonl`,
    model: null,
    originator: null,
    source: "codex",
    sourceSessionId: id,
    subagent: {
      depth: 1,
      nickname: id,
      parentSessionId: "codex:parent",
      role: "reviewer"
    },
    title: `${id} task`,
    updatedAt: "2026-09-04T10:00:00.000Z",
    workspaceName: "DeskCue",
    workspacePath: "D:\\work\\DeskCue",
    workState
  };
}

describe("SubagentSessionsPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    window.history.replaceState(null, "");
  });

  it("keeps a compact summary until the user asks for the child list", () => {
    render(
      <SubagentSessionsPanel
        hasMore={false}
        isLoading={false}
        loadFailed={false}
        parentSessionId="codex:parent"
        sessions={[session("Scout", "running"), session("Archivist", "idle")]}
        onOpenSession={vi.fn()}
        onRetry={vi.fn()}
      />
    );

    const toggle = screen.getByRole("button", { name: /subagents/i });

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("1 running")).toBeInTheDocument();
    expect(screen.getByText("2 total")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open subagent Scout/ })).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Open subagent Scout/ })).toBeInTheDocument();
    expect(screen.getByText("Idle")).toBeInTheDocument();
  });

  it("opens the selected child and communicates a bounded result", () => {
    const onOpenSession = vi.fn();

    render(
      <SubagentSessionsPanel
        hasMore
        isLoading={false}
        loadFailed={false}
        parentSessionId="codex:parent"
        sessions={[session("Scout", "running")]}
        onOpenSession={onOpenSession}
        onRetry={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /subagents/i }));
    fireEvent.click(screen.getByRole("button", { name: /Open subagent Scout/ }));

    expect(onOpenSession).toHaveBeenCalledWith("codex:Scout");
    expect(screen.getByText("1+ total")).toBeInTheDocument();
    expect(screen.getByText("Showing the 100 most recent subagents.")).toBeInTheDocument();
  });

  it("shows a recoverable error when the child list cannot be loaded", () => {
    const onRetry = vi.fn();

    render(
      <SubagentSessionsPanel
        hasMore={false}
        isLoading={false}
        loadFailed
        parentSessionId="codex:parent"
        sessions={[]}
        onOpenSession={vi.fn()}
        onRetry={onRetry}
      />
    );

    expect(screen.getByText("Subagents unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("restores the expanded parent list, scroll position and child focus after returning", async () => {
    const children = [session("Scout", "running"), session("Archivist", "idle")];
    const scrollTo = vi.mocked(window.scrollTo);
    const { unmount } = render(
      <SubagentSessionsPanel
        hasMore={false}
        isLoading={false}
        loadFailed={false}
        parentSessionId="codex:parent"
        sessions={children}
        onOpenSession={vi.fn()}
        onRetry={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /subagents/i }));
    const list = screen.getByRole("button", { name: /Open subagent Scout/ }).parentElement;

    expect(list).not.toBeNull();
    if (!list) return;

    list.scrollTop = 72;
    fireEvent.scroll(list);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 123 });
    fireEvent.click(screen.getByRole("button", { name: /Open subagent Scout/ }));

    unmount();
    render(
      <SubagentSessionsPanel
        hasMore={false}
        isLoading={false}
        loadFailed={false}
        parentSessionId="codex:parent"
        sessions={children}
        onOpenSession={vi.fn()}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /subagents/i })).toHaveAttribute(
      "aria-expanded",
      "true"
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Open subagent Scout/ })).toHaveFocus();
    });
    expect(screen.getByRole("button", { name: /Open subagent Scout/ }).parentElement?.scrollTop)
      .toBe(72);
    expect(scrollTo).toHaveBeenLastCalledWith({
      behavior: "auto",
      left: window.scrollX,
      top: 123
    });
  });

  it("clears stale child focus context and falls back to the panel summary", async () => {
    const { unmount } = render(
      <SubagentSessionsPanel
        hasMore={false}
        isLoading={false}
        loadFailed={false}
        parentSessionId="codex:parent"
        sessions={[session("Scout", "running")]}
        onOpenSession={vi.fn()}
        onRetry={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /subagents/i }));
    fireEvent.click(screen.getByRole("button", { name: /Open subagent Scout/ }));
    unmount();
    render(
      <SubagentSessionsPanel
        hasMore={false}
        isLoading={false}
        loadFailed={false}
        parentSessionId="codex:parent"
        sessions={[session("Archivist", "idle")]}
        onOpenSession={vi.fn()}
        onRetry={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /subagents/i })).toHaveFocus();
      expect(readSubagentPanelViewState(window.history.state, "codex:parent").returnFocusSessionId)
        .toBeNull();
    });
  });

  it("restores row focus while the previous child Back control is still focused", async () => {
    window.history.replaceState(writeSubagentPanelViewState(null, {
      expanded: true,
      parentSessionId: "codex:parent",
      returnFocusSessionId: "codex:Scout",
      scrollTop: 0,
      windowScrollY: null
    }), "");
    const previousBack = document.createElement("button");

    previousBack.textContent = "Back to parent";
    document.body.append(previousBack);
    previousBack.focus();
    render(
      <SubagentSessionsPanel
        hasMore={false}
        isLoading={false}
        loadFailed={false}
        parentSessionId="codex:parent"
        sessions={[session("Scout", "idle")]}
        onOpenSession={vi.fn()}
        onRetry={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Open subagent Scout/ })).toHaveFocus();
    });

    previousBack.remove();
  });

  it("clears stale focus context when no child rows remain", async () => {
    window.history.replaceState(writeSubagentPanelViewState(null, {
      expanded: true,
      parentSessionId: "codex:parent",
      returnFocusSessionId: "codex:missing",
      scrollTop: 72,
      windowScrollY: null
    }), "");
    render(
      <SubagentSessionsPanel
        hasMore={false}
        isLoading={false}
        loadFailed={false}
        parentSessionId="codex:parent"
        sessions={[]}
        onOpenSession={vi.fn()}
        onRetry={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(readSubagentPanelViewState(window.history.state, "codex:parent").returnFocusSessionId)
        .toBeNull();
    });
  });
});
