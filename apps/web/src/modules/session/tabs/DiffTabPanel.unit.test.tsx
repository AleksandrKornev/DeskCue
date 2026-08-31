import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DiffTabPanel } from "./DiffTabPanel";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

function createMatchMediaController(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<() => void>();
  const mediaQuery = {
    get matches() {
      return matches;
    },
    media: "(max-width: 900px)",
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener)
  };

  return {
    matchMedia: vi.fn(() => mediaQuery),
    setMatches(nextMatches: boolean) {
      matches = nextMatches;
      listeners.forEach((listener) => listener());
    }
  };
}

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
    expect(screen.getByRole("button", {
      name: "Modified: src/app.ts, 1 addition, 1 deletion"
    })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Diff for src/app.ts" })).toHaveTextContent("const ready = true;");
    expect(screen.getByRole("region", { name: "Diff for src/app.ts" })).toHaveAttribute("tabindex", "0");
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

  it("does not call a dirty workspace clean when only hidden changes remain", () => {
    render(
      <DiffTabPanel
        git={{
          branch: "main",
          changedFiles: ["package-lock.json"],
          changedFileStatuses: { "package-lock.json": "M" },
          diff: "",
          isDirty: true,
          isGitRepo: true,
          lastUpdatedAt: "2026-08-07T10:00:00.000Z"
        }}
        sourceDiffParts={[]}
      />
    );

    expect(screen.getByRole("heading", { name: "0 reviewable workspace changes" })).toBeInTheDocument();
    expect(screen.getByText("Only hidden changes remain")).toBeInTheDocument();
    expect(screen.getByText("1 generated or temporary file is hidden.")).toBeInTheDocument();
    expect(screen.queryByText("Working tree is clean")).not.toBeInTheDocument();
  });

  it("keeps the beginning of a large tracked patch visible and labels the bounded view", () => {
    render(
      <DiffTabPanel
        git={{
          branch: "main",
          changedFiles: ["large.txt"],
          changedFileStatuses: { "large.txt": "M" },
          diff: [
            "diff --git a/large.txt b/large.txt",
            "--- a/large.txt",
            "+++ b/large.txt",
            "@@ -1 +1 @@",
            "-before",
            `+visible-prefix-${"x".repeat(20_000)}`
          ].join("\n"),
          isDirty: true,
          isGitRepo: true,
          lastUpdatedAt: "2026-08-07T10:00:00.000Z"
        }}
        sourceDiffParts={[]}
      />
    );

    expect(screen.getByText("Workspace diff truncated to keep review responsive.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Diff for large.txt" })).toHaveTextContent("visible-prefix-");
    expect(screen.queryByText("No textual patch available")).not.toBeInTheDocument();
  });

  it("explains when a later file patch falls outside the bounded workspace diff", () => {
    render(
      <DiffTabPanel
        git={{
          branch: "main",
          changedFiles: ["large.txt", "renamed.txt"],
          changedFilePreviousPaths: { "renamed.txt": "old.txt" },
          changedFileStatuses: { "large.txt": "M", "renamed.txt": "R" },
          diff: [
            "diff --git a/large.txt b/large.txt",
            "--- a/large.txt",
            "+++ b/large.txt",
            "@@ -1 +1 @@",
            "-before",
            `+${"x".repeat(20_000)}`,
            "diff --git a/old.txt b/renamed.txt",
            "similarity index 100%",
            "rename from old.txt",
            "rename to renamed.txt"
          ].join("\n"),
          isDirty: true,
          isGitRepo: true,
          lastUpdatedAt: "2026-08-07T10:00:00.000Z"
        }}
        sourceDiffParts={[]}
        onOpenFile={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /renamed\.txt/ }));

    expect(screen.getByText("old.txt → renamed.txt")).toBeInTheDocument();
    expect(screen.getByText("This file's patch is not included in the bounded workspace diff. Open it in Files to inspect the current contents.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Open in Files" })).toHaveLength(1);
  });

  it("keeps truncation truth when an oversized hidden block consumes the bounded diff", () => {
    render(
      <DiffTabPanel
        git={{
          branch: "main",
          changedFiles: ["build/00-large.txt", "removed.txt"],
          changedFileStatuses: { "build/00-large.txt": "M", "removed.txt": "D" },
          diff: [
            "diff --git a/build/00-large.txt b/build/00-large.txt",
            "--- a/build/00-large.txt",
            "+++ b/build/00-large.txt",
            "@@ -1 +1 @@",
            `+${"x".repeat(20_000)}`
          ].join("\n"),
          diffTruncated: true,
          isDirty: true,
          isGitRepo: true,
          lastUpdatedAt: "2026-08-07T10:00:00.000Z"
        }}
        sourceDiffParts={[]}
      />
    );

    expect(screen.getByText("Workspace diff truncated to keep review responsive.")).toBeInTheDocument();
    expect(screen.getByText("This deleted file's patch is not included in the bounded workspace diff; use Git to inspect its previous contents.")).toBeInTheDocument();
    expect(screen.queryByText("This file is deleted from the working tree; use Git to inspect its previous contents.")).not.toBeInTheDocument();
  });

  it("does not offer to open a deleted path that no longer exists", () => {
    render(
      <DiffTabPanel
        git={{
          branch: "main",
          changedFiles: ["removed.bin"],
          changedFileStatuses: { "removed.bin": "D" },
          diff: "",
          isDirty: true,
          isGitRepo: true,
          lastUpdatedAt: "2026-08-07T10:00:00.000Z"
        }}
        sourceDiffParts={[]}
        onOpenFile={vi.fn()}
      />
    );

    expect(screen.getByText("This file is deleted from the working tree; use Git to inspect its previous contents.")).toBeInTheDocument();
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
    expect(screen.getByRole("status", { name: "0 matching workspace changes" }))
      .toHaveTextContent("0");
    expect(screen.getByText("No matching file selected")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Diff for src/app.ts" })).not.toBeInTheDocument();
  });

  it("announces the total match count when the visible file list is bounded", () => {
    const changedFiles = Array.from({ length: 41 }, (_, index) => `src/file-${index}.ts`);

    render(
      <DiffTabPanel
        git={{
          branch: "main",
          changedFiles,
          diff: "",
          isDirty: true,
          isGitRepo: true,
          lastUpdatedAt: "2026-08-07T10:00:00.000Z"
        }}
        sourceDiffParts={[]}
      />
    );

    expect(screen.getByRole("status", { name: "41 matching workspace changes" }))
      .toHaveTextContent("41");
    expect(screen.getAllByRole("button", { name: /Details unavailable: src\/file-/ }))
      .toHaveLength(40);
    expect(screen.getByText("1 more matching file is outside this bounded view."))
      .toBeInTheDocument();
  });

  it("announces loading workspace changes", () => {
    render(<DiffTabPanel git={null} sourceDiffParts={[]} />);

    expect(screen.getByRole("status", { name: "Loading workspace changes" }))
      .toBeInTheDocument();
  });

  it("shows bounded progress while refreshing workspace changes", async () => {
    const request = deferred();
    const onRefreshGit = vi.fn(() => request.promise);

    render(
      <DiffTabPanel
        git={{
          branch: "main",
          changedFiles: [],
          diff: "",
          isDirty: false,
          isGitRepo: true,
          lastUpdatedAt: "2026-08-07T10:00:00.000Z"
        }}
        sourceDiffParts={[]}
        onRefreshGit={onRefreshGit}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(screen.getByRole("button", { name: "Refreshing…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Refreshing…" })).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      request.resolve();
      await request.promise;
    });

    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
  });

  it("recovers the Refresh action after a rejected request", async () => {
    const onRefreshGit = vi.fn(() => Promise.reject(new Error("refresh failed")));

    render(
      <DiffTabPanel
        git={{
          branch: "main",
          changedFiles: [],
          diff: "",
          isDirty: false,
          isGitRepo: true,
          lastUpdatedAt: "2026-08-07T10:00:00.000Z"
        }}
        sourceDiffParts={[]}
        onRefreshGit={onRefreshGit}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
    expect(screen.getByRole("status", { name: "" }))
      .toHaveTextContent("Could not refresh workspace changes");
  });

  it("moves focus between the mobile file list and review detail", () => {
    render(
      <DiffTabPanel
        git={{
          branch: "main",
          changedFiles: ["src/app.ts"],
          changedFileStatuses: { "src/app.ts": "M" },
          diff: "",
          isDirty: true,
          isGitRepo: true,
          lastUpdatedAt: "2026-08-07T10:00:00.000Z"
        }}
        sourceDiffParts={[]}
      />
    );

    const fileButton = screen.getByRole("button", { name: "Modified: src/app.ts" });

    fireEvent.click(fileButton);

    expect(screen.getByRole("button", { name: "← Files" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "← Files" }));

    expect(fileButton).toHaveFocus();
  });

  it("moves focus from desktop detail to the mobile Back action after a compact resize", () => {
    const media = createMatchMediaController(false);

    vi.stubGlobal("matchMedia", media.matchMedia);

    render(
      <DiffTabPanel
        git={{
          branch: "main",
          changedFiles: ["src/app.ts"],
          changedFileStatuses: { "src/app.ts": "M" },
          diff: "",
          isDirty: true,
          isGitRepo: true,
          lastUpdatedAt: "2026-08-07T10:00:00.000Z"
        }}
        sourceDiffParts={[]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Modified: src/app.ts" }));

    expect(screen.getByRole("article", { name: "Change details for src/app.ts" }))
      .toHaveFocus();

    act(() => media.setMatches(true));

    expect(screen.getByRole("button", { name: "← Files" })).toHaveFocus();
    vi.unstubAllGlobals();
  });

  it("resets local review state when the owning session key changes", () => {
    const git = {
      branch: "main",
      changedFiles: ["src/app.ts"],
      diff: "",
      isDirty: true,
      isGitRepo: true,
      lastUpdatedAt: "2026-08-07T10:00:00.000Z"
    };

    const { rerender } = render(
      <DiffTabPanel git={git} key="session-a" sourceDiffParts={[]} />
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Filter workspace changes" }), {
      target: { value: "missing" }
    });

    rerender(<DiffTabPanel git={git} key="session-b" sourceDiffParts={[]} />);

    expect(screen.getByRole("searchbox", { name: "Filter workspace changes" }))
      .toHaveValue("");
  });

  it("does not reopen a reviewed file after Back when the same preference refreshes", () => {
    const git = {
      branch: "main",
      changedFiles: ["src/app.ts"],
      changedFileStatuses: { "src/app.ts": "M" as const },
      diff: "",
      isDirty: true,
      isGitRepo: true,
      lastUpdatedAt: "2026-08-07T10:00:00.000Z"
    };

    const { container, rerender } = render(
      <DiffTabPanel
        git={git}
        preferredFilePath="src/app.ts"
        sourceDiffParts={[]}
      />
    );

    expect(container.querySelector("[class*='changesLayoutReviewing']"))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "← Files" }));

    expect(container.querySelector("[class*='changesLayoutReviewing']"))
      .not.toBeInTheDocument();

    rerender(
      <DiffTabPanel
        git={{ ...git, lastUpdatedAt: "2026-08-07T10:01:00.000Z" }}
        preferredFilePath="src/app.ts"
        sourceDiffParts={[]}
      />
    );

    expect(container.querySelector("[class*='changesLayoutReviewing']"))
      .not.toBeInTheDocument();
  });
});
