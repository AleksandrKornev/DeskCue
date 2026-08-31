import clsx from "clsx";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { WorkspaceFileEntry } from "@deskcue/protocol";
import ArrowUpIcon from "@assets/images/icon-arrow-up.svg?react";
import CollapseIcon from "@assets/images/icon-collapse.svg?react";
import ExpandIcon from "@assets/images/icon-expand.svg?react";
import WrapLinesIcon from "@assets/images/icon-wrap-lines.svg?react";

import { MAX_WORKSPACE_BROWSER_ENTRIES } from "./constants";
import {
  buildWorkspaceBreadcrumbs,
  buildWorkspaceFileLineNumberWidth,
  createFileViewerKeyDownHandler,
  formatFileSize,
  inertOutsideFileViewer,
  isWorkspaceRasterImagePath,
  normalizeWorkspacePath,
  readWorkspaceFileHistoryTarget
} from "./helpers";
import styles from "./styles.module.scss";
import type { FilesTabPanelProps } from "./types";
import { useWorkspaceFileBrowser } from "./useWorkspaceFileBrowser";
import { WorkspaceFileActionDialog } from "./WorkspaceFileActionDialog";
import { WorkspaceImagePreview } from "./WorkspaceImagePreview";

type WorkspaceFileActionTarget = {
  file: WorkspaceFileEntry;
  workspaceId: string;
};

const FILES_COMPACT_MEDIA_QUERY = "(max-width: 720px)";
const WORKSPACE_NOT_FOUND_ERROR = "workspace not found";

type FolderErrorCopy = {
  detail: string;
  title: string;
};

function eventTargetIsInside(target: EventTarget | null, element: HTMLElement | null) {
  return target instanceof Node && Boolean(element?.contains(target));
}

function getFolderErrorCopy(error: string): FolderErrorCopy {
  if (error.trim().replace(/\.$/, "").toLocaleLowerCase() === WORKSPACE_NOT_FOUND_ERROR) {
    return {
      detail: "This chat's saved workspace is no longer available in DeskCue. Return to Chats and add the workspace again.",
      title: "Workspace unavailable"
    };
  }

  return {
    detail: "Check the daemon connection and try loading this folder again.",
    title: "Folder unavailable"
  };
}

function useCompactFilesViewport() {
  const [compact, setCompact] = useState(() =>
    typeof window === "undefined" || typeof window.matchMedia !== "function"
      ? true
      : window.matchMedia(FILES_COMPACT_MEDIA_QUERY).matches
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;

    const mediaQuery = window.matchMedia(FILES_COMPACT_MEDIA_QUERY);
    const controller = new AbortController();

    setCompact(mediaQuery.matches);
    mediaQuery.addEventListener("change", () => setCompact(mediaQuery.matches), { signal: controller.signal });

    return () => controller.abort();
  }, []);

  return compact;
}

