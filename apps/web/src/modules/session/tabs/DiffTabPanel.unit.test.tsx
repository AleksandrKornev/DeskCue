import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DiffTabPanel } from "./DiffTabPanel";

describe("DiffTabPanel", () => {
  it("shows one useful source-chat empty state without workspace git controls", () => {
    render(
      <DiffTabPanel
        git={null}
        showWorkspaceGit={false}
        sourceDiffParts={[]}
        onRefreshGit={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "Agent-reported changes" })).toBeInTheDocument();
    expect(screen.getByText("Agent-reported file changes will appear here.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
  });

  it("keeps transcript-backed changes visible for a source chat", () => {
    render(
      <DiffTabPanel
        git={null}
        showWorkspaceGit={false}
        sourceDiffParts={[{
          additions: 1,
          changeType: "update",
          deletions: 0,
          filePath: "src/app.ts",
          text: "+const ready = true;",
          title: "src/app.ts",
          type: "diff"
        }]}
        onRefreshGit={vi.fn()}
      />
    );

    expect(screen.getByTitle("src/app.ts")).toBeInTheDocument();
    expect(screen.queryByText("Agent-reported file changes will appear here.")).not.toBeInTheDocument();
  });

  it("reviews one selected workspace patch and opens the same file", () => {
    const onOpenFile = vi.fn();
    render(
      <DiffTabPanel
        git={{
          branch: "main",
          changedFiles: ["src/app.ts"],
          diff: [
            "diff --git a/src/app.ts b/src/app.ts",
            "--- a/src/app.ts",
            "+++ b/src/app.ts",
            "@@ -1 +1 @@",
            "-const ready = false;",
            "+const ready = true;"
          ].join("\n"),
          isDirty: true,
          isGitRepo: true,
          lastUpdatedAt: "2026-08-07T10:00:00.000Z"
        }}
        sourceDiffParts={[]}
        onOpenFile={onOpenFile}
        onRefreshGit={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "1 workspace change" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Diff for src/app.ts" })).toHaveTextContent("const ready = true;");
    screen.getByRole("button", { name: "Open in Files" }).click();
    expect(onOpenFile).toHaveBeenCalledWith("src/app.ts");
  });

  it("keeps projected changes read only when runtime controls are unavailable", () => {
    render(
      <DiffTabPanel
        git={{
          branch: "main",
          changedFiles: ["src/app.ts"],
          diff: "",
          isDirty: true,
          isGitRepo: true,
          lastUpdatedAt: "2026-08-07T10:00:00.000Z"
        }}
        sourceDiffParts={[]}
      />
    );

    expect(screen.getByRole("heading", { name: "1 workspace change" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open in Files" })).not.toBeInTheDocument();
  });

  it("does not keep a stale diff visible when the filter has no matches", () => {
    render(
      <DiffTabPanel
        git={{
          branch: "main",
          changedFiles: ["src/app.ts"],
          diff: [
            "diff --git a/src/app.ts b/src/app.ts",
            "--- a/src/app.ts",
            "+++ b/src/app.ts",
            "@@ -1 +1 @@",
            "-const ready = false;",
            "+const ready = true;"
          ].join("\n"),
          isDirty: true,
          isGitRepo: true,
          lastUpdatedAt: "2026-08-07T10:00:00.000Z"
        }}
        sourceDiffParts={[]}
      />
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Filter workspace changes" }), {
      target: { value: "missing-file" }
    });

    expect(screen.getByText("No changed files match this filter.")).toBeInTheDocument();
    expect(screen.getByText("No matching file selected")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Diff for src/app.ts" })).not.toBeInTheDocument();
  });
});
