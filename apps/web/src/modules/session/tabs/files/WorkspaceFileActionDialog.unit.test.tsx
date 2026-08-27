import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WorkspaceFileEntry } from "@deskcue/protocol";

import { WorkspaceFileActionDialog } from "./WorkspaceFileActionDialog";

function createFile(path: string): WorkspaceFileEntry {
  return {
    kind: "file",
    modifiedAt: "2026-08-27T09:00:00.000Z",
    name: "README.md",
    path,
    readable: true,
    sizeBytes: 14
  };
}

describe("WorkspaceFileActionDialog", () => {
  it("does not repeat a root filename as its description", () => {
    render(
      <WorkspaceFileActionDialog
        file={createFile("README.md")}
        workspaceId="workspace-1"
        onClose={vi.fn()}
        onPreview={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "README.md" });

    expect(screen.getAllByText("README.md")).toHaveLength(1);
    expect(dialog).not.toHaveAttribute("aria-describedby");
  });

  it("keeps the full path as context for a nested file", () => {
    const path = `${"nested/".repeat(580)}README.md`;

    render(
      <WorkspaceFileActionDialog
        file={createFile(path)}
        workspaceId="workspace-1"
        onClose={vi.fn()}
        onPreview={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog", { name: "README.md" }))
      .toHaveAccessibleDescription(path);
  });
});