export function FilesTabPanel({
  changedFiles = [],
  requestedPath = "",
  workspaceId,
  workspaceName,
  onOpenChanges,
  onSelectFile
}: FilesTabPanelProps) {
  const compactViewport = useCompactFilesViewport();
  const browser = useWorkspaceFileBrowser(workspaceId);
  const [changedOnly, setChangedOnly] = useState(false);
  const [fileActionTarget, setFileActionTarget] = useState<WorkspaceFileActionTarget | null>(null);
  const [fileRetrying, setFileRetrying] = useState(false);
  const [fileViewerExpanded, setFileViewerExpanded] = useState(false);
  const [folderRetrying, setFolderRetrying] = useState(false);
  const [query, setQuery] = useState("");
  const [viewingFile, setViewingFile] = useState(false);
  const [wrapLines, setWrapLines] = useState(false);
  const fileBackButtonRef = useRef<HTMLButtonElement>(null);
  const fileExpandButtonRef = useRef<HTMLButtonElement>(null);
  const fileLoadOwnsFocusRef = useRef(false);
  const fileRetryButtonRef = useRef<HTMLButtonElement>(null);
  const fileRetryFocusTargetRef = useRef<"preview" | "retry" | null>(null);
  const fileRetryOwnsFocusRef = useRef(false);
  const fileViewerRef = useRef<HTMLElement>(null);
  const folderRetryButtonRef = useRef<HTMLButtonElement>(null);
  const folderRetryFocusRef = useRef(false);
  const folderRetryLoadStartPendingRef = useRef(false);
  const requestedPathRef = useRef("");
  const returnFocusButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusOwnsFocusRef = useRef(false);
  const returnFocusPathRef = useRef("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const selectedPathRef = useRef("");
  const openRequestedPath = browser.openPath;
  const changedPaths = useMemo(() => new Set(changedFiles.map(normalizeWorkspacePath)), [changedFiles]);
  const breadcrumbs = buildWorkspaceBreadcrumbs(browser.currentPath);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleEntries = browser.entries.filter((entry) => {
    const normalizedPath = normalizeWorkspacePath(entry.path);
    const isChanged = changedPaths.has(normalizedPath) || (
      entry.kind === "directory" && [...changedPaths].some((path) => path.startsWith(`${normalizedPath}/`))
    );

    return (!changedOnly || isChanged) && (!normalizedQuery || entry.name.toLocaleLowerCase().includes(normalizedQuery));
  });
  const selectedFileChanged = browser.file ? changedPaths.has(normalizeWorkspacePath(browser.file.path)) : false;
  const partialDirectoryResults = browser.hasMore || browser.limited;
  const folderErrorCopy = getFolderErrorCopy(browser.error);
  const matchingEntriesLabel = partialDirectoryResults
    ? `${visibleEntries.length} matching loaded entries`
    : `${visibleEntries.length} matching entries in this folder`;

  const textFileLines = useMemo(
    () => browser.file && !browser.file.binary ? (browser.file.content ?? "").split("\n") : [],
    [browser.file]
  );

  const fileContentStyle = {
    "--file-line-number-width": buildWorkspaceFileLineNumberWidth(textFileLines.length)
  } as CSSProperties;

  useEffect(() => {
    if (!requestedPath) {
      requestedPathRef.current = "";
      return;
    }

    if (requestedPathRef.current === requestedPath) return;

    let active = true;

    requestedPathRef.current = requestedPath;
    fileLoadOwnsFocusRef.current = true;

    void openRequestedPath(requestedPath).then((kind) => {
      if (!active) return;

      setViewingFile(kind === "file");
      if (kind === "directory") {
        fileLoadOwnsFocusRef.current = false;
        onSelectFile?.("");
      }
    });

    return () => {
      active = false;
      if (requestedPathRef.current === requestedPath) requestedPathRef.current = "";
    };
  }, [onSelectFile, openRequestedPath, requestedPath]);

  useEffect(() => {
    if (!fileViewerExpanded) return;

    const viewer = fileViewerRef.current;

    if (!viewer) return;

    const returnFocusControl = fileExpandButtonRef.current;
    const handleKeyDown = createFileViewerKeyDownHandler(viewer, setFileViewerExpanded);
    const restoreOutsideInteraction = inertOutsideFileViewer(viewer);

    returnFocusControl?.focus();
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      restoreOutsideInteraction();
      if (viewer.contains(document.activeElement)) returnFocusControl?.focus();
    };
  }, [fileViewerExpanded]);

  useEffect(() => {
    if (browser.selectedPath || browser.loadingFile || browser.file) {
      setViewingFile(true);
      return;
    }

    setFileViewerExpanded(false);
    setViewingFile(false);
  }, [browser.file, browser.loadingFile, browser.selectedPath]);

  useEffect(() => {
    if (!viewingFile) return;
    if (fileRetrying) return;

    const activeElement = document.activeElement;
    const loadStillOwnsFocus = fileLoadOwnsFocusRef.current && (
      !activeElement ||
      activeElement === document.body ||
      activeElement === fileBackButtonRef.current ||
      activeElement === fileViewerRef.current
    );

    if (browser.loadingFile) {
      if (compactViewport && loadStillOwnsFocus) fileBackButtonRef.current?.focus();
      return;
    }

    fileLoadOwnsFocusRef.current = false;

    if (!loadStillOwnsFocus) return;

    if (compactViewport && browser.error && browser.selectedPath) fileRetryButtonRef.current?.focus();
    else if (compactViewport) fileBackButtonRef.current?.focus();
    else fileViewerRef.current?.focus();
  }, [browser.error, browser.file, browser.loadingFile, browser.selectedPath, compactViewport, fileRetrying, viewingFile]);

  useEffect(() => {
    if (!fileRetrying || browser.loadingFile) return;

    const activeElement = document.activeElement;
    const retryStillOwnsFocus = fileRetryOwnsFocusRef.current && (
      !activeElement ||
      activeElement === document.body ||
      activeElement === fileRetryButtonRef.current
    );

    fileRetryFocusTargetRef.current = retryStillOwnsFocus
      ? browser.error
        ? "retry"
        : "preview"
      : null;
    fileRetryOwnsFocusRef.current = false;
    setFileRetrying(false);
  }, [browser.error, browser.loadingFile, fileRetrying]);

  useEffect(() => {
    if (fileRetrying || !fileRetryFocusTargetRef.current) return;

    const target = fileRetryFocusTargetRef.current;

    fileRetryFocusTargetRef.current = null;

    if (target === "retry") fileRetryButtonRef.current?.focus({ preventScroll: true });
    else fileViewerRef.current?.focus({ preventScroll: true });
  }, [fileRetrying]);

  useEffect(() => {
    if (viewingFile || browser.loadingDirectory || !returnFocusPathRef.current) return;

    const returnFocusButton = returnFocusButtonRef.current;
    const activeElement = document.activeElement;
    const returnStillOwnsFocus = returnFocusOwnsFocusRef.current && (
      !activeElement ||
      activeElement === document.body ||
      activeElement === returnFocusButton
    );

    returnFocusPathRef.current = "";
    returnFocusButtonRef.current = null;
    returnFocusOwnsFocusRef.current = false;

    if (!returnStillOwnsFocus) return;

    if (returnFocusButton) returnFocusButton.focus();
    else searchInputRef.current?.focus();
  }, [browser.entries, browser.loadingDirectory, viewingFile]);

  useEffect(() => {
    if (!folderRetrying) return;

    if (viewingFile) {
      folderRetryFocusRef.current = false;
      folderRetryLoadStartPendingRef.current = false;
      setFolderRetrying(false);
      return;
    }

    if (browser.loadingDirectory) {
      folderRetryLoadStartPendingRef.current = false;
      return;
    }

    if (folderRetryLoadStartPendingRef.current) return;

    const activeElement = document.activeElement;
    const retryStillOwnsFocus = folderRetryFocusRef.current && !(
      activeElement &&
      activeElement !== document.body &&
      activeElement !== folderRetryButtonRef.current
    );

    folderRetryFocusRef.current = false;
    setFolderRetrying(false);

    if (!retryStillOwnsFocus) return;

    if (browser.error) folderRetryButtonRef.current?.focus();
    else searchInputRef.current?.focus();
  }, [browser.error, browser.loadingDirectory, folderRetrying, viewingFile]);

  useEffect(() => {
    if (selectedPathRef.current === browser.selectedPath) return;

    selectedPathRef.current = browser.selectedPath;
    requestedPathRef.current = browser.selectedPath;
    onSelectFile?.(browser.selectedPath);
  }, [browser.selectedPath, onSelectFile]);

  useEffect(() => {
    setFileActionTarget(null);
    fileLoadOwnsFocusRef.current = false;
    setFileRetrying(false);
    fileRetryFocusTargetRef.current = null;
    fileRetryOwnsFocusRef.current = false;
    setFolderRetrying(false);
    folderRetryFocusRef.current = false;
    folderRetryLoadStartPendingRef.current = false;
    returnFocusOwnsFocusRef.current = false;
    returnFocusPathRef.current = "";
  }, [workspaceId]);

  useEffect(() => {
    const controller = new AbortController();

    document.addEventListener("pointerdown", (event) => {
      if (!eventTargetIsInside(event.target, fileRetryButtonRef.current)) {
        fileRetryOwnsFocusRef.current = false;
      }

      if (!eventTargetIsInside(event.target, fileBackButtonRef.current)) {
        fileLoadOwnsFocusRef.current = false;
      }

      if (!eventTargetIsInside(event.target, folderRetryButtonRef.current)) {
        folderRetryFocusRef.current = false;
      }

      if (!eventTargetIsInside(event.target, returnFocusButtonRef.current)) {
        returnFocusOwnsFocusRef.current = false;
      }
    }, {
      capture: true,
      signal: controller.signal
    });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    window.addEventListener("popstate", (event) => {
      const target = readWorkspaceFileHistoryTarget(event.state);

      setFileActionTarget(null);
      setFileRetrying(false);
      fileRetryFocusTargetRef.current = null;
      fileRetryOwnsFocusRef.current = false;
      folderRetryFocusRef.current = false;
      setFolderRetrying(false);

      if (target?.workspaceId === workspaceId && target.kind === "file") {
        fileLoadOwnsFocusRef.current = true;
        returnFocusOwnsFocusRef.current = false;
        returnFocusPathRef.current = "";
        return;
      }

      fileLoadOwnsFocusRef.current = false;
      returnFocusOwnsFocusRef.current = Boolean(browser.selectedPath);
      if (browser.selectedPath) returnFocusPathRef.current = browser.selectedPath;
    }, {
      signal: controller.signal
    });

    return () => controller.abort();
  }, [browser.selectedPath, workspaceId]);

  if (!workspaceId) {
    return (
      <div className={styles.filesEmptyState}>
        <strong>No workspace linked</strong>
        <p>Attach a workspace to browse files from this session.</p>
      </div>
    );
  }

  return (
    <div className={styles.filesBrowser}>
      <header className={styles.filesToolbar}>
        <div className={styles.filesPathNavigation}>
          <button
            aria-label="Go to parent folder"
            className={styles.filesUpButton}
            disabled={!browser.currentPath}
            onClick={() => {
              setViewingFile(false);
              browser.openDirectory(browser.currentPath.split("/").slice(0, -1).join("/"));
            }}
            title={browser.currentPath ? "Go to parent folder" : "Already at workspace root"}
            type="button"
          >
            <ArrowUpIcon aria-hidden="true" focusable="false" />
          </button>
          <div className={styles.filesPathText}>
            <div className={styles.filesWorkspaceLabel}>{workspaceName || "Workspace files"}</div>
            <nav aria-label="Workspace path" className={styles.filesBreadcrumbs}>
              {breadcrumbs.map((breadcrumb, index) => (
                <span key={breadcrumb.path || "root"}>
                  {index > 0 ? <span aria-hidden="true" className={styles.filesBreadcrumbSeparator}>/</span> : null}
                  <button
                    aria-current={breadcrumb.path === browser.currentPath ? "page" : undefined}
                    onClick={() => {
                      setViewingFile(false);
                      browser.openDirectory(breadcrumb.path);
                    }}
                    type="button"
                  >
                    {breadcrumb.label}
                  </button>
                </span>
              ))}
            </nav>
          </div>
        </div>
        <div className={clsx(styles.filesFilters, viewingFile && styles.filesFiltersViewingFile)}>
          <label className={styles.filesSearch}>
            <span className={styles.visuallyHidden}>Filter files in this folder</span>
            <input
              aria-label="Filter files in this folder"
              name="workspace-file-filter"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter this folder"
              ref={searchInputRef}
              type="search"
              value={query}
            />
            <span
              aria-label={matchingEntriesLabel}
              aria-live="polite"
              role="status"
            >{visibleEntries.length}</span>
          </label>
          <button
            aria-pressed={changedOnly}
            className={clsx(styles.changedFilter, changedOnly && styles.changedFilterActive)}
            onClick={() => setChangedOnly((value) => !value)}
            type="button"
          >
            Changed {changedPaths.size}
          </button>
        </div>
      </header>

      <div
        className={styles.filesContent}
        onFocusCapture={(event) => {
          const focusTarget = event.target;

          if (fileRetrying && !eventTargetIsInside(focusTarget, fileRetryButtonRef.current)) {
            fileRetryOwnsFocusRef.current = false;
          }

          if (browser.loadingFile && !eventTargetIsInside(focusTarget, fileBackButtonRef.current)) {
            fileLoadOwnsFocusRef.current = false;
          }

          if (folderRetrying && !eventTargetIsInside(focusTarget, folderRetryButtonRef.current)) {
            folderRetryFocusRef.current = false;
          }

          if (returnFocusOwnsFocusRef.current && !eventTargetIsInside(focusTarget, returnFocusButtonRef.current)) {
            returnFocusOwnsFocusRef.current = false;
          }
        }}
      >
        {(browser.error && !viewingFile) || folderRetrying ? (
          <div
            aria-busy={folderRetrying}
            aria-label={folderRetrying ? "Reloading folder" : undefined}
            className={clsx(styles.filesError, folderRetrying && styles.filesRetrying)}
            role={browser.error ? "alert" : "status"}
          >
            <span className={styles.filesErrorCopy}>
              <strong>{folderRetrying ? "Reloading folder…" : folderErrorCopy.title}</strong>
              <span>{folderRetrying
                ? "Keep this view open while DeskCue reloads the current folder."
                : folderErrorCopy.detail}</span>
            </span>
            {!viewingFile ? (
              <button
                aria-disabled={folderRetrying}
                onBlur={() => {
                  folderRetryFocusRef.current = false;
                }}
                onClick={(event) => {
                  if (folderRetrying) return;

                  event.currentTarget.focus();
                  folderRetryFocusRef.current = true;
                  folderRetryLoadStartPendingRef.current = true;
                  setFolderRetrying(true);
                  browser.openDirectory(browser.currentPath);
                }}
                ref={folderRetryButtonRef}
                type="button"
              >{folderRetrying ? "Retrying…" : "Retry folder"}</button>
            ) : null}
          </div>
        ) : null}

        <div className={clsx(styles.filesLayout, viewingFile && styles.filesLayoutViewing)}>
        <div
          aria-busy={browser.loadingDirectory}
          aria-label="Workspace files"
          className={styles.filesList}
          role={visibleEntries.length > 0 ? "list" : undefined}
        >
          {browser.loadingDirectory && browser.entries.length === 0 ? (
            <div className={styles.filesLoadingState} role="status">
              <span aria-hidden="true" className={styles.filesLoadingSpinner} />
              <span>Loading files…</span>
            </div>
          ) : visibleEntries.length === 0 ? (
            <p className={styles.filesMuted}>
              {browser.error && browser.entries.length === 0
                ? "Folder contents unavailable."
                : browser.entries.length === 0
                  ? "This folder is empty."
                  : partialDirectoryResults
                    ? "No loaded entries match the current filter."
                    : "No files match the current filter."}
            </p>
          ) : (
            visibleEntries.map((entry) => {
              const isDirectory = entry.kind === "directory";
              const normalizedPath = normalizeWorkspacePath(entry.path);
              const isChanged = changedPaths.has(normalizedPath) || (
                isDirectory && [...changedPaths].some((path) => path.startsWith(`${normalizedPath}/`))
              );
              const entryLabel = isDirectory
                ? "Folder"
                : entry.kind === "file"
                  ? "File"
                  : entry.kind === "symlink"
                    ? "Symbolic link"
                    : "Unsupported entry";
              return (
                <div key={entry.path} role="listitem">
                  <button
                    aria-current={browser.selectedPath === entry.path ? "true" : undefined}
                    aria-label={`${entryLabel} ${entry.name}${isChanged ? " (changed)" : ""}${entry.readable ? "" : ", unavailable"}`}
                    className={clsx(
                      styles.fileRow,
                      browser.selectedPath === entry.path && styles.fileRowSelected
                    )}
                    disabled={!isDirectory && !entry.readable}
                    onClick={() => {
                      if (isDirectory) {
                        setViewingFile(false);
                        browser.openDirectory(entry.path);
                      } else setFileActionTarget({ file: entry, workspaceId });
                    }}
                    ref={returnFocusPathRef.current === entry.path ? returnFocusButtonRef : undefined}
                    title={entry.readable ? undefined : "This entry cannot be opened from DeskCue."}
                    type="button"
                  >
                    <span aria-hidden="true" className={clsx(styles.fileGlyph, isDirectory ? styles.fileGlyphDirectory : styles.fileGlyphFile)} />
                    <span className={styles.fileName}>{entry.name}</span>
                    {isChanged ? <span className={styles.fileChanged}>Changed</span> : null}
                    <span className={styles.fileSize}>
                      {isDirectory ? "" : formatFileSize(entry.sizeBytes)}
                    </span>
                  </button>
                </div>
              );
            })
          )}
          {browser.hasMore ? (
            <button className={styles.filesLoadMore} disabled={browser.loadingDirectory} onClick={browser.loadMore} type="button">
              {browser.loadingDirectory ? "Loading…" : "Load more"}
            </button>
          ) : null}
          {browser.limited ? (
            <p className={styles.filesMuted} role="status">
              Showing the first {MAX_WORKSPACE_BROWSER_ENTRIES} entries. Narrow the folder to continue.
            </p>
          ) : null}
        </div>

          <section
            aria-label="File preview"
            aria-modal={fileViewerExpanded || undefined}
            className={clsx(styles.fileViewer, fileViewerExpanded && styles.fileViewerExpanded)}
            ref={fileViewerRef}
            role={fileViewerExpanded ? "dialog" : undefined}
            tabIndex={-1}
          >
          {browser.loadingFile && !fileRetrying ? (
            <>
              <header className={styles.fileViewerHeader}>
                <button
                  className={styles.filesBackButton}
                  onBlur={() => {
                    if (browser.loadingFile) fileLoadOwnsFocusRef.current = false;
                  }}
                  onClick={() => {
                    fileLoadOwnsFocusRef.current = false;
                    setFileRetrying(false);
                    fileRetryFocusTargetRef.current = null;
                    fileRetryOwnsFocusRef.current = false;
                    returnFocusOwnsFocusRef.current = true;
                    returnFocusPathRef.current = browser.selectedPath;
                    setFileViewerExpanded(false);
                    browser.openDirectory(browser.currentPath);
                  }}
                  ref={fileBackButtonRef}
                  type="button"
                >← Files</button>
              </header>
              <div className={styles.filesLoadingState} role="status">
                <span aria-hidden="true" className={styles.filesLoadingSpinner} />
                <span>Loading file…</span>
              </div>
            </>
          ) : browser.file ? (
            <>
              {!browser.file.binary ? (
                <span
                  aria-label={`${browser.file.path} preview loaded.`}
                  aria-live="polite"
                  className={styles.visuallyHidden}
                  role="status"
                >
                  {browser.file.path} preview loaded.
                </span>
              ) : null}
              <header className={styles.fileViewerHeader}>
                <button
                  className={styles.filesBackButton}
                  onClick={() => {
                    fileLoadOwnsFocusRef.current = false;
                    setFileRetrying(false);
                    fileRetryFocusTargetRef.current = null;
                    fileRetryOwnsFocusRef.current = false;
                    returnFocusOwnsFocusRef.current = true;
                    returnFocusPathRef.current = browser.file?.path ?? browser.selectedPath;
                    setFileViewerExpanded(false);
                    browser.openDirectory(browser.currentPath);
                  }}
                  ref={fileBackButtonRef}
                  type="button"
                >← Files</button>
                <div>
                  <strong>{browser.file.path}</strong>
                  <span>{formatFileSize(browser.file.sizeBytes)}{browser.file.content ? ` · ${textFileLines.length} lines` : ""}</span>
                </div>
                <div className={styles.fileViewerActions}>
                  {browser.file.truncated ? <span className={styles.fileTruncated}>Preview truncated</span> : null}
                  {selectedFileChanged && onOpenChanges ? (
                    <button className={styles.viewChangeButton} onClick={() => onOpenChanges(browser.file!.path)} type="button">View change</button>
                  ) : null}
                  {!browser.file.binary ? (
                    <button
                      aria-label={wrapLines ? "Disable line wrapping" : "Enable line wrapping"}
                      aria-pressed={wrapLines}
                      className={clsx(styles.fileWrapButton, wrapLines && styles.fileWrapButtonActive)}
                      onClick={() => setWrapLines((value) => !value)}
                      title={wrapLines ? "Show source lines without wrapping" : "Wrap long source lines"}
                      type="button"
                    >
                      <WrapLinesIcon aria-hidden="true" focusable="false" />
                      <span>Wrap lines</span>
                    </button>
                  ) : null}
                  <button
                    aria-label={fileViewerExpanded ? "Exit full-screen file view" : "Open full-screen file view"}
                    aria-pressed={fileViewerExpanded}
                    className={styles.fileViewerExpandButton}
                    onClick={() => setFileViewerExpanded((value) => !value)}
                    ref={fileExpandButtonRef}
                    title={fileViewerExpanded ? "Exit full-screen file view" : "Open full-screen file view"}
                    type="button"
                  >
                    {fileViewerExpanded
                      ? <CollapseIcon aria-hidden="true" focusable="false" />
                      : <ExpandIcon aria-hidden="true" focusable="false" />}
                    <span>{fileViewerExpanded ? "Exit full screen" : "Full screen"}</span>
                  </button>
                </div>
              </header>
              {browser.file.binary && isWorkspaceRasterImagePath(browser.file.path) ? (
                <WorkspaceImagePreview file={browser.file} workspaceId={workspaceId} />
              ) : browser.file.binary ? (
                <div className={styles.fileViewerEmpty}>
                  <strong>Binary file</strong>
                  <p>DeskCue does not load binary file contents into the browser.</p>
                </div>
              ) : (
                <pre
                  aria-label="File contents"
                  className={clsx(styles.fileContent, wrapLines && styles.fileContentWrapped)}
                  style={fileContentStyle}
                  tabIndex={0}
                >
                  {textFileLines.map((line, index) => (
                    <span className={styles.fileLine} key={`${index}-${line.length}`}>
                      <span aria-hidden="true" className={styles.fileLineNumber}>{index + 1}</span>
                      <span className={styles.fileLineText}>{line || " "}</span>
                    </span>
                  ))}
                </pre>
              )}
            </>
          ) : viewingFile && browser.selectedPath ? (
            <>
              <header className={styles.fileViewerHeader}>
                <button
                  className={styles.filesBackButton}
                  onClick={() => {
                    fileLoadOwnsFocusRef.current = false;
                    setFileRetrying(false);
                    fileRetryFocusTargetRef.current = null;
                    fileRetryOwnsFocusRef.current = false;
                    returnFocusOwnsFocusRef.current = true;
                    returnFocusPathRef.current = browser.selectedPath;
                    setFileViewerExpanded(false);
                    browser.openDirectory(browser.currentPath);
                  }}
                  ref={fileBackButtonRef}
                  type="button"
                >← Files</button>
              </header>
              <div
                aria-busy={fileRetrying}
                aria-label={fileRetrying ? "Retrying file preview" : "File preview unavailable"}
                className={styles.fileViewerEmpty}
                role={fileRetrying ? "status" : "alert"}
              >
                <strong>{fileRetrying ? "Retrying file preview…" : "File preview unavailable"}</strong>
                <p>{fileRetrying
                  ? "Keep this view open while DeskCue reads the file again."
                  : "DeskCue could not read this file. Check the daemon connection and try again."}</p>
                <button
                  aria-disabled={fileRetrying}
                  className={styles.fileRetryButton}
                  onBlur={() => {
                    fileRetryOwnsFocusRef.current = false;
                  }}
                  onClick={(event) => {
                    if (fileRetrying) return;

                    event.currentTarget.focus();
                    fileRetryOwnsFocusRef.current = true;
                    setFileRetrying(true);
                    browser.openFile(browser.selectedPath);
                  }}
                  ref={fileRetryButtonRef}
                  type="button"
                >{fileRetrying ? "Retrying…" : "Retry file"}</button>
              </div>
            </>
          ) : (
            <div className={styles.fileViewerEmpty}>
              <strong>Select a file</strong>
              <p>Browse the workspace without changing anything.</p>
            </div>
          )}
          </section>
        </div>
      </div>
      <WorkspaceFileActionDialog
        key={fileActionTarget
          ? `${fileActionTarget.workspaceId}:${fileActionTarget.file.path}`
          : "closed"}
        file={fileActionTarget?.file ?? null}
        workspaceId={fileActionTarget?.workspaceId ?? workspaceId}
        onClose={() => {
          const closingTarget = fileActionTarget;

          setFileActionTarget((currentTarget) =>
            currentTarget === closingTarget ? null : currentTarget
          );
        }}
        onPreview={(file) => {
          const previewTarget = fileActionTarget;

          setFileActionTarget((currentTarget) =>
            currentTarget === previewTarget ? null : currentTarget
          );

          setViewingFile(true);
          fileLoadOwnsFocusRef.current = true;
          requestedPathRef.current = file.path;
          browser.openFile(file.path);
        }}
      />
    </div>
  );
}
