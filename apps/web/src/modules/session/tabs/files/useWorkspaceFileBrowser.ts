import { useCallback, useEffect, useRef, useState } from "react";

import type { WorkspaceFileEntry, WorkspaceFileResponse } from "@deskcue/protocol";
import { workspacesApi } from "@api/endpoint/workspaces/endpoints";

import {
  MAX_WORKSPACE_BROWSER_ENTRIES,
  WORKSPACE_FILE_HISTORY_KEY
} from "./constants";
import { readWorkspaceFileHistoryTarget } from "./helpers";
import type {
  WorkspaceFileBrowserState,
  WorkspaceFileHistoryTarget
} from "./types";

export function useWorkspaceFileBrowser(workspaceId: string | null): WorkspaceFileBrowserState {
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<WorkspaceFileEntry[]>([]);
  const [error, setError] = useState("");
  const [file, setFile] = useState<WorkspaceFileResponse | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingDirectory, setLoadingDirectory] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [limited, setLimited] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState("");
  const directoryAbortRef = useRef<AbortController | null>(null);
  const directoryOperationRef = useRef(0);
  const fileAbortRef = useRef<AbortController | null>(null);
  const fileOperationRef = useRef(0);
  const entriesRef = useRef<WorkspaceFileEntry[]>([]);
  const historyTargetRef = useRef<WorkspaceFileHistoryTarget | null>(null);
  const targetOperationRef = useRef(0);

  const loadDirectory = useCallback(async (path: string, cursor: string | null = null) => {
    if (!workspaceId) return;

    directoryAbortRef.current?.abort();
    const controller = new AbortController();

    directoryAbortRef.current = controller;
    const operation = ++directoryOperationRef.current;

    setLoadingDirectory(true);

    setError("");

    try {
      const result = await workspacesApi.listFiles(workspaceId, {
        cursor,
        limit: 80,
        path,
        signal: controller.signal
      });

      if (directoryOperationRef.current !== operation) return undefined;

      const combined = cursor
        ? [...entriesRef.current, ...result.entries]
        : result.entries;
      const unique = [...new Map(combined.map((entry) => [entry.path, entry])).values()];
      const reachedLimit = unique.length > MAX_WORKSPACE_BROWSER_ENTRIES ||
        (result.hasMore && unique.length >= MAX_WORKSPACE_BROWSER_ENTRIES);
      const boundedEntries = unique.slice(0, MAX_WORKSPACE_BROWSER_ENTRIES);

      entriesRef.current = boundedEntries;

      setEntries(boundedEntries);
      setCurrentPath(result.path);
      setHasMore(result.hasMore && !reachedLimit);
      setLimited(reachedLimit);
      setNextCursor(reachedLimit ? null : result.nextCursor);
      return boundedEntries;
    } catch (loadError) {
      if (controller.signal.aborted || directoryOperationRef.current !== operation) return;

      setError(loadError instanceof Error ? loadError.message : "Failed to load workspace files");
      return undefined;
    } finally {
      if (directoryOperationRef.current === operation) {
        directoryAbortRef.current = null;
        setLoadingDirectory(false);
      }
    }
  }, [workspaceId]);

  const loadFile = useCallback(async (path: string) => {
    if (!workspaceId) return;

    fileAbortRef.current?.abort();
    const controller = new AbortController();

    fileAbortRef.current = controller;
    const operation = ++fileOperationRef.current;

    setSelectedPath(path);

    setLoadingFile(true);
    setError("");

    try {
      const result = await workspacesApi.readFile(workspaceId, path, {
        signal: controller.signal
      });

      if (fileOperationRef.current === operation) setFile(result);
    } catch (loadError) {
      if (controller.signal.aborted || fileOperationRef.current !== operation) return;

      setFile(null);
      setError(loadError instanceof Error ? loadError.message : "Failed to load workspace file");
    } finally {
      if (fileOperationRef.current === operation) {
        fileAbortRef.current = null;
        setLoadingFile(false);
      }
    }
  }, [workspaceId]);

  const pushHistoryTarget = useCallback((target: WorkspaceFileHistoryTarget) => {
    if (
      historyTargetRef.current?.workspaceId === target.workspaceId &&
      historyTargetRef.current.kind === target.kind &&
      historyTargetRef.current.path === target.path
    ) return;

    window.history.pushState({
      ...window.history.state,
      [WORKSPACE_FILE_HISTORY_KEY]: target
    }, "", window.location.href);
    historyTargetRef.current = target;
  }, []);

  const showDirectory = useCallback((path: string, recordHistory: boolean) => {
    if (!workspaceId) return;

    const target = { kind: "directory", path, workspaceId } satisfies WorkspaceFileHistoryTarget;

    if (recordHistory) pushHistoryTarget(target);

    historyTargetRef.current = target;
    fileAbortRef.current?.abort();
    fileOperationRef.current += 1;
    setFile(null);
    entriesRef.current = [];
    setEntries([]);
    setCurrentPath(path);
    setHasMore(false);
    setLimited(false);
    setNextCursor(null);
    setLoadingFile(false);
    setSelectedPath("");
    void loadDirectory(path);
  }, [loadDirectory, pushHistoryTarget, workspaceId]);

  const showFile = useCallback(async (path: string, recordHistory: boolean) => {
    if (!workspaceId) return;

    const target = { kind: "file", path, workspaceId } satisfies WorkspaceFileHistoryTarget;

    if (recordHistory) pushHistoryTarget(target);

    historyTargetRef.current = target;
    await loadFile(path);
  }, [loadFile, pushHistoryTarget, workspaceId]);

  const restoreTarget = useCallback(async (target: WorkspaceFileHistoryTarget) => {
    const targetOperation = ++targetOperationRef.current;

    historyTargetRef.current = target;

    if (target.kind === "directory") {
      showDirectory(target.path, false);
      return;
    }

    const parentPath = target.path.split("/").slice(0, -1).join("/");

    entriesRef.current = [];

    setEntries([]);
    setCurrentPath(parentPath);
    await loadDirectory(parentPath);
    if (targetOperationRef.current !== targetOperation) return;

    await showFile(target.path, false);
  }, [loadDirectory, showDirectory, showFile]);

  useEffect(() => {
    directoryAbortRef.current?.abort();
    fileAbortRef.current?.abort();
    directoryOperationRef.current += 1;
    fileOperationRef.current += 1;
    targetOperationRef.current += 1;
    setCurrentPath("");
    entriesRef.current = [];
    setEntries([]);
    setError("");
    setFile(null);
    setHasMore(false);
    setNextCursor(null);
    setSelectedPath("");
    setLoadingDirectory(false);
    setLoadingFile(false);
    setLimited(false);

    const stateTarget = readWorkspaceFileHistoryTarget(window.history.state);
    const initialTarget = stateTarget?.workspaceId === workspaceId
      ? stateTarget
      : workspaceId
        ? { kind: "directory", path: "", workspaceId } satisfies WorkspaceFileHistoryTarget
        : null;
    historyTargetRef.current = initialTarget;

    if (initialTarget) void restoreTarget(initialTarget);

    return () => {
      directoryOperationRef.current += 1;
      fileOperationRef.current += 1;
      targetOperationRef.current += 1;
      directoryAbortRef.current?.abort();
      fileAbortRef.current?.abort();
    };
  }, [restoreTarget, workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;

    // runtime-helper-placement: allow -- closes over the active workspace and restore callback.

    const handlePopState = (event: PopStateEvent) => {
      const stateTarget = readWorkspaceFileHistoryTarget(event.state);

      if (stateTarget?.workspaceId === workspaceId) {
        void restoreTarget(stateTarget);
        return;
      }

      if (historyTargetRef.current?.path || historyTargetRef.current?.kind === "file") {
        void restoreTarget({ kind: "directory", path: "", workspaceId });
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [restoreTarget, workspaceId]);

  const openDirectory = useCallback((path: string) => {
    targetOperationRef.current += 1;
    showDirectory(path, true);
  }, [showDirectory]);

  const openFile = useCallback((path: string) => {
    targetOperationRef.current += 1;
    void showFile(path, true);
  }, [showFile]);

  const loadMore = useCallback(() => {
    if (!loadingDirectory && nextCursor) void loadDirectory(currentPath, nextCursor);
  }, [currentPath, loadDirectory, loadingDirectory, nextCursor]);

  const openPath = useCallback(async (path: string) => {
    if (!workspaceId) return null;

    const targetOperation = ++targetOperationRef.current;
    const normalizedPath = path
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .replace(/\/+$/, "");
    const directoryPath = normalizedPath.split("/").slice(0, -1).join("/");

    entriesRef.current = [];

    setEntries([]);
    setCurrentPath(directoryPath);
    setHasMore(false);
    setLimited(false);
    setNextCursor(null);
    const directoryEntries = await loadDirectory(directoryPath);

    if (targetOperationRef.current !== targetOperation) return null;

    const targetEntry = directoryEntries?.find((entry) => entry.path === normalizedPath);

    if (targetEntry?.kind === "directory") {
      showDirectory(normalizedPath, true);
      return "directory";
    }

    await showFile(normalizedPath, true);
    if (targetOperationRef.current !== targetOperation) return null;

    return "file";
  }, [loadDirectory, showDirectory, showFile, workspaceId]);

  return {
    currentPath,
    entries,
    error,
    file,
    hasMore,
    loadingDirectory,
    loadingFile,
    limited,
    selectedPath,
    loadMore,
    openDirectory,
    openFile,
    openPath
  };
}
