import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assetsApi } from "@api/endpoint/assets/endpoints";
import { workspacesApi } from "@api/endpoint/workspaces/endpoints";
import {
  downloadLocalAsset,
  openLocalAssetInNewTab
} from "@modules/transcript/RichTranscriptContent/localAssetActions";

import { MAX_WORKSPACE_IMAGE_PREVIEW_BYTES } from "./constants";
import { FilesTabPanel } from "./FilesTabPanel";
import {
  buildWorkspaceFileLineNumberWidth,
  readWorkspaceImagePreviewMaxBytes
} from "./helpers";
import styles from "./styles.module.scss";

vi.mock("@api/endpoint/workspaces/endpoints", () => ({
  workspacesApi: {
    listFiles: vi.fn(),
    readFile: vi.fn()
  }
}));
vi.mock("@api/endpoint/assets/endpoints", () => ({
  assetsApi: {
    getTicketBlob: vi.fn()
  }
}));
vi.mock("@modules/transcript/RichTranscriptContent/localAssetActions", () => ({
  downloadLocalAsset: vi.fn(),
  openLocalAssetInNewTab: vi.fn()
}));

const listFiles = vi.mocked(workspacesApi.listFiles);
const readFile = vi.mocked(workspacesApi.readFile);
const getTicketBlob = vi.mocked(assetsApi.getTicketBlob);
const downloadAsset = vi.mocked(downloadLocalAsset);
const openAsset = vi.mocked(openLocalAssetInNewTab);
const scrollCurrentBreadcrumbIntoView = vi.fn();
const resizeObserverCallbacks: ResizeObserverCallback[] = [];
const disconnectResizeObserver = vi.fn();

class TestResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeObserverCallbacks.push(callback);
  }

  disconnect() {
    disconnectResizeObserver();
  }

  observe() {}
  unobserve() {}
}

