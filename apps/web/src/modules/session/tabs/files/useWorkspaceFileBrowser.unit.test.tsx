import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  WorkspaceDirectoryResponse,
  WorkspaceFileResponse
} from "@deskcue/protocol";
import { workspacesApi } from "@api/endpoint/workspaces/endpoints";

import { useWorkspaceFileBrowser } from "./useWorkspaceFileBrowser";

vi.mock("@api/endpoint/workspaces/endpoints", () => ({
  workspacesApi: {
    listFiles: vi.fn(),
    readFile: vi.fn()
  }
}));

const listFiles = vi.mocked(workspacesApi.listFiles);
const readFile = vi.mocked(workspacesApi.readFile);

function directoryResponse(
  entries: WorkspaceDirectoryResponse["entries"],
  hasMore: boolean,
  nextCursor: string | null,
  workspaceId = "workspace-1"
): WorkspaceDirectoryResponse {
  return { entries, hasMore, nextCursor, path: "", workspaceId };
}

function fileEntry(path: string): WorkspaceDirectoryResponse["entries"][number] {
  return {
    kind: "file",
    modifiedAt: "2026-08-07T09:00:00.000Z",
    name: path,
    path,
    readable: true,
    sizeBytes: 5
  };
}

function fileResponse(path: string, content: string): WorkspaceFileResponse {
  return {
    binary: false,
    content,
    modifiedAt: "2026-08-07T09:00:00.000Z",
    path,
    sizeBytes: content.length,
    truncated: false,
    workspaceId: "workspace-1"
  };
}

