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
});
