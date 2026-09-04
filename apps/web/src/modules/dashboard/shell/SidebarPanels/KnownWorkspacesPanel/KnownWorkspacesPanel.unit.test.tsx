import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WorkspaceSummary } from "@deskcue/protocol";

import { KnownWorkspacesPanel } from "./KnownWorkspacesPanel";

function createWorkspace(index: number): WorkspaceSummary {
  return {
    id: `workspace-${index}`,
    name: index === 5 ? "Release console" : `Workspace ${index}`,
    path: index === 5 ? "D:\\work\\release-console" : `D:\\work\\workspace-${index}`,
    isGitRepo: true,
    branch: index === 5 ? "release/mobile" : "main",
    createdAt: "2026-08-30T00:00:00.000Z"
  };
}

function renderPanel(workspaces = Array.from({ length: 8 }, (_, index) => createWorkspace(index))) {
  const onSelectWorkspace = vi.fn();

  const view = render(
    <KnownWorkspacesPanel
      compact
      isBootstrapping={false}
      isOpen
      selectedWorkspaceId=""
      workspaces={workspaces}
      onSelectWorkspace={onSelectWorkspace}
      onToggleOpen={vi.fn()}
    />
  );

  return { onSelectWorkspace, ...view };
}

describe("KnownWorkspacesPanel", () => {
  it("filters a long workspace list by name, path, or branch", () => {
    const { onSelectWorkspace } = renderPanel();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search workspaces" }), {
      target: { value: "release/mobile" }
    });

    expect(screen.getByText("1 of 8 workspaces")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Release console/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Workspace 0/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Release console/ }));
    expect(onSelectWorkspace).toHaveBeenCalledWith("workspace-5");
  });

  it("provides an actionable empty state and restores the complete list", () => {
    renderPanel();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search workspaces" }), {
      target: { value: "missing workspace" }
    });

    expect(screen.getByText("0 of 8 workspaces")).toBeInTheDocument();
    expect(screen.getByText("No matching workspaces")).toBeInTheDocument();
    expect(screen.getByText("Try a name, path, or branch.")).toBeInTheDocument();

    const searchInput = screen.getByRole("searchbox", { name: "Search workspaces" });

    fireEvent.click(screen.getByRole("button", { name: "Clear workspace search" }));

    expect(screen.getByText("8 workspaces")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Workspace 0/ })).toBeInTheDocument();
    expect(searchInput).toHaveFocus();
  });

  it("does not add search chrome to a short workspace list", () => {
    renderPanel([createWorkspace(0), createWorkspace(1)]);

    expect(screen.queryByRole("searchbox", { name: "Search workspaces" })).not.toBeInTheDocument();
  });

  it("does not keep an invisible filter when the list falls below the search threshold", () => {
    const { rerender } = renderPanel();
    const searchInput = screen.getByRole("searchbox", { name: "Search workspaces" });

    fireEvent.change(searchInput, {
      target: { value: "release/mobile" }
    });

    searchInput.focus();

    rerender(
      <KnownWorkspacesPanel
        compact
        isBootstrapping={false}
        isOpen
        selectedWorkspaceId=""
        workspaces={[createWorkspace(0), createWorkspace(1)]}
        onSelectWorkspace={vi.fn()}
        onToggleOpen={vi.fn()}
      />
    );

    expect(screen.queryByRole("searchbox", { name: "Search workspaces" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Workspace 0/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Workspace 1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Workspace 0/ })).toHaveFocus();

    rerender(
      <KnownWorkspacesPanel
        compact
        isBootstrapping={false}
        isOpen
        selectedWorkspaceId=""
        workspaces={Array.from({ length: 8 }, (_, index) => createWorkspace(index))}
        onSelectWorkspace={vi.fn()}
        onToggleOpen={vi.fn()}
      />
    );

    expect(screen.getByRole("searchbox", { name: "Search workspaces" })).toHaveValue("");
    expect(screen.getByText("8 workspaces")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Workspace 0/ })).toHaveFocus();
  });

  it("exposes the currently selected workspace", () => {
    render(
      <KnownWorkspacesPanel
        compact
        isBootstrapping={false}
        isOpen
        selectedWorkspaceId="workspace-1"
        workspaces={[createWorkspace(0), createWorkspace(1)]}
        onSelectWorkspace={vi.fn()}
        onToggleOpen={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /Workspace 1/, current: true })).toBeInTheDocument();
  });

  it("preserves search focus through an empty registry update", () => {
    const workspaces = Array.from({ length: 8 }, (_, index) => createWorkspace(index));
    const { rerender } = renderPanel(workspaces);
    const searchInput = screen.getByRole("searchbox", { name: "Search workspaces" });

    fireEvent.change(searchInput, { target: { value: "release" } });
    searchInput.focus();
    rerender(
      <KnownWorkspacesPanel
        compact
        isBootstrapping={false}
        isOpen
        selectedWorkspaceId=""
        workspaces={[]}
        onSelectWorkspace={vi.fn()}
        onToggleOpen={vi.fn()}
      />
    );

    expect(screen.getByText("No local workspace registered yet")).toHaveFocus();

    rerender(
      <KnownWorkspacesPanel
        compact
        isBootstrapping={false}
        isOpen
        selectedWorkspaceId=""
        workspaces={workspaces}
        onSelectWorkspace={vi.fn()}
        onToggleOpen={vi.fn()}
      />
    );

    expect(screen.getByRole("searchbox", { name: "Search workspaces" })).toHaveFocus();
    expect(screen.getByRole("searchbox", { name: "Search workspaces" })).toHaveValue("");
  });

  it("preserves search focus through bootstrapping", () => {
    const workspaces = Array.from({ length: 8 }, (_, index) => createWorkspace(index));
    const { rerender } = renderPanel(workspaces);
    const searchInput = screen.getByRole("searchbox", { name: "Search workspaces" });

    searchInput.focus();
    rerender(
      <KnownWorkspacesPanel
        compact
        isBootstrapping
        isOpen
        selectedWorkspaceId=""
        workspaces={workspaces}
        onSelectWorkspace={vi.fn()}
        onToggleOpen={vi.fn()}
      />
    );

    expect(screen.getByText("Loading workspaces…")).toHaveFocus();

    rerender(
      <KnownWorkspacesPanel
        compact
        isBootstrapping={false}
        isOpen
        selectedWorkspaceId=""
        workspaces={workspaces}
        onSelectWorkspace={vi.fn()}
        onToggleOpen={vi.fn()}
      />
    );

    expect(screen.getByRole("searchbox", { name: "Search workspaces" })).toHaveFocus();
  });

  it("hands focus from loading to a short recovered list", () => {
    const workspaces = Array.from({ length: 8 }, (_, index) => createWorkspace(index));
    const { rerender } = renderPanel(workspaces);
    const searchInput = screen.getByRole("searchbox", { name: "Search workspaces" });

    searchInput.focus();
    rerender(
      <KnownWorkspacesPanel
        compact
        isBootstrapping
        isOpen
        selectedWorkspaceId=""
        workspaces={workspaces}
        onSelectWorkspace={vi.fn()}
        onToggleOpen={vi.fn()}
      />
    );

    rerender(
      <KnownWorkspacesPanel
        compact
        isBootstrapping
        isOpen
        selectedWorkspaceId=""
        workspaces={[createWorkspace(0), createWorkspace(1)]}
        onSelectWorkspace={vi.fn()}
        onToggleOpen={vi.fn()}
      />
    );

    rerender(
      <KnownWorkspacesPanel
        compact
        isBootstrapping={false}
        isOpen
        selectedWorkspaceId=""
        workspaces={[createWorkspace(0), createWorkspace(1)]}
        onSelectWorkspace={vi.fn()}
        onToggleOpen={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /Workspace 0/ })).toHaveFocus();
  });

  it("does not restore focus after a same-task voluntary null-target blur", () => {
    const { rerender } = renderPanel();
    const searchInput = screen.getByRole("searchbox", { name: "Search workspaces" });

    searchInput.focus();
    searchInput.blur();
    rerender(
      <KnownWorkspacesPanel
        compact
        isBootstrapping={false}
        isOpen
        selectedWorkspaceId=""
        workspaces={[createWorkspace(0), createWorkspace(1)]}
        onSelectWorkspace={vi.fn()}
        onToggleOpen={vi.fn()}
      />
    );

    expect(document.body).toHaveFocus();
  });
});