describe("useWorkspaceFileBrowser", () => {
  beforeEach(() => {
    listFiles.mockReset();
    readFile.mockReset();
    window.history.replaceState({}, "", "/sessions/managed-1/files");
  });

  it("keeps directory pagination and file hydration independent", async () => {
    let resolveNextPage: (value: WorkspaceDirectoryResponse) => void = () => undefined;
    let resolveFile: (value: WorkspaceFileResponse) => void = () => undefined;

    listFiles
      .mockResolvedValueOnce(directoryResponse([fileEntry("alpha.txt")], true, "n_YWxwaGEudHh0"))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveNextPage = resolve;
      }));
    readFile.mockReturnValueOnce(new Promise((resolve) => {
      resolveFile = resolve;
    }));
    const { result } = renderHook(() => useWorkspaceFileBrowser("workspace-1"));

    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    act(() => {
      result.current.loadMore();
      void result.current.openFile("alpha.txt");
    });
    await act(async () => {
      resolveFile(fileResponse("alpha.txt", "alpha"));
      resolveNextPage(directoryResponse([
        fileEntry("alpha.txt"),
        fileEntry("beta.txt")
      ], false, null));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.path)).toEqual([
        "alpha.txt",
        "beta.txt"
      ]);
      expect(result.current.file?.content).toBe("alpha");
      expect(result.current.loadingDirectory).toBe(false);
      expect(result.current.loadingFile).toBe(false);
    });
  });

  it("ignores a late directory response after the workspace changes", async () => {
    let resolveOldWorkspace: (value: WorkspaceDirectoryResponse) => void = () => undefined;

    listFiles
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveOldWorkspace = resolve;
      }))
      .mockResolvedValueOnce(directoryResponse([fileEntry("new.txt")], false, null, "workspace-2"));
    const { result, rerender } = renderHook(
      ({ workspaceId }) => useWorkspaceFileBrowser(workspaceId),
      { initialProps: { workspaceId: "workspace-1" } }
    );

    rerender({ workspaceId: "workspace-2" });
    await waitFor(() => expect(result.current.entries[0]?.path).toBe("new.txt"));
    await act(async () => {
      resolveOldWorkspace(directoryResponse([fileEntry("old.txt")], false, null, "workspace-1"));
      await Promise.resolve();
    });

    expect(result.current.entries.map((entry) => entry.path)).toEqual(["new.txt"]);
    expect(result.current.loadingDirectory).toBe(false);
  });

  it("opens a requested directory without trying to hydrate it as a file", async () => {
    listFiles.mockResolvedValue(directoryResponse([{
      kind: "directory",
      modifiedAt: "2026-08-07T09:00:00.000Z",
      name: "src",
      path: "src",
      readable: true,
      sizeBytes: null
    }], false, null));
    const { result } = renderHook(() => useWorkspaceFileBrowser("workspace-1"));

    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    listFiles.mockResolvedValueOnce(directoryResponse([{
      kind: "directory",
      modifiedAt: "2026-08-07T09:00:00.000Z",
      name: "src",
      path: "src",
      readable: true,
      sizeBytes: null
    }], false, null)).mockResolvedValueOnce({
      ...directoryResponse([fileEntry("src/app.ts")], false, null),
      path: "src"
    });

    let kind: "directory" | "file" | null = null;

    await act(async () => {
      kind = await result.current.openPath("src/");
    });

    expect(kind).toBe("directory");
    expect(result.current.currentPath).toBe("src");
    expect(readFile).not.toHaveBeenCalled();
  });

  it("uses browser history inside nested folders and releases Back at workspace root", async () => {
    listFiles.mockImplementation((_workspaceId, options) => {
      const path = options?.path ?? "";

      return Promise.resolve({
      ...directoryResponse(path === "src" ? [fileEntry("src/app.ts")] : [{
        kind: "directory",
        modifiedAt: "2026-08-07T09:00:00.000Z",
        name: "src",
        path: "src",
        readable: true,
        sizeBytes: null
      }], false, null),
      path
    });
    });
    const { result } = renderHook(() => useWorkspaceFileBrowser("workspace-1"));

    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    act(() => result.current.openDirectory("src"));
    await waitFor(() => expect(result.current.currentPath).toBe("src"));
    const historyState = window.history.state as Record<string, unknown>;

    expect(historyState.deskCueWorkspaceFileBrowser).toMatchObject({
      kind: "directory",
      path: "src",
      workspaceId: "workspace-1"
    });

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
    });

    await waitFor(() => expect(result.current.currentPath).toBe(""));

    const rootRequestCount = listFiles.mock.calls.filter(([, options]) => (options?.path ?? "") === "").length;

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
    });

    await act(async () => Promise.resolve());
    expect(listFiles.mock.calls.filter(([, options]) => (options?.path ?? "") === "")).toHaveLength(rootRequestCount);
  });

  it("returns across the file history entry without leaving a same-URL ghost step", async () => {
    listFiles.mockResolvedValue(directoryResponse([fileEntry("alpha.txt")], false, null));
    readFile.mockResolvedValue(fileResponse("alpha.txt", "alpha"));
    const pushState = vi.spyOn(window.history, "pushState");
    const historyGo = vi.spyOn(window.history, "go").mockImplementation(() => undefined);
    const { result } = renderHook(() => useWorkspaceFileBrowser("workspace-1"));

    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect((window.history.state as Record<string, unknown>).deskCueWorkspaceFileBrowser).toMatchObject({
      kind: "directory",
      path: "",
      workspaceId: "workspace-1"
    });

    act(() => result.current.openFile("alpha.txt"));
    await waitFor(() => expect(result.current.file?.path).toBe("alpha.txt"));

    expect(pushState).toHaveBeenCalledTimes(1);
    expect((window.history.state as Record<string, unknown>).deskCueWorkspaceFileBrowser).toMatchObject({
      kind: "file",
      path: "alpha.txt",
      returnDepth: 1,
      workspaceId: "workspace-1"
    });

    act(() => result.current.returnToDirectory());

    expect(pushState).toHaveBeenCalledTimes(1);
    expect(historyGo).toHaveBeenCalledWith(-1);

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: {
        deskCueWorkspaceFileBrowser: {
          kind: "directory",
          path: "",
          workspaceId: "workspace-1"
        }
      } }));
    });

    await waitFor(() => expect(result.current.selectedPath).toBe(""));
    expect(result.current.file).toBeNull();

    historyGo.mockRestore();
  });

  it("returns across consecutive file selections to the owning directory", async () => {
    listFiles.mockResolvedValue(directoryResponse([
      fileEntry("alpha.txt"),
      fileEntry("beta.txt")
    ], false, null));
    readFile
      .mockResolvedValueOnce(fileResponse("alpha.txt", "alpha"))
      .mockResolvedValueOnce(fileResponse("beta.txt", "beta"));
    const historyGo = vi.spyOn(window.history, "go").mockImplementation(() => undefined);
    const { result } = renderHook(() => useWorkspaceFileBrowser("workspace-1"));

    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    act(() => result.current.openFile("alpha.txt"));
    await waitFor(() => expect(result.current.file?.path).toBe("alpha.txt"));
    act(() => result.current.openFile("beta.txt"));
    await waitFor(() => expect(result.current.file?.path).toBe("beta.txt"));

    expect((window.history.state as Record<string, unknown>).deskCueWorkspaceFileBrowser).toMatchObject({
      kind: "file",
      path: "beta.txt",
      returnDepth: 2,
      workspaceId: "workspace-1"
    });

    act(() => result.current.returnToDirectory());

    expect(historyGo).toHaveBeenCalledWith(-2);
    historyGo.mockRestore();
  });

  it("does not increase the return depth when the current file is selected again", async () => {
    listFiles.mockResolvedValue(directoryResponse([fileEntry("alpha.txt")], false, null));
    readFile.mockResolvedValue(fileResponse("alpha.txt", "alpha"));
    const pushState = vi.spyOn(window.history, "pushState");
    const historyGo = vi.spyOn(window.history, "go").mockImplementation(() => undefined);
    const { result } = renderHook(() => useWorkspaceFileBrowser("workspace-1"));

    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    act(() => result.current.openFile("alpha.txt"));
    await waitFor(() => expect(result.current.file?.path).toBe("alpha.txt"));
    act(() => result.current.openFile("alpha.txt"));
    await waitFor(() => expect(readFile).toHaveBeenCalledTimes(2));

    expect(pushState).toHaveBeenCalledTimes(1);
    expect((window.history.state as Record<string, unknown>).deskCueWorkspaceFileBrowser).toMatchObject({
      kind: "file",
      path: "alpha.txt",
      returnDepth: 1,
      workspaceId: "workspace-1"
    });

    act(() => result.current.returnToDirectory());

    expect(historyGo).toHaveBeenCalledWith(-1);
    historyGo.mockRestore();
  });

  it("keeps the safe directory fallback for a restored file without return depth", async () => {
    window.history.replaceState({
      deskCueWorkspaceFileBrowser: {
        kind: "file",
        path: "alpha.txt",
        workspaceId: "workspace-1"
      }
    }, "", window.location.href);
    listFiles.mockResolvedValue(directoryResponse([fileEntry("alpha.txt")], false, null));
    readFile.mockResolvedValue(fileResponse("alpha.txt", "alpha"));
    const pushState = vi.spyOn(window.history, "pushState");
    const replaceState = vi.spyOn(window.history, "replaceState");
    const historyGo = vi.spyOn(window.history, "go").mockImplementation(() => undefined);
    const { result } = renderHook(() => useWorkspaceFileBrowser("workspace-1"));

    await waitFor(() => expect(result.current.file?.path).toBe("alpha.txt"));

    act(() => result.current.openFile("alpha.txt"));
    await waitFor(() => expect(readFile).toHaveBeenCalledTimes(2));

    expect(pushState).not.toHaveBeenCalled();

    act(() => result.current.returnToDirectory());

    expect(historyGo).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenLastCalledWith(expect.objectContaining({
      deskCueWorkspaceFileBrowser: {
        kind: "directory",
        path: "",
        workspaceId: "workspace-1"
      }
    }), "", expect.any(String));
    await waitFor(() => expect(result.current.selectedPath).toBe(""));

    historyGo.mockRestore();
  });

  it("repairs a restored legacy file target before selecting a different file", async () => {
    window.history.replaceState({
      deskCueWorkspaceFileBrowser: {
        kind: "file",
        path: "alpha.txt",
        workspaceId: "workspace-1"
      }
    }, "", window.location.href);
    listFiles.mockResolvedValue(directoryResponse([
      fileEntry("alpha.txt"),
      fileEntry("beta.txt")
    ], false, null));
    readFile
      .mockResolvedValueOnce(fileResponse("alpha.txt", "alpha"))
      .mockResolvedValueOnce(fileResponse("beta.txt", "beta"));
    const pushState = vi.spyOn(window.history, "pushState");
    const replaceState = vi.spyOn(window.history, "replaceState");
    const historyGo = vi.spyOn(window.history, "go").mockImplementation(() => undefined);
    const { result } = renderHook(() => useWorkspaceFileBrowser("workspace-1"));

    await waitFor(() => expect(result.current.file?.path).toBe("alpha.txt"));

    act(() => result.current.openFile("beta.txt"));
    await waitFor(() => expect(result.current.file?.path).toBe("beta.txt"));

    expect(replaceState).toHaveBeenLastCalledWith(expect.objectContaining({
      deskCueWorkspaceFileBrowser: {
        kind: "directory",
        path: "",
        workspaceId: "workspace-1"
      }
    }), "", expect.any(String));
    expect(pushState).toHaveBeenCalledTimes(1);
    expect((window.history.state as Record<string, unknown>).deskCueWorkspaceFileBrowser).toMatchObject({
      kind: "file",
      path: "beta.txt",
      returnDepth: 1,
      workspaceId: "workspace-1"
    });

    act(() => result.current.returnToDirectory());

    expect(historyGo).toHaveBeenCalledWith(-1);
    historyGo.mockRestore();
  });

  it("does not restore a stale file after Forward is immediately followed by Back", async () => {
    let resolveForwardDirectory: (value: WorkspaceDirectoryResponse) => void = () => undefined;

    listFiles
      .mockResolvedValueOnce(directoryResponse([fileEntry("alpha.txt")], false, null))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveForwardDirectory = resolve;
      }))
      .mockResolvedValueOnce(directoryResponse([fileEntry("alpha.txt")], false, null));
    const { result } = renderHook(() => useWorkspaceFileBrowser("workspace-1"));

    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: {
        deskCueWorkspaceFileBrowser: {
          kind: "file",
          path: "alpha.txt",
          workspaceId: "workspace-1"
        }
      } }));
    });

    await waitFor(() => expect(listFiles).toHaveBeenCalledTimes(2));

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
    });

    await waitFor(() => expect(listFiles).toHaveBeenCalledTimes(3));

    await act(async () => {
      resolveForwardDirectory(directoryResponse([fileEntry("alpha.txt")], false, null));
      await Promise.resolve();
    });

    expect(result.current.selectedPath).toBe("");
    expect(result.current.file).toBeNull();
    expect(readFile).not.toHaveBeenCalled();
  });

  it("does not open a stale path after a newer openPath request", async () => {
    let resolveAlphaDirectory: (value: WorkspaceDirectoryResponse) => void = () => undefined;
    let resolveBetaDirectory: (value: WorkspaceDirectoryResponse) => void = () => undefined;

    listFiles
      .mockResolvedValueOnce(directoryResponse([
        fileEntry("alpha.txt"),
        fileEntry("beta.txt")
      ], false, null))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveAlphaDirectory = resolve;
      }))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveBetaDirectory = resolve;
      }));
    readFile.mockResolvedValueOnce(fileResponse("beta.txt", "beta"));
    const { result } = renderHook(() => useWorkspaceFileBrowser("workspace-1"));

    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    await act(async () => {
      const alphaRequest = result.current.openPath("alpha.txt");
      const betaRequest = result.current.openPath("beta.txt");

      resolveBetaDirectory(directoryResponse([fileEntry("beta.txt")], false, null));

      await betaRequest;
      resolveAlphaDirectory(directoryResponse([fileEntry("alpha.txt")], false, null));
      await alphaRequest;
    });

    expect(result.current.selectedPath).toBe("beta.txt");
    expect(result.current.file?.content).toBe("beta");
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(readFile.mock.calls[0]?.slice(0, 2)).toEqual(["workspace-1", "beta.txt"]);
    expect(readFile.mock.calls[0]?.[2]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("clears a visible file before restoring another file from history", async () => {
    let resolveBetaDirectory: (value: WorkspaceDirectoryResponse) => void = () => undefined;

    listFiles
      .mockResolvedValueOnce(directoryResponse([
        fileEntry("alpha.txt"),
        fileEntry("beta.txt")
      ], false, null))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveBetaDirectory = resolve;
      }));
    readFile
      .mockResolvedValueOnce(fileResponse("alpha.txt", "alpha"))
      .mockResolvedValueOnce(fileResponse("beta.txt", "beta"));
    const { result } = renderHook(() => useWorkspaceFileBrowser("workspace-1"));

    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    act(() => result.current.openFile("alpha.txt"));
    await waitFor(() => expect(result.current.file?.path).toBe("alpha.txt"));

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: {
        deskCueWorkspaceFileBrowser: {
          kind: "file",
          path: "beta.txt",
          workspaceId: "workspace-1"
        }
      } }));
    });

    expect(result.current.file).toBeNull();
    expect(result.current.selectedPath).toBe("");

    await act(async () => {
      resolveBetaDirectory(directoryResponse([fileEntry("beta.txt")], false, null));
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.file?.path).toBe("beta.txt"));
  });

  it("clears and aborts the previous file before resolving another requested path", async () => {
    let resolveAlphaFile: (value: WorkspaceFileResponse) => void = () => undefined;
    let resolveBetaDirectory: (value: WorkspaceDirectoryResponse) => void = () => undefined;

    listFiles
      .mockResolvedValueOnce(directoryResponse([
        fileEntry("alpha.txt"),
        fileEntry("beta.txt")
      ], false, null))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveBetaDirectory = resolve;
      }));
    readFile
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveAlphaFile = resolve;
      }))
      .mockResolvedValueOnce(fileResponse("beta.txt", "beta"));
    const { result } = renderHook(() => useWorkspaceFileBrowser("workspace-1"));

    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    act(() => result.current.openFile("alpha.txt"));
    await waitFor(() => expect(result.current.selectedPath).toBe("alpha.txt"));
    const alphaSignal = readFile.mock.calls[0]?.[2]?.signal;
    let betaRequest: Promise<"directory" | "file" | null> = Promise.resolve(null);

    act(() => {
      betaRequest = result.current.openPath("beta.txt");
    });

    expect(alphaSignal?.aborted).toBe(true);
    expect(result.current.file).toBeNull();
    expect(result.current.selectedPath).toBe("");

    await act(async () => {
      resolveAlphaFile(fileResponse("alpha.txt", "alpha"));
      resolveBetaDirectory(directoryResponse([fileEntry("beta.txt")], false, null));
      await betaRequest;
    });

    expect(result.current.file?.path).toBe("beta.txt");
    expect(result.current.selectedPath).toBe("beta.txt");
  });

  it("does not hide a requested file parent failure behind direct file hydration", async () => {
    listFiles
      .mockResolvedValueOnce(directoryResponse([fileEntry("alpha.txt")], true, "page-2"))
      .mockRejectedValueOnce(new Error("Parent folder unavailable"));
    readFile.mockResolvedValueOnce(fileResponse("alpha.txt", "alpha"));
    const { result } = renderHook(() => useWorkspaceFileBrowser("workspace-1"));

    await waitFor(() => expect(result.current.hasMore).toBe(true));

    let openResult: "directory" | "file" | null = "file";

    await act(async () => {
      openResult = await result.current.openPath("nested/alpha.txt");
    });

    expect(openResult).toBeNull();
    expect(result.current.error).toBe("Parent folder unavailable");
    expect(result.current.entries).toEqual([]);
    expect(result.current.file).toBeNull();
    expect(result.current.hasMore).toBe(false);
    expect(result.current.limited).toBe(false);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("keeps a history file parent failure visible and resets old pagination truth", async () => {
    listFiles
      .mockResolvedValueOnce(directoryResponse([fileEntry("alpha.txt")], true, "page-2"))
      .mockRejectedValueOnce(new Error("History parent unavailable"));
    const { result } = renderHook(() => useWorkspaceFileBrowser("workspace-1"));

    await waitFor(() => expect(result.current.hasMore).toBe(true));

    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: {
        deskCueWorkspaceFileBrowser: {
          kind: "file",
          path: "nested/alpha.txt",
          workspaceId: "workspace-1"
        }
      } }));
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.error).toBe("History parent unavailable"));
    expect(result.current.entries).toEqual([]);
    expect(result.current.file).toBeNull();
    expect(result.current.hasMore).toBe(false);
    expect(result.current.limited).toBe(false);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("uses a visible fallback when a directory failure has an empty message", async () => {
    listFiles.mockRejectedValueOnce(new Error(""));
    const { result } = renderHook(() => useWorkspaceFileBrowser("workspace-1"));

    await waitFor(() => expect(result.current.error).toBe("Failed to load workspace files"));

    expect(result.current.entries).toEqual([]);
    expect(result.current.loadingDirectory).toBe(false);
  });

  it("uses a visible fallback when a file failure has only whitespace", async () => {
    listFiles.mockResolvedValueOnce(directoryResponse([fileEntry("alpha.txt")], false, null));
    readFile.mockRejectedValueOnce(new Error("   "));
    const { result } = renderHook(() => useWorkspaceFileBrowser("workspace-1"));

    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    act(() => result.current.openFile("alpha.txt"));

    await waitFor(() => expect(result.current.error).toBe("Failed to load workspace file"));

    expect(result.current.file).toBeNull();
    expect(result.current.loadingFile).toBe(false);
  });
});
