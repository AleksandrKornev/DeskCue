import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";

import ArrowUpIcon from "@assets/images/icon-arrow-up.svg?react";
import CollapseIcon from "@assets/images/icon-collapse.svg?react";
import ExpandIcon from "@assets/images/icon-expand.svg?react";

import { MAX_WORKSPACE_BROWSER_ENTRIES } from "./constants";
import { buildWorkspaceBreadcrumbs, formatFileSize, normalizeWorkspacePath } from "./helpers";
import styles from "./styles.module.scss";
import type { FilesTabPanelProps } from "./types";
import { useWorkspaceFileBrowser } from "./useWorkspaceFileBrowser";

export function FilesTabPanel({
  changedFiles = [],
  requestedPath = "",
  workspaceId,
  workspaceName,
  onOpenChanges,
  onSelectFile
}: FilesTabPanelProps) {
  const browser = useWorkspaceFileBrowser(workspaceId);
  const [changedOnly, setChangedOnly] = useState(false);
  const [fileViewerExpanded, setFileViewerExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [viewingFile, setViewingFile] = useState(false);
  const requestedPathRef = useRef("");
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

  useEffect(() => {
    if (!requestedPath) {
      requestedPathRef.current = "";
      return;
    }
    if (requestedPathRef.current === requestedPath) return;
    requestedPathRef.current = requestedPath;
    void openRequestedPath(requestedPath).then((kind) => {
      setViewingFile(kind === "file");
      if (kind === "directory") onSelectFile?.("");
    });
  }, [onSelectFile, openRequestedPath, requestedPath]);

  useEffect(() => {
    if (!fileViewerExpanded) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFileViewerExpanded(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fileViewerExpanded]);

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
              onSelectFile?.("");
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
                      onSelectFile?.("");
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
              type="search"
              value={query}
            />
            <span>{visibleEntries.length}</span>
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

      <div className={styles.filesContent}>
        {browser.error ? <div className={styles.filesError} role="alert">{browser.error}</div> : null}

        <div className={clsx(styles.filesLayout, viewingFile && styles.filesLayoutViewing)}>
        <div
          aria-busy={browser.loadingDirectory}
          aria-label="Workspace files"
          className={styles.filesList}
          role="list"
        >
          {browser.loadingDirectory && browser.entries.length === 0 ? (
            <div className={styles.filesLoadingState} role="status">
              <span aria-hidden="true" className={styles.filesLoadingSpinner} />
              <span>Loading files…</span>
            </div>
          ) : visibleEntries.length === 0 ? (
            <p className={styles.filesMuted}>{browser.entries.length === 0 ? "This folder is empty." : "No files match the current filter."}</p>
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
                        onSelectFile?.("");
                        browser.openDirectory(entry.path);
                      } else {
                        setViewingFile(true);
                        requestedPathRef.current = entry.path;
                        browser.openFile(entry.path);
                        onSelectFile?.(entry.path);
                      }
                    }}
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
            aria-live="polite"
            className={clsx(styles.fileViewer, fileViewerExpanded && styles.fileViewerExpanded)}
          >
          {browser.loadingFile ? (
            <div className={styles.filesLoadingState} role="status">
              <span aria-hidden="true" className={styles.filesLoadingSpinner} />
              <span>Loading file…</span>
            </div>
          ) : browser.file ? (
            <>
              <header className={styles.fileViewerHeader}>
                <button
                  className={styles.filesBackButton}
                  onClick={() => {
                    setFileViewerExpanded(false);
                    setViewingFile(false);
                  }}
                  type="button"
                >← Files</button>
                <div>
                  <strong>{browser.file.path}</strong>
                  <span>{formatFileSize(browser.file.sizeBytes)}{browser.file.content ? ` · ${browser.file.content.split("\n").length} lines` : ""}</span>
                </div>
                <div className={styles.fileViewerActions}>
                  {browser.file.truncated ? <span className={styles.fileTruncated}>Preview truncated</span> : null}
                  {selectedFileChanged && onOpenChanges ? (
                    <button className={styles.viewChangeButton} onClick={() => onOpenChanges(browser.file!.path)} type="button">View change</button>
                  ) : null}
                  <button
                    aria-label={fileViewerExpanded ? "Exit full-screen file view" : "Open full-screen file view"}
                    aria-pressed={fileViewerExpanded}
                    className={styles.fileViewerExpandButton}
                    onClick={() => setFileViewerExpanded((value) => !value)}
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
              {browser.file.binary ? (
                <div className={styles.fileViewerEmpty}>
                  <strong>Binary file</strong>
                  <p>DeskCue does not load binary file contents into the browser.</p>
                </div>
              ) : (
                <pre className={styles.fileContent}>{browser.file.content}</pre>
              )}
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
    </div>
  );
}
