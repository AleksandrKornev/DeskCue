import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { workspacesApi } from "@api/endpoint/workspaces/endpoints";
import {
  downloadLocalAsset,
  openLocalAssetInNewTab
} from "@modules/transcript/RichTranscriptContent/localAssetActions";

import { FilesTabPanel } from "./FilesTabPanel";
import styles from "./styles.module.scss";

vi.mock("@api/endpoint/workspaces/endpoints", () => ({
  workspacesApi: {
    listFiles: vi.fn(),
    readFile: vi.fn()
  }
}));
vi.mock("@modules/transcript/RichTranscriptContent/localAssetActions", () => ({
  downloadLocalAsset: vi.fn(),
  openLocalAssetInNewTab: vi.fn()
}));

const listFiles = vi.mocked(workspacesApi.listFiles);
const readFile = vi.mocked(workspacesApi.readFile);
const downloadAsset = vi.mocked(downloadLocalAsset);
const openAsset = vi.mocked(openLocalAssetInNewTab);

describe("FilesTabPanel", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    listFiles.mockReset();
    readFile.mockReset();
    downloadAsset.mockReset();
    openAsset.mockReset();
    listFiles.mockResolvedValue({
      entries: [
        {
          kind: "directory",
          modifiedAt: "2026-08-07T09:00:00.000Z",
          name: "src",
          path: "src",
          readable: true,
          sizeBytes: null
        },
        {
          kind: "file",
          modifiedAt: "2026-08-07T09:00:00.000Z",
          name: "README.md",
          path: "README.md",
          readable: true,
          sizeBytes: 14
        }
      ],
      hasMore: false,
      nextCursor: null,
      path: "",
      workspaceId: "workspace-1"
    });
    readFile.mockResolvedValue({
      binary: false,
      content: "# DeskCue",
      modifiedAt: "2026-08-07T09:00:00.000Z",
      path: "README.md",
      sizeBytes: 14,
      truncated: false,
      workspaceId: "workspace-1"
    });
  });

  it("offers file actions before opening a read-only preview", async () => {
    render(
      <FilesTabPanel
        changedFiles={["README.md"]}
        workspaceId="workspace-1"
        workspaceName="DeskCue"
      />
    );

    expect(await screen.findByRole("button", { name: "File README.md (changed)" }))
      .toBeInTheDocument();
    expect(listFiles).toHaveBeenCalledWith("workspace-1", expect.objectContaining({
      cursor: null,
      limit: 80,
      path: ""
    }));

    fireEvent.click(screen.getByRole("button", { name: "File README.md (changed)" }));

    expect(screen.getByRole("dialog", { name: "README.md" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
    expect(readFile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(await screen.findByText("# DeskCue")).toBeInTheDocument();
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(readFile.mock.calls[0]?.slice(0, 2)).toEqual(["workspace-1", "README.md"]);
    expect(readFile.mock.calls[0]?.[2]?.signal).toBeInstanceOf(AbortSignal);
    const search = screen.getByRole("searchbox", { name: "Filter files in this folder" });

    expect(search).toHaveAttribute("name", "workspace-file-filter");

    expect(search.parentElement?.parentElement).toHaveClass(styles.filesFiltersViewingFile);

    fireEvent.click(screen.getByRole("button", { name: "← Files" }));
    expect(search.parentElement?.parentElement).not.toHaveClass(styles.filesFiltersViewingFile);
    expect(screen.getByRole("button", { name: "Changed 1" })).toBeInTheDocument();
  });

  it("opens and downloads workspace files through scoped asset tickets", async () => {
    openAsset.mockResolvedValue();
    downloadAsset.mockResolvedValue();
    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    const fileRow = await screen.findByRole("button", { name: "File README.md" });

    fireEvent.click(fileRow);

    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() => expect(openAsset).toHaveBeenCalledWith(
      "README.md",
      "README.md",
      { workspaceId: "workspace-1" }
    ));
    expect(readFile).not.toHaveBeenCalled();

    fireEvent.click(fileRow);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() => expect(downloadAsset).toHaveBeenCalledWith(
      "README.md",
      "README.md",
      { workspaceId: "workspace-1" }
    ));
    expect(readFile).not.toHaveBeenCalled();
  });

  it("does not let a stale file action close or disable a newer dialog", async () => {
    let finishOpen = () => {};

    openAsset.mockImplementation(() => new Promise<void>((resolve) => {
      finishOpen = resolve;
    }));
    listFiles.mockResolvedValue({
      entries: [
        {
          kind: "file",
          modifiedAt: "2026-08-07T09:00:00.000Z",
          name: "README.md",
          path: "README.md",
          readable: true,
          sizeBytes: 14
        },
        {
          kind: "file",
          modifiedAt: "2026-08-07T09:00:00.000Z",
          name: "CHANGELOG.md",
          path: "CHANGELOG.md",
          readable: true,
          sizeBytes: 20
        }
      ],
      hasMore: false,
      nextCursor: null,
      path: "",
      workspaceId: "workspace-1"
    });

    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    fireEvent.click(await screen.findByRole("button", { name: "File README.md" }));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    fireEvent.click(screen.getByRole("button", { name: "File CHANGELOG.md" }));

    expect(screen.getByRole("dialog", { name: "CHANGELOG.md" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeEnabled();

    await act(async () => {
      finishOpen();
      await Promise.resolve();
    });

    expect(screen.getByRole("dialog", { name: "CHANGELOG.md" })).toBeInTheDocument();
  });

  it("expands a file preview and exits with Escape", async () => {
    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    fireEvent.click(await screen.findByRole("button", { name: "File README.md" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByText("# DeskCue");

    fireEvent.click(screen.getByRole("button", { name: "Open full-screen file view" }));
    expect(screen.getByRole("button", { name: "Exit full-screen file view" }))
      .toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Open full-screen file view" }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("navigates directories lazily instead of loading the tree eagerly", async () => {
    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    fireEvent.click(await screen.findByRole("button", { name: "Folder src" }));

    await waitFor(() => expect(listFiles).toHaveBeenLastCalledWith(
      "workspace-1",
      expect.objectContaining({
      cursor: null,
      limit: 80,
      path: "src"
      })
    ));
  });

  it("keeps an explicit parent-folder action and disables it at workspace root", async () => {
    listFiles.mockImplementation((_workspaceId, options) => {
      const path = options?.path ?? "";

      return Promise.resolve({
        entries: path === ""
          ? [{
              kind: "directory",
              modifiedAt: "2026-08-07T09:00:00.000Z",
              name: "src",
              path: "src",
              readable: true,
              sizeBytes: null
            }]
          : [],
        hasMore: false,
        nextCursor: null,
        path,
        workspaceId: "workspace-1"
      });
    });

    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    const upButton = screen.getByRole("button", { name: "Go to parent folder" });

    expect(upButton).toBeDisabled();

    fireEvent.click(await screen.findByRole("button", { name: "Folder src" }));
    await waitFor(() => expect(upButton).toBeEnabled());
    fireEvent.click(upButton);

    await waitFor(() => expect(listFiles).toHaveBeenLastCalledWith(
      "workspace-1",
      expect.objectContaining({ path: "" })
    ));
    expect(upButton).toBeDisabled();
  });

  it("does not expose a browser when the chat has no workspace", () => {
    render(<FilesTabPanel workspaceId={null} workspaceName={null} />);

    expect(screen.getByText("No workspace linked")).toBeInTheDocument();
    expect(listFiles).not.toHaveBeenCalled();
  });

  it("explains why symbolic links are unavailable", async () => {
    listFiles.mockResolvedValue({
      entries: [{
        kind: "symlink",
        modifiedAt: "2026-08-07T09:00:00.000Z",
        name: "outside",
        path: "outside",
        readable: false,
        sizeBytes: null
      }],
      hasMore: false,
      nextCursor: null,
      path: "",
      workspaceId: "workspace-1"
    });

    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    const link = await screen.findByRole("button", {
      name: "Symbolic link outside, unavailable"
    });

    expect(link).toBeDisabled();
    expect(link).toHaveAttribute("title", "This entry cannot be opened from DeskCue.");
  });

  it("renders binary metadata without putting binary content in the page", async () => {
    readFile.mockResolvedValue({
      binary: true,
      content: null,
      modifiedAt: "2026-08-07T09:00:00.000Z",
      path: "image.png",
      sizeBytes: 512,
      truncated: false,
      workspaceId: "workspace-1"
    });
    listFiles.mockResolvedValue({
      entries: [{
        kind: "file",
        modifiedAt: "2026-08-07T09:00:00.000Z",
        name: "image.png",
        path: "image.png",
        readable: true,
        sizeBytes: 512
      }],
      hasMore: false,
      nextCursor: null,
      path: "",
      workspaceId: "workspace-1"
    });

    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);
    fireEvent.click(await screen.findByRole("button", { name: "File image.png" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(await screen.findByText("Binary file")).toBeInTheDocument();
    expect(screen.getByText("DeskCue does not load binary file contents into the browser."))
      .toBeInTheDocument();
  });

  it("opens a requested changed file and links back to its change", async () => {
    const onOpenChanges = vi.fn();

    render(
      <FilesTabPanel
        changedFiles={["README.md"]}
        requestedPath="README.md"
        workspaceId="workspace-1"
        workspaceName="DeskCue"
        onOpenChanges={onOpenChanges}
      />
    );

    expect(await screen.findByText("# DeskCue")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View change" }));
    expect(onOpenChanges).toHaveBeenCalledWith("README.md");
  });

  it("filters the current folder without issuing another request", async () => {
    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);
    await screen.findByRole("button", { name: "File README.md" });

    fireEvent.change(screen.getByRole("searchbox", { name: "Filter files in this folder" }), {
      target: { value: "read" }
    });

    expect(screen.getByRole("button", { name: "File README.md" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Folder src" })).not.toBeInTheDocument();
    expect(listFiles).toHaveBeenCalledTimes(1);
  });

  it("keeps path navigation separate from the filter and changed controls", async () => {
    render(
      <FilesTabPanel
        changedFiles={["README.md"]}
        workspaceId="workspace-1"
        workspaceName="DeskCue"
      />
    );

    await screen.findByRole("button", { name: "File README.md (changed)" });

    const breadcrumbs = screen.getByRole("navigation", { name: "Workspace path" });
    const search = screen.getByRole("searchbox", { name: "Filter files in this folder" });
    const changed = screen.getByRole("button", { name: "Changed 1" });

    expect(search.parentElement?.parentElement).toBe(changed.parentElement);
    expect(breadcrumbs.parentElement?.parentElement).not.toBe(changed.parentElement);
  });
});