function createFilesMatchMediaController(initialCompact: boolean) {
  let compact = initialCompact;
  const listeners = new Map<string, Set<EventListener>>();
  const matchMedia = vi.fn((query: string) => {
    const queryListeners = listeners.get(query) ?? new Set<EventListener>();

    listeners.set(query, queryListeners);

    return {
      addEventListener: vi.fn((_type: string, listener: EventListener) => {
        queryListeners.add(listener);
      }),
      get matches() {
        return compact;
      },
      media: query,
      removeEventListener: vi.fn((_type: string, listener: EventListener) => {
        queryListeners.delete(listener);
      })
    } as unknown as MediaQueryList;
  });

  return {
    matchMedia,
    setCompact(nextCompact: boolean) {
      compact = nextCompact;
      listeners.forEach((queryListeners) => {
        const event = new Event("change");

        Object.defineProperty(event, "matches", { value: nextCompact });
        queryListeners.forEach((listener) => listener(event));
      });
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function FilesTabPanelHistoryHarness() {
  const [requestedPath, setRequestedPath] = useState("");

  return (
    <>
      <output aria-label="Selected workspace path">{requestedPath || "root"}</output>
      <FilesTabPanel
        requestedPath={requestedPath}
        workspaceId="workspace-1"
        workspaceName="DeskCue"
        onSelectFile={setRequestedPath}
      />
    </>
  );
}

describe("FilesTabPanel", () => {
  it("sizes the line-number gutter for bounded previews with five-digit line counts", () => {
    expect(buildWorkspaceFileLineNumberWidth(10_000)).toBe("6ch");
  });

  it("loads Cloud image previews through bounded remote asset chunks", () => {
    expect(readWorkspaceImagePreviewMaxBytes("cloud-machine")).toBe(MAX_WORKSPACE_IMAGE_PREVIEW_BYTES);
    expect(readWorkspaceImagePreviewMaxBytes("local")).toBe(MAX_WORKSPACE_IMAGE_PREVIEW_BYTES);
  });

  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    vi.spyOn(window.history, "go").mockImplementation(() => undefined);
    listFiles.mockReset();
    readFile.mockReset();
    getTicketBlob.mockReset();
    downloadAsset.mockReset();
    disconnectResizeObserver.mockReset();
    openAsset.mockReset();
    resizeObserverCallbacks.length = 0;
    scrollCurrentBreadcrumbIntoView.mockReset();
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollCurrentBreadcrumbIntoView
    });

    getTicketBlob.mockResolvedValue(new Blob(["image"], { type: "image/png" }));
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:workspace-image")
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn()
    });
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

  it("opens a read-only preview directly with its file actions", async () => {
    render(
      <FilesTabPanel
        changedFiles={["README.md"]}
        workspaceId="workspace-1"
        workspaceName="DeskCue"
      />
    );

    expect(await screen.findByRole("button", { name: "File README.md (changed)" }))
      .toBeInTheDocument();
    expect(screen.getByRole("status", { name: "2 matching entries in this folder" }))
      .toHaveTextContent("2");
    expect(listFiles).toHaveBeenCalledWith("workspace-1", expect.objectContaining({
      cursor: null,
      limit: 80,
      path: ""
    }));

    fireEvent.click(screen.getByRole("button", { name: "File README.md (changed)" }));

    expect(await screen.findByText("# DeskCue")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "File actions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open file" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download file" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "← Files" })).toHaveFocus());
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(readFile.mock.calls[0]?.slice(0, 2)).toEqual(["workspace-1", "README.md"]);
    expect(readFile.mock.calls[0]?.[2]?.signal).toBeInstanceOf(AbortSignal);
    expect(screen.getByText("DeskCue · 14 B · 1 line")).toBeInTheDocument();
    const search = screen.getByRole("searchbox", { name: "Filter files in this folder" });
    const toolbar = search.closest("header");

    expect(search).toHaveAttribute("name", "workspace-file-filter");
    expect(toolbar).toHaveClass(styles.filesToolbarViewingFile);
    expect(search.parentElement?.parentElement).toHaveClass(styles.filesFiltersViewingFile);

    fireEvent.click(screen.getByRole("button", { name: "← Files" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "File README.md (changed)" }))
      .toHaveFocus());
    expect(toolbar).not.toHaveClass(styles.filesToolbarViewingFile);
    expect(search.parentElement?.parentElement).not.toHaveClass(styles.filesFiltersViewingFile);
    expect(screen.getByRole("button", { name: "Changed 1" })).toBeInTheDocument();
  });

  it("keeps a zero line count in empty text-file metadata", async () => {
    readFile.mockResolvedValueOnce({
      binary: false,
      content: "",
      modifiedAt: "2026-08-07T09:00:00.000Z",
      path: "README.md",
      sizeBytes: 0,
      truncated: false,
      workspaceId: "workspace-1"
    });

    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    fireEvent.click(await screen.findByRole("button", { name: "File README.md" }));

    expect(await screen.findByText("DeskCue · 0 B · 0 lines")).toBeInTheDocument();
  });

  it("keeps the workspace name in a compact-height desktop toolbar", async () => {
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      addEventListener: vi.fn(),
      matches: query.includes("max-height: 640px"),
      media: query,
      removeEventListener: vi.fn()
    }) as unknown as MediaQueryList));

    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    expect(screen.getByLabelText("Workspace path")).toHaveTextContent("DeskCue");

    fireEvent.click(await screen.findByRole("button", { name: "File README.md" }));

    await waitFor(() => expect(screen.getByLabelText("File preview")).toHaveFocus());
    expect(screen.queryByRole("button", { name: "← Files" })).not.toBeInTheDocument();
  });

  it("moves focus from the disappearing mobile Back to the desktop preview", async () => {
    const media = createFilesMatchMediaController(true);

    vi.stubGlobal("matchMedia", media.matchMedia);

    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    fireEvent.click(await screen.findByRole("button", { name: "File README.md" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "← Files" }))
      .toHaveFocus());
    const fileViewer = screen.getByLabelText("File preview");

    fileViewer.scrollTop = 32;
    act(() => media.setCompact(false));

    expect(screen.queryByRole("button", { name: "← Files" })).not.toBeInTheDocument();
    expect(fileViewer).toHaveFocus();
    expect(fileViewer.scrollTop).toBe(0);
  });

  it("moves focus from desktop navigation hidden by a compact file preview to mobile Back", async () => {
    const media = createFilesMatchMediaController(false);

    vi.stubGlobal("matchMedia", media.matchMedia);

    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    fireEvent.click(await screen.findByRole("button", { name: "File README.md" }));
    await waitFor(() => expect(screen.getByLabelText("File preview")).toHaveFocus());

    screen.getByRole("searchbox", { name: "Filter files in this folder" }).focus();
    act(() => media.setCompact(true));

    expect(screen.getByRole("button", { name: "← Files" })).toHaveFocus();
  });

  it("moves focus from the desktop file list hidden by a compact file preview to mobile Back", async () => {
    const media = createFilesMatchMediaController(false);

    vi.stubGlobal("matchMedia", media.matchMedia);

    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    const fileRow = await screen.findByRole("button", { name: "File README.md" });

    fireEvent.click(fileRow);
    await waitFor(() => expect(screen.getByLabelText("File preview")).toHaveFocus());

    fileRow.focus();
    act(() => media.setCompact(true));

    expect(screen.getByRole("button", { name: "← Files" })).toHaveFocus();
  });

  it("keeps the focused mobile file header anchored through in-breakpoint resize", async () => {
    const media = createFilesMatchMediaController(true);

    vi.stubGlobal("matchMedia", media.matchMedia);

    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    fireEvent.click(await screen.findByRole("button", { name: "File README.md" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "← Files" })).toHaveFocus());

    const fileViewer = screen.getByLabelText("File preview");

    screen.getByRole("button", { name: "← Files" }).focus();
    fileViewer.scrollTop = 32;
    act(() => resizeObserverCallbacks.forEach((callback) => callback([], {} as ResizeObserver)));

    expect(fileViewer.scrollTop).toBe(0);

    screen.getByRole("button", { name: "Open file" }).focus();
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
    fileViewer.scrollTop = 24;
    act(() => resizeObserverCallbacks.forEach((callback) => callback([], {} as ResizeObserver)));

    expect(fileViewer.scrollTop).toBe(24);

    const fileContents = screen.getByLabelText("File contents");

    fileContents.focus();
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
    fileViewer.scrollTop = 24;
    act(() => resizeObserverCallbacks.forEach((callback) => callback([], {} as ResizeObserver)));

    expect(fileViewer.scrollTop).toBe(24);
  });

  it("preserves mobile Back focus ownership through its resize unmount", async () => {
    const media = createFilesMatchMediaController(true);

    vi.stubGlobal("matchMedia", media.matchMedia);

    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    fireEvent.click(await screen.findByRole("button", { name: "File README.md" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "← Files" })).toHaveFocus());

    const backButton = screen.getByRole("button", { name: "← Files" });

    fireEvent.blur(backButton, { relatedTarget: document.body });

    act(() => media.setCompact(false));

    expect(screen.queryByRole("button", { name: "← Files" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("File preview")).toHaveFocus();
  });

  it("does not move focus after mobile Back released it before resize", async () => {
    const media = createFilesMatchMediaController(true);

    vi.stubGlobal("matchMedia", media.matchMedia);

    render(
      <>
        <button type="button">Outside action</button>
        <FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />
      </>
    );

    fireEvent.click(await screen.findByRole("button", { name: "File README.md" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "← Files" }))
      .toHaveFocus());

    const outsideAction = screen.getByRole("button", { name: "Outside action" });

    outsideAction.focus();
    act(() => media.setCompact(false));

    expect(outsideAction).toHaveFocus();
  });

  it("keeps mobile file-preview failures recoverable without exposing transport details", async () => {
    let resolveRetry!: (value: Awaited<ReturnType<typeof workspacesApi.readFile>>) => void;

    readFile
      .mockRejectedValueOnce(new Error("ECONNREFUSED http://127.0.0.1:4100/internal/path"))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveRetry = resolve;
      }));

    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    const fileRow = await screen.findByRole("button", { name: "File README.md" });

    fireEvent.click(fileRow);

    expect(await screen.findByRole("alert", { name: "File preview unavailable" }))
      .toHaveTextContent("Check the daemon connection and try again");
    expect(screen.queryByText(/ECONNREFUSED/)).not.toBeInTheDocument();
    expect(screen.getByText("DeskCue · Preview unavailable")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "File actions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open file" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download file" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry file" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Retry file" }));

    expect(screen.getByRole("status", { name: "Retrying file preview" }))
      .toHaveTextContent("Retrying file preview…");
    expect(screen.getByRole("button", { name: "Retrying…" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Retrying…" }))
      .toHaveAttribute("aria-disabled", "true");
    expect(readFile).toHaveBeenCalledTimes(2);

    act(() => {
      resolveRetry({
        binary: false,
        content: "# Recovered",
        modifiedAt: "2026-08-07T09:00:00.000Z",
        path: "README.md",
        sizeBytes: 14,
        truncated: false,
        workspaceId: "workspace-1"
      });
    });

    expect(await screen.findByText("# Recovered")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("File preview")).toHaveFocus());
  });

  it("keeps file Retry mounted and focused when the retry also fails", async () => {
    readFile
      .mockRejectedValueOnce(new Error("first transport failure"))
      .mockRejectedValueOnce(new Error("second transport failure"));

    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    fireEvent.click(await screen.findByRole("button", { name: "File README.md" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry file" }));

    expect(await screen.findByRole("alert", { name: "File preview unavailable" }))
      .toHaveTextContent("Check the daemon connection and try again");
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry file" })).toHaveFocus());
    expect(screen.queryByText(/transport failure/)).not.toBeInTheDocument();
  });

  it("does not steal focus back after the user moves to a control outside Files", async () => {
    let resolveRetry!: (value: Awaited<ReturnType<typeof workspacesApi.readFile>>) => void;

    readFile
      .mockRejectedValueOnce(new Error("first transport failure"))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveRetry = resolve;
      }));

    render(
      <>
        <button type="button">Outside action</button>
        <FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />
      </>
    );

    fireEvent.click(await screen.findByRole("button", { name: "File README.md" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry file" }));

    const outsideAction = screen.getByRole("button", { name: "Outside action" });

    outsideAction.focus();

    act(() => {
      resolveRetry({
        binary: false,
        content: "# Recovered without focus theft",
        modifiedAt: "2026-08-07T09:00:00.000Z",
        path: "README.md",
        sizeBytes: 30,
        truncated: false,
        workspaceId: "workspace-1"
      });
    });

    expect(await screen.findByText("# Recovered without focus theft")).toBeInTheDocument();
    expect(outsideAction).toHaveFocus();
  });

  it("does not restore preview focus after the user taps the pending recovery surface", async () => {
    let resolveRetry!: (value: Awaited<ReturnType<typeof workspacesApi.readFile>>) => void;

    readFile
      .mockRejectedValueOnce(new Error("first transport failure"))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveRetry = resolve;
      }));

    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    fireEvent.click(await screen.findByRole("button", { name: "File README.md" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry file" }));
    fireEvent.pointerDown(screen.getByRole("status", { name: "Retrying file preview" }));

    act(() => {
      resolveRetry({
        binary: false,
        content: "# Recovered after blank tap",
        modifiedAt: "2026-08-07T09:00:00.000Z",
        path: "README.md",
        sizeBytes: 26,
        truncated: false,
        workspaceId: "workspace-1"
      });
    });

    expect(await screen.findByText("# Recovered after blank tap")).toBeInTheDocument();
    expect(screen.getByLabelText("File preview")).not.toHaveFocus();
  });

  it("does not let a file retry steal focus after the user chooses Back", async () => {
    let resolveRetry!: (value: Awaited<ReturnType<typeof workspacesApi.readFile>>) => void;

    readFile
      .mockRejectedValueOnce(new Error("first transport failure"))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveRetry = resolve;
      }));

    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    fireEvent.click(await screen.findByRole("button", { name: "File README.md" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry file" }));
    fireEvent.click(screen.getByRole("button", { name: "← Files" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "File README.md" }))
      .toHaveFocus());

    act(() => {
      resolveRetry({
        binary: false,
        content: "# Late recovery",
        modifiedAt: "2026-08-07T09:00:00.000Z",
        path: "README.md",
        sizeBytes: 14,
        truncated: false,
        workspaceId: "workspace-1"
      });
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "File README.md" }))
      .toHaveFocus());
    expect(screen.queryByText("# Late recovery")).not.toBeInTheDocument();
  });

  it("restores the file row when browser Back interrupts a retry", async () => {
    let resolveRetry!: (value: Awaited<ReturnType<typeof workspacesApi.readFile>>) => void;

    readFile
      .mockRejectedValueOnce(new Error("first transport failure"))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveRetry = resolve;
      }));

    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    fireEvent.click(await screen.findByRole("button", { name: "File README.md" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry file" }));
    fireEvent(window, new PopStateEvent("popstate", { state: {} }));

    await waitFor(() => expect(screen.getByRole("button", { name: "File README.md" }))
      .toHaveFocus());
    expect(readFile.mock.calls[1]?.[2]?.signal?.aborted).toBe(true);

    act(() => {
      resolveRetry({
        binary: false,
        content: "# Late browser recovery",
        modifiedAt: "2026-08-07T09:00:00.000Z",
        path: "README.md",
        sizeBytes: 14,
        truncated: false,
        workspaceId: "workspace-1"
      });
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "File README.md" }))
      .toHaveFocus());
    expect(screen.queryByText("# Late browser recovery")).not.toBeInTheDocument();
  });

  it("does not steal focus after the user leaves a pending initial file load", async () => {
    let resolveFile!: (value: Awaited<ReturnType<typeof workspacesApi.readFile>>) => void;

    readFile.mockReturnValueOnce(new Promise((resolve) => {
      resolveFile = resolve;
    }));

    render(
      <>
        <button type="button">Outside action</button>
        <FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />
      </>
    );

    fireEvent.click(await screen.findByRole("button", { name: "File README.md" }));

    const outsideAction = screen.getByRole("button", { name: "Outside action" });

    expect(screen.getByRole("button", { name: "← Files" })).toHaveFocus();
    outsideAction.focus();

    act(() => {
      resolveFile({
        binary: false,
        content: "# Initial recovery without focus theft",
        modifiedAt: "2026-08-07T09:00:00.000Z",
        path: "README.md",
        sizeBytes: 38,
        truncated: false,
        workspaceId: "workspace-1"
      });
    });

    expect(await screen.findByText("# Initial recovery without focus theft")).toBeInTheDocument();
    expect(outsideAction).toHaveFocus();
  });

  it("does not restore initial-load focus after the user taps the loading surface", async () => {
    let resolveFile!: (value: Awaited<ReturnType<typeof workspacesApi.readFile>>) => void;

    readFile.mockReturnValueOnce(new Promise((resolve) => {
      resolveFile = resolve;
    }));

    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    fireEvent.click(await screen.findByRole("button", { name: "File README.md" }));
    fireEvent.pointerDown(screen.getByLabelText("File preview"));

    act(() => {
      resolveFile({
        binary: false,
        content: "# Initial load after blank tap",
        modifiedAt: "2026-08-07T09:00:00.000Z",
        path: "README.md",
        sizeBytes: 29,
        truncated: false,
        workspaceId: "workspace-1"
      });
    });

    expect(await screen.findByText("# Initial load after blank tap")).toBeInTheDocument();
    expect(screen.getByLabelText("File preview")).not.toHaveFocus();
  });

  it("lets a mobile user leave a file preview while its request is still pending", async () => {
    readFile.mockImplementation(() => new Promise(() => undefined));

    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    fireEvent.click(await screen.findByRole("button", { name: "File README.md" }));

    const backButton = screen.getByRole("button", { name: "← Files" });

    expect(screen.getByText("Loading file…")).toBeInTheDocument();
    expect(screen.getByText("DeskCue · Loading preview…")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "File actions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open file" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download file" })).toBeInTheDocument();
    expect(backButton).toHaveFocus();
    expect(readFile.mock.calls[0]?.[2]?.signal?.aborted).toBe(false);

    fireEvent.click(backButton);

    await waitFor(() => expect(screen.getByRole("button", { name: "File README.md" }))
      .toHaveFocus());
    expect(readFile.mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
  });

  it("keeps the last usable list and offers retry when returning from a file fails", async () => {
    let resolveFolderRetry!: (value: Awaited<ReturnType<typeof workspacesApi.listFiles>>) => void;

    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    fireEvent.click(await screen.findByRole("button", { name: "File README.md" }));
    await screen.findByText("# DeskCue");
    listFiles.mockRejectedValueOnce(new Error("Could not reload folder"));

    fireEvent.click(screen.getByRole("button", { name: "← Files" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Folder unavailable");
    expect(screen.queryByText("Could not reload folder")).not.toBeInTheDocument();
    expect(screen.queryByText("This folder is empty.")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "File README.md" }))
      .toHaveFocus());

    const retryRequest = new Promise<Awaited<ReturnType<typeof workspacesApi.listFiles>>>((resolve) => {
      resolveFolderRetry = resolve;
    });

    listFiles.mockReturnValueOnce(retryRequest);

    fireEvent.click(screen.getByRole("button", { name: "Retry folder" }));

    expect(screen.getByRole("button", { name: "Retrying…" })).toHaveFocus();
    expect(screen.getByRole("status", { name: "Reloading folder" })).toHaveTextContent("Reloading folder…");

    await act(async () => {
      resolveFolderRetry({
        entries: [{
          kind: "file",
          modifiedAt: "2026-08-07T09:00:00.000Z",
          name: "README.md",
          path: "README.md",
          readable: true,
          sizeBytes: 14
        }],
        hasMore: false,
        nextCursor: null,
        path: "",
        workspaceId: "workspace-1"
      });
      await retryRequest;
    });

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "File README.md" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("searchbox", { name: "Filter files in this folder" }))
      .toHaveFocus());
  });

  it("explains when a saved chat points to a workspace that is no longer registered", async () => {
    listFiles.mockRejectedValueOnce(new Error("Workspace not found."));

    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent("Workspace unavailable");
    expect(alert).toHaveTextContent("saved workspace is no longer available");
    expect(alert).toHaveTextContent("add the workspace again");
    expect(alert).not.toHaveTextContent("Check the daemon connection");
    expect(screen.queryByRole("list", { name: "Workspace files" })).not.toBeInTheDocument();
  });

  it("keeps Retry mounted and focused when another folder reload fails", async () => {
    let rejectFolderRetry!: (reason?: unknown) => void;

    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    fireEvent.click(await screen.findByRole("button", { name: "File README.md" }));
    await screen.findByText("# DeskCue");
    listFiles.mockRejectedValueOnce(new Error("Could not reload folder"));

    fireEvent.click(screen.getByRole("button", { name: "← Files" }));
    await screen.findByRole("alert");
    const retryRequest = new Promise<Awaited<ReturnType<typeof workspacesApi.listFiles>>>((_resolve, reject) => {
      rejectFolderRetry = reject;
    });

    listFiles.mockReturnValueOnce(retryRequest);
    fireEvent.click(screen.getByRole("button", { name: "Retry folder" }));

    expect(screen.getByRole("button", { name: "Retrying…" })).toHaveFocus();
    expect(screen.getByRole("status", { name: "Reloading folder" })).toBeInTheDocument();

    await act(async () => {
      rejectFolderRetry(new Error("Still offline"));
      await retryRequest.catch(() => undefined);
    });

    expect(await screen.findByText("Folder unavailable")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Folder unavailable");
    expect(screen.queryByText("Still offline")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry folder" })).toHaveFocus());
  });

  it("finishes a pending folder retry without stealing focus after the user moves away", async () => {
    let resolveFolderRetry!: (value: Awaited<ReturnType<typeof workspacesApi.listFiles>>) => void;

    render(
      <>
        <button type="button">Outside action</button>
        <FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />
      </>
    );

    fireEvent.click(await screen.findByRole("button", { name: "File README.md" }));
    await screen.findByText("# DeskCue");
    listFiles.mockRejectedValueOnce(new Error("Could not reload folder"));
    fireEvent.click(screen.getByRole("button", { name: "← Files" }));
    await screen.findByRole("alert");

    const folderRetry = new Promise<Awaited<ReturnType<typeof workspacesApi.listFiles>>>((resolve) => {
      resolveFolderRetry = resolve;
    });

    listFiles.mockReturnValueOnce(folderRetry);
    fireEvent.click(screen.getByRole("button", { name: "Retry folder" }));

    expect(screen.getByRole("status", { name: "Reloading folder" })).toBeInTheDocument();

    const outsideAction = screen.getByRole("button", { name: "Outside action" });

    outsideAction.focus();

    await act(async () => {
      resolveFolderRetry({
        entries: [],
        hasMore: false,
        nextCursor: null,
        path: "",
        workspaceId: "workspace-1"
      });
      await folderRetry;
    });

    await waitFor(() => {
      expect(screen.queryByRole("status", { name: "Reloading folder" })).not.toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: "Retrying…" })).not.toBeInTheDocument();
    expect(outsideAction).toHaveFocus();
  });

  it("clears a pending folder retry when the workspace changes", async () => {
    let resolveWorkspaceOneRetry!: (value: Awaited<ReturnType<typeof workspacesApi.listFiles>>) => void;

    const view = render(
      <>
        <button type="button">Outside action</button>
        <FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />
      </>
    );

    fireEvent.click(await screen.findByRole("button", { name: "File README.md" }));
    await screen.findByText("# DeskCue");
    listFiles.mockRejectedValueOnce(new Error("Could not reload folder"));
    fireEvent.click(screen.getByRole("button", { name: "← Files" }));
    await screen.findByRole("alert");

    listFiles.mockReturnValueOnce(new Promise((resolve) => {
      resolveWorkspaceOneRetry = resolve;
    }));
    fireEvent.click(screen.getByRole("button", { name: "Retry folder" }));

    expect(screen.getByRole("status", { name: "Reloading folder" })).toBeInTheDocument();

    listFiles.mockImplementationOnce(() => new Promise(() => undefined));
    const outsideAction = screen.getByRole("button", { name: "Outside action" });

    outsideAction.focus();
    view.rerender(
      <>
        <button type="button">Outside action</button>
        <FilesTabPanel workspaceId="workspace-2" workspaceName="Other workspace" />
      </>
    );

    await waitFor(() => {
      expect(screen.queryByRole("status", { name: "Reloading folder" })).not.toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: "Retrying…" })).not.toBeInTheDocument();
    expect(listFiles).toHaveBeenCalledWith("workspace-2", expect.objectContaining({ path: "" }));

    act(() => {
      resolveWorkspaceOneRetry({
        entries: [],
        hasMore: false,
        nextCursor: null,
        path: "",
        workspaceId: "workspace-1"
      });
    });

    expect(outsideAction).toHaveFocus();
    expect(screen.queryByRole("status", { name: "Reloading folder" })).not.toBeInTheDocument();
  });

  it("does not steal later focus when returning from a preview reloads the folder", async () => {
    let resolveFolder!: (value: Awaited<ReturnType<typeof workspacesApi.listFiles>>) => void;

    render(
      <>
        <button type="button">Outside action</button>
        <FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />
      </>
    );

    fireEvent.click(await screen.findByRole("button", { name: "File README.md" }));
    await screen.findByText("# DeskCue");

    listFiles.mockReturnValueOnce(new Promise((resolve) => {
      resolveFolder = resolve;
    }));
    fireEvent.click(screen.getByRole("button", { name: "← Files" }));

    const outsideAction = screen.getByRole("button", { name: "Outside action" });

    outsideAction.focus();

    act(() => {
      resolveFolder({
        entries: [{
          kind: "file",
          modifiedAt: "2026-08-07T09:00:00.000Z",
          name: "README.md",
          path: "README.md",
          readable: true,
          sizeBytes: 14
        }],
        hasMore: false,
        nextCursor: null,
        path: "",
        workspaceId: "workspace-1"
      });
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "File README.md" }))
      .toBeInTheDocument());
    expect(outsideAction).toHaveFocus();
  });

  it("moves focus to the filter when a previewed row disappears during return", async () => {
    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    fireEvent.click(await screen.findByRole("button", { name: "File README.md" }));
    await screen.findByText("# DeskCue");
    expect(screen.getByRole("status", { name: "README.md preview loaded." })).toBeInTheDocument();
    expect(screen.getByLabelText("File preview")).not.toHaveAttribute("aria-live");
    listFiles.mockResolvedValueOnce({
      entries: [{
        kind: "directory",
        modifiedAt: "2026-08-07T09:00:00.000Z",
        name: "src",
        path: "src",
        readable: true,
        sizeBytes: null
      }],
      hasMore: false,
      nextCursor: null,
      path: "",
      workspaceId: "workspace-1"
    });

    fireEvent.click(screen.getByRole("button", { name: "← Files" }));

    await waitFor(() => expect(screen.getByRole("searchbox", { name: "Filter files in this folder" }))
      .toHaveFocus());
    expect(screen.queryByRole("button", { name: "File README.md" })).not.toBeInTheDocument();
  });

  it("does not let a slow folder retry steal focus after previewing a retained row", async () => {
    let resolveRetry: (value: Awaited<ReturnType<typeof workspacesApi.listFiles>>) => void = () => undefined;

    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    fireEvent.click(await screen.findByRole("button", { name: "File README.md" }));
    await screen.findByText("# DeskCue");
    listFiles.mockRejectedValueOnce(new Error("Could not reload folder"));

    fireEvent.click(screen.getByRole("button", { name: "← Files" }));
    await screen.findByRole("alert");

    listFiles.mockReturnValueOnce(new Promise((resolve) => {
      resolveRetry = resolve;
    }));

    fireEvent.click(screen.getByRole("button", { name: "Retry folder" }));
    expect(screen.getByRole("button", { name: "Retrying…" })).toHaveFocus();
    expect(screen.getByRole("status", { name: "Reloading folder" })).toHaveTextContent("Reloading folder…");
    fireEvent.click(screen.getByRole("button", { name: "File README.md" }));
    await screen.findByText("# DeskCue");

    await act(async () => {
      resolveRetry({
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

      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: "← Files" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "File README.md" }))
      .toHaveFocus());
  });

  it("opens and downloads workspace files through scoped asset tickets", async () => {
    openAsset.mockResolvedValue();
    downloadAsset.mockResolvedValue();
    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    const fileRow = await screen.findByRole("button", { name: "File README.md" });

    fireEvent.click(fileRow);
    await screen.findByText("# DeskCue");

    fireEvent.click(screen.getByRole("button", { name: "Open file" }));

    await waitFor(() => expect(openAsset).toHaveBeenCalledWith(
      "README.md",
      "README.md",
      { workspaceId: "workspace-1" },
      expect.any(AbortSignal)
    ));
    expect(readFile).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Download file" }));

    await waitFor(() => expect(downloadAsset).toHaveBeenCalledWith(
      "README.md",
      "README.md",
      { workspaceId: "workspace-1" },
      expect.any(AbortSignal)
    ));
    await waitFor(() => expect(screen.getByRole("button", { name: "Download file" })).toBeEnabled());
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it("aborts a pending file action when the user leaves the preview", async () => {
    let finishOpen = () => {};
    let requestSignal: AbortSignal | undefined;

    openAsset.mockImplementation((_path, _name, _context, signal) => new Promise<void>((resolve) => {
      requestSignal = signal;
      finishOpen = resolve;
    }));
    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    fireEvent.click(await screen.findByRole("button", { name: "File README.md" }));
    await screen.findByText("# DeskCue");
    fireEvent.click(screen.getByRole("button", { name: "Open file" }));
    fireEvent.click(screen.getByRole("button", { name: "← Files" }));

    expect(requestSignal?.aborted).toBe(true);
    await waitFor(() => expect(screen.getByRole("button", { name: "File README.md" })).toHaveFocus());

    await act(async () => {
      finishOpen();
      await Promise.resolve();
    });

    expect(screen.queryByRole("group", { name: "File actions" })).not.toBeInTheDocument();
  });

  it("closes a file preview when browser history changes the Files target", async () => {
    listFiles.mockImplementation((_workspaceId, options) => Promise.resolve({
      entries: options?.path === "src"
        ? [{
            kind: "file",
            modifiedAt: "2026-08-07T09:00:00.000Z",
            name: "nested.txt",
            path: "src/nested.txt",
            readable: true,
            sizeBytes: 12
          }]
        : [{
            kind: "file",
            modifiedAt: "2026-08-07T09:00:00.000Z",
            name: "README.md",
            path: "README.md",
            readable: true,
            sizeBytes: 14
          }],
      hasMore: false,
      nextCursor: null,
      path: options?.path ?? "",
      workspaceId: "workspace-1"
    }));

    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    fireEvent.click(await screen.findByRole("button", { name: "File README.md" }));
    expect(await screen.findByText("# DeskCue")).toBeInTheDocument();

    fireEvent(window, new PopStateEvent("popstate", { state: {
      deskCueWorkspaceFileBrowser: {
        kind: "directory",
        path: "src",
        workspaceId: "workspace-1"
      }
    } }));

    expect(screen.queryByRole("group", { name: "File actions" })).not.toBeInTheDocument();
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "File nested.txt" })).toBeInTheDocument();
  });

  it("expands a file preview and exits with Escape", async () => {
    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    fireEvent.click(await screen.findByRole("button", { name: "File README.md" }));
    await screen.findByText("# DeskCue");

    fireEvent.click(screen.getByRole("button", { name: "Open full-screen file view" }));
    const expandedViewer = screen.getByRole("dialog", { name: "File preview" });
    const exitButton = screen.getByRole("button", { name: "Exit full-screen file view" });
    const fileContents = screen.getByLabelText("File contents");
    const filesToolbar = screen.getByRole("searchbox", { name: "Filter files in this folder" })
      .closest("header");

    expect(expandedViewer).toHaveAttribute("aria-modal", "true");
    expect(filesToolbar).toHaveProperty("inert", true);
    expect(exitButton).toHaveAttribute("aria-pressed", "true");
    expect(exitButton).toHaveFocus();

    fileContents.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(screen.getByRole("button", { name: "← Files" })).toHaveFocus();

    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(fileContents).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Open full-screen file view" }))
      .toHaveAttribute("aria-pressed", "false");
    expect(filesToolbar).not.toHaveProperty("inert", true);
    expect(screen.getByRole("button", { name: "Open full-screen file view" })).toHaveFocus();
  });

  it("restores the mobile list and exits full screen when browser history leaves a file", async () => {
    const onSelectFile = vi.fn();

    render(
      <FilesTabPanel
        workspaceId="workspace-1"
        workspaceName="DeskCue"
        onSelectFile={onSelectFile}
      />
    );

    const fileRow = await screen.findByRole("button", { name: "File README.md" });
    const layout = fileRow.closest(`.${styles.filesLayout}`);

    fireEvent.click(fileRow);
    await screen.findByText("# DeskCue");
    fireEvent.click(screen.getByRole("button", { name: "Open full-screen file view" }));

    expect(layout).toHaveClass(styles.filesLayoutViewing);
    expect(screen.getByLabelText("File preview")).toHaveClass(styles.fileViewerExpanded);

    fireEvent(window, new PopStateEvent("popstate", { state: {} }));

    await waitFor(() => expect(layout).not.toHaveClass(styles.filesLayoutViewing));
    expect(screen.getByLabelText("File preview")).not.toHaveClass(styles.fileViewerExpanded);
    expect(screen.getByRole("button", { name: "File README.md" })).toBeInTheDocument();
    expect(onSelectFile).toHaveBeenLastCalledWith("");
  });

  it("restores the file view when browser history moves forward to a file", async () => {
    render(<FilesTabPanelHistoryHarness />);

    const fileRow = await screen.findByRole("button", { name: "File README.md" });
    const layout = fileRow.closest(`.${styles.filesLayout}`);

    fireEvent.click(fileRow);
    await screen.findByText("# DeskCue");
    const fileHistoryState = {
      deskCueWorkspaceFileBrowser: {
        kind: "file",
        path: "README.md",
        workspaceId: "workspace-1"
      }
    };

    fireEvent(window, new PopStateEvent("popstate", { state: {} }));
    await waitFor(() => expect(layout).not.toHaveClass(styles.filesLayoutViewing));

    fireEvent(window, new PopStateEvent("popstate", { state: fileHistoryState }));

    await waitFor(() => expect(layout).toHaveClass(styles.filesLayoutViewing));
    expect(await screen.findByText("# DeskCue")).toBeInTheDocument();
    expect(screen.getByLabelText("Selected workspace path")).toHaveTextContent("README.md");
    expect(readFile).toHaveBeenCalledTimes(2);
  });

  it("keeps source lines intact until the user enables wrapping", async () => {
    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    fireEvent.click(await screen.findByRole("button", { name: "File README.md" }));
    const sourceLine = await screen.findByText("# DeskCue");
    const content = sourceLine.closest("pre");
    const wrapButton = screen.getByRole("button", { name: "Enable line wrapping" });

    expect(content).toHaveAttribute("tabindex", "0");
    expect(content).toHaveStyle("--file-line-number-width: 3.5ch");
    expect(content).not.toHaveClass(styles.fileContentWrapped);
    expect(wrapButton).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(wrapButton);

    expect(content).toHaveClass(styles.fileContentWrapped);
    expect(screen.getByRole("button", { name: "Disable line wrapping" }))
      .toHaveAttribute("aria-pressed", "true");
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

    const { container } = render(
      <FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />
    );

    const rootUpButton = screen.getByRole("button", { name: "Already at workspace root" });

    expect(rootUpButton).toBeDisabled();

    fireEvent.click(await screen.findByRole("button", { name: "Folder src" }));
    const upButton = await screen.findByRole("button", { name: "Go to parent folder" });

    expect(upButton).toBeEnabled();
    expect(screen.getByText("src")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("src")).toHaveFocus();
    expect(screen.queryByRole("button", { name: "src" })).not.toBeInTheDocument();
    expect(scrollCurrentBreadcrumbIntoView).toHaveBeenLastCalledWith({
      block: "nearest",
      inline: "nearest"
    });

    fireEvent.click(upButton);

    await waitFor(() => expect(listFiles).toHaveBeenLastCalledWith(
      "workspace-1",
      expect.objectContaining({ path: "" })
    ));
    expect(screen.getByRole("button", { name: "Already at workspace root" })).toBeDisabled();
    expect(container.querySelector('[aria-current="page"]')).toHaveFocus();
  });

  it("reveals the current breadcrumb after resize without stealing focus", async () => {
    const { unmount } = render(
      <FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Folder src" }));
    await screen.findByRole("button", { name: "Go to parent folder" });

    const search = screen.getByRole("searchbox", { name: "Filter files in this folder" });
    const revealCount = scrollCurrentBreadcrumbIntoView.mock.calls.length;

    search.focus();
    act(() => resizeObserverCallbacks.at(-1)?.([], {} as ResizeObserver));

    expect(scrollCurrentBreadcrumbIntoView).toHaveBeenCalledTimes(revealCount + 1);
    expect(search).toHaveFocus();

    const disconnectCount = disconnectResizeObserver.mock.calls.length;

    expect(disconnectCount).toBeGreaterThan(0);
    unmount();
    expect(disconnectResizeObserver.mock.calls.length).toBeGreaterThan(disconnectCount);
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

    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(link).toHaveAttribute("title", "This entry cannot be opened from DeskCue.");

    link.focus();
    expect(link).toHaveFocus();
    fireEvent.click(link);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("renders a bounded raster preview through a workspace-scoped ticket", async () => {
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

    const image = await screen.findByRole("img", { name: "Preview of image.png" });

    expect(image).toHaveAttribute("src", "blob:workspace-image");
    expect(screen.getByText("Loading image preview…")).toBeInTheDocument();
    fireEvent.load(image);
    expect(screen.queryByText("Loading image preview…")).not.toBeInTheDocument();

    expect(getTicketBlob).toHaveBeenCalledWith("image.png", "image.png", expect.objectContaining({
      context: { workspaceId: "workspace-1" },
      kind: "local_image",
      maxBytes: MAX_WORKSPACE_IMAGE_PREVIEW_BYTES
    }));
    expect(getTicketBlob.mock.calls[0]?.[2]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts an in-flight image preview when the viewer unmounts", async () => {
    getTicketBlob.mockImplementation(() => new Promise(() => undefined));
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

    const view = render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    fireEvent.click(await screen.findByRole("button", { name: "File image.png" }));
    await waitFor(() => expect(getTicketBlob).toHaveBeenCalledTimes(1));
    const options = getTicketBlob.mock.calls[0]?.[2];

    expect(options?.signal?.aborted).toBe(false);
    view.unmount();
    expect(options?.signal?.aborted).toBe(true);
  });

  it("keeps non-image binary content out of the page", async () => {
    readFile.mockResolvedValue({
      binary: true,
      content: null,
      modifiedAt: "2026-08-07T09:00:00.000Z",
      path: "archive.zip",
      sizeBytes: 512,
      truncated: false,
      workspaceId: "workspace-1"
    });
    listFiles.mockResolvedValue({
      entries: [{
        kind: "file",
        modifiedAt: "2026-08-07T09:00:00.000Z",
        name: "archive.zip",
        path: "archive.zip",
        readable: true,
        sizeBytes: 512
      }],
      hasMore: false,
      nextCursor: null,
      path: "",
      workspaceId: "workspace-1"
    });

    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);
    fireEvent.click(await screen.findByRole("button", { name: "File archive.zip" }));

    expect(await screen.findByText("Binary file")).toBeInTheDocument();
    expect(getTicketBlob).not.toHaveBeenCalled();
    expect(screen.queryByRole("status", { name: "archive.zip preview loaded." })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enable line wrapping" })).not.toBeInTheDocument();
  });

  it("keeps image Retry focused until the recovered image is ready", async () => {
    getTicketBlob
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Blob(["image"], { type: "image/png" }));
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

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to preview image");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.getByRole("button", { name: "Retrying…" })).toHaveFocus();
    expect(screen.getByRole("status", { name: "Retrying image preview" })).toBeInTheDocument();
    const image = await screen.findByRole("img", { name: "Preview of image.png" });

    expect(screen.getByRole("button", { name: "Retrying…" })).toHaveFocus();
    fireEvent.load(image);
    await waitFor(() => expect(image).toHaveFocus());
    expect(getTicketBlob).toHaveBeenCalledTimes(2);
  });

  it("does not fetch an image above the preview byte limit", async () => {
    readFile.mockResolvedValue({
      binary: true,
      content: null,
      modifiedAt: "2026-08-07T09:00:00.000Z",
      path: "huge.png",
      sizeBytes: 26 * 1024 * 1024,
      truncated: false,
      workspaceId: "workspace-1"
    });
    listFiles.mockResolvedValue({
      entries: [{
        kind: "file",
        modifiedAt: "2026-08-07T09:00:00.000Z",
        name: "huge.png",
        path: "huge.png",
        readable: true,
        sizeBytes: 26 * 1024 * 1024
      }],
      hasMore: false,
      nextCursor: null,
      path: "",
      workspaceId: "workspace-1"
    });

    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);
    fireEvent.click(await screen.findByRole("button", { name: "File huge.png" }));

    expect(await screen.findByText("Image preview is limited to 25 MB")).toBeInTheDocument();
    expect(getTicketBlob).not.toHaveBeenCalled();
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

  it("retries a requested file after Strict Mode replays mount effects", async () => {
    render(
      <StrictMode>
        <FilesTabPanel
          requestedPath="README.md"
          workspaceId="workspace-1"
          workspaceName="DeskCue"
        />
      </StrictMode>
    );

    expect(await screen.findByText("# DeskCue")).toBeInTheDocument();
    expect(screen.getByLabelText("File preview")).toHaveTextContent("README.md");
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

  it("describes counts and empty filters as loaded results while more entries exist", async () => {
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
      hasMore: true,
      nextCursor: "next-page",
      path: "",
      workspaceId: "workspace-1"
    });

    render(<FilesTabPanel workspaceId="workspace-1" workspaceName="DeskCue" />);

    expect(await screen.findByRole("status", { name: "2 matching loaded entries" }))
      .toHaveTextContent("2");

    fireEvent.change(screen.getByRole("searchbox", { name: "Filter files in this folder" }), {
      target: { value: "missing" }
    });

    expect(screen.getByText("No loaded entries match the current filter.")).toBeInTheDocument();
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
