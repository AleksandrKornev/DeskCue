import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";

import { MAX_VISIBLE_DIFF_FILES } from "@modules/session/tabs/constants";
import {
  filterDiffFiles,
  filterUnifiedDiff,
  isHiddenDiffPath,
  trimUnifiedDiff
} from "@modules/session/tabs/helpers";
import { TabPanelSurface } from "@modules/session/tabs/TabPanelSurface";
import type { DiffTabPanelProps } from "@modules/session/tabs/types";
import { TranscriptDiffList } from "@modules/transcript";

import {
  basename,
  describeDiffStatus,
  diffStatusLabel,
  mergeDiffReviewFiles,
  parentPath,
  parseUnifiedDiff
} from "./helpers";
import styles from "./styles.module.scss";
import type { DiffFileReview } from "./types";

const REFRESH_CHANGES_ERROR = "Could not refresh workspace changes";
const CHANGES_COMPACT_MEDIA_QUERY = "(max-width: 900px)";

type RefreshChangesArgs = {
  onRefreshGit: NonNullable<DiffTabPanelProps["onRefreshGit"]>;
  setRefreshError: (value: string) => void;
  setRefreshing: (value: boolean) => void;
};

async function refreshChanges({
  onRefreshGit,
  setRefreshError,
  setRefreshing
}: RefreshChangesArgs) {
  setRefreshError("");
  setRefreshing(true);

  try {
    await onRefreshGit();
  } catch {
    setRefreshError(REFRESH_CHANGES_ERROR);
  } finally {
    setRefreshing(false);
  }
}

function describeCount(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function describeReviewFileAction(file: DiffFileReview) {
  const identity = `${describeDiffStatus(file.status)}: ${file.path}`;

  if (!file.hasLineStats) return identity;

  return `${identity}, ${describeCount(file.additions, "addition", "additions")}, ${describeCount(
    file.deletions,
    "deletion",
    "deletions"
  )}`;
}

function useCompactChangesViewport() {
  const [compact, setCompact] = useState(() =>
    typeof window === "undefined" || typeof window.matchMedia !== "function"
      ? true
      : window.matchMedia(CHANGES_COMPACT_MEDIA_QUERY).matches
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;

    const mediaQuery = window.matchMedia(CHANGES_COMPACT_MEDIA_QUERY);
    const controller = new AbortController();

    setCompact(mediaQuery.matches);
    mediaQuery.addEventListener("change", () => setCompact(mediaQuery.matches), { signal: controller.signal });

    return () => controller.abort();
  }, []);

  return compact;
}

export function ChangesReview({
  git,
  preferredFilePath = "",
  showWorkspaceGit = true,
  sourceDiffParts,
  onOpenFile,
  onRefreshGit,
  onSelectFile
}: DiffTabPanelProps) {
  const compactViewport = useCompactChangesViewport();
  const visibleChangedFiles = useMemo(() => git ? filterDiffFiles(git.changedFiles) : [], [git]);
  const hiddenChangedFileCount = git ? git.changedFiles.length - visibleChangedFiles.length : 0;

  const visibleDiff = useMemo(() => git
    ? trimUnifiedDiff(filterUnifiedDiff(git.diff), git.diffTruncated)
    : null, [git]);
  const parsedFiles = useMemo(() => parseUnifiedDiff(visibleDiff?.text ?? ""), [visibleDiff?.text]);

  const reviewFiles = useMemo(
    () => mergeDiffReviewFiles(
      visibleChangedFiles,
      parsedFiles,
      git?.changedFileStatuses,
      git?.changedFilePreviousPaths
    ),
    [git?.changedFilePreviousPaths, git?.changedFileStatuses, parsedFiles, visibleChangedFiles]
  );

  const [query, setQuery] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [reviewingFile, setReviewingFile] = useState(false);
  const [selectedPath, setSelectedPath] = useState("");
  const detailRef = useRef<HTMLElement>(null);
  const mobileBackButtonRef = useRef<HTMLButtonElement>(null);
  const openedPreferredFilePathRef = useRef("");
  const returnFocusToListRef = useRef(false);
  const selectedFileButtonRef = useRef<HTMLButtonElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingFiles = normalizedQuery
    ? reviewFiles.filter((file) => file.path.toLocaleLowerCase().includes(normalizedQuery))
    : reviewFiles;
  const filteredFiles = matchingFiles.slice(0, MAX_VISIBLE_DIFF_FILES);
  const remainingFileCount = Math.max(0, matchingFiles.length - filteredFiles.length);
  const selectedFile = filteredFiles.find((file) => file.path === selectedPath) ?? filteredFiles[0] ?? null;
  const missingPatchDescription = selectedFile?.status === "deleted"
    ? visibleDiff?.wasTrimmed
      ? "This deleted file's patch is not included in the bounded workspace diff; use Git to inspect its previous contents."
      : "This file is deleted from the working tree; use Git to inspect its previous contents."
    : visibleDiff?.wasTrimmed
      ? "This file's patch is not included in the bounded workspace diff. Open it in Files to inspect the current contents."
      : "This is often a new, binary, ignored, or untracked path. Open it in Files to inspect the current contents.";
  const hiddenSourceDiffCount = sourceDiffParts.filter((part) => isHiddenDiffPath(part.filePath ?? part.title)).length;
  const visibleSourceDiffParts = sourceDiffParts.filter((part) => !isHiddenDiffPath(part.filePath ?? part.title));

  useEffect(() => {
    const preferred = reviewFiles.find((file) => file.path === preferredFilePath)?.path;

    setSelectedPath((current) => preferred ?? reviewFiles.find((file) => file.path === current)?.path ?? reviewFiles[0]?.path ?? "");

    if (!preferredFilePath) {
      openedPreferredFilePathRef.current = "";
      return;
    }

    if (preferred && openedPreferredFilePathRef.current !== preferredFilePath) {
      openedPreferredFilePathRef.current = preferredFilePath;
      setReviewingFile(true);
    }
  }, [preferredFilePath, reviewFiles]);

  useEffect(() => {
    if (reviewingFile) {
      if (compactViewport) mobileBackButtonRef.current?.focus();
      else detailRef.current?.focus();

      return;
    }

    if (!returnFocusToListRef.current) return;

    returnFocusToListRef.current = false;
    selectedFileButtonRef.current?.focus();
  }, [compactViewport, reviewingFile, selectedPath]);

  return (
    <div className={clsx(styles.changesStack, styles.changesReviewStack)}>
      {sourceDiffParts.length > 0 || !showWorkspaceGit ? (
        <TabPanelSurface
          title="Agent-reported changes"
          subtitle="Evidence captured from this chat; workspace state below remains authoritative"
        >
          {sourceDiffParts.length === 0 ? (
            <p className={styles.muted}>Agent-reported file changes will appear here.</p>
          ) : visibleSourceDiffParts.length > 0 ? (
            <div className={styles.changesStack}>
              {hiddenSourceDiffCount > 0 ? <p className={styles.muted}>{hiddenSourceDiffCount} generated or temporary changes hidden</p> : null}
              <TranscriptDiffList parts={visibleSourceDiffParts} />
            </div>
          ) : (
            <p className={styles.muted}>{hiddenSourceDiffCount} generated or temporary changes hidden</p>
          )}
        </TabPanelSurface>
      ) : null}

      {showWorkspaceGit ? (
        <section className={styles.changesReview}>
          <div className={styles.changesHeaderStack}>
            <header className={styles.changesHeader}>
              <div>
                <div className={styles.changesEyebrow}>{git?.branch ? `Branch · ${git.branch}` : "Workspace changes"}</div>
                <h2>{reviewFiles.length === 0 && hiddenChangedFileCount > 0
                  ? "0 reviewable workspace changes"
                  : reviewFiles.length === 1
                    ? "1 workspace change"
                    : `${reviewFiles.length} workspace changes`}</h2>
                <p>Review the working tree without staging or modifying files.</p>
              </div>
              {onRefreshGit ? (
                <button
                  aria-busy={refreshing}
                  className={styles.refreshButton}
                  disabled={refreshing}
                  onClick={() => {
                    void refreshChanges({ onRefreshGit, setRefreshError, setRefreshing });
                  }}
                  type="button"
                >
                  {refreshing ? "Refreshing…" : "Refresh"}
                </button>
              ) : null}
            </header>

            {refreshError ? <p className={styles.refreshError} role="status">{refreshError}</p> : null}
          </div>

          {!git ? (
            <div aria-label="Loading workspace changes" className={styles.loadingPanel} role="status">
              <span className={styles.visuallyHidden}>Loading workspace changes</span>
            </div>
          ) : reviewFiles.length === 0 ? (
            <div className={styles.emptyState}>
              <strong>{!git.isGitRepo
                ? "Git is not available here"
                : hiddenChangedFileCount > 0
                  ? "Only hidden changes remain"
                  : "Working tree is clean"}</strong>
              <p>{hiddenChangedFileCount > 0
                ? hiddenChangedFileCount === 1
                  ? "1 generated or temporary file is hidden."
                  : `${hiddenChangedFileCount} generated or temporary files are hidden.`
                : "New workspace changes will appear here automatically."}</p>
            </div>
          ) : (
            <div className={clsx(styles.changesLayout, reviewingFile && styles.changesLayoutReviewing)}>
              <aside className={styles.changesSidebar}>
                <div className={styles.changesSidebarControls}>
                  <label className={styles.searchField}>
                    <span className={styles.visuallyHidden}>Filter workspace changes</span>
                    <input
                      aria-label="Filter workspace changes"
                      name="workspace-change-filter"
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Filter workspace changes"
                      type="search"
                      value={query}
                    />
                    <span
                      aria-label={`${matchingFiles.length} matching workspace changes`}
                      aria-live="polite"
                      role="status"
                    >{matchingFiles.length}</span>
                  </label>
                  {hiddenChangedFileCount > 0 ? (
                    <p className={styles.sidebarNote}>{hiddenChangedFileCount === 1
                      ? "1 generated or temporary file hidden"
                      : `${hiddenChangedFileCount} generated or temporary files hidden`}</p>
                  ) : null}
                </div>
                <div aria-label="Workspace changes" className={styles.changedFileList} role="list">
                  {filteredFiles.map((file) => (
                    <div key={file.path} role="listitem">
                      <button
                        aria-label={describeReviewFileAction(file)}
                        aria-current={selectedFile?.path === file.path ? "true" : undefined}
                        className={clsx(styles.changedFileRow, selectedFile?.path === file.path && styles.changedFileRowSelected)}
                        onClick={() => {
                          setSelectedPath(file.path);
                          setReviewingFile(true);
                          onSelectFile?.(file.path);
                        }}
                        ref={selectedFile?.path === file.path ? selectedFileButtonRef : undefined}
                        type="button"
                      >
                        <span
                          className={clsx(styles.fileStatus, styles[`fileStatus${file.status}`])}
                          title={describeDiffStatus(file.status)}
                        >{diffStatusLabel(file.status)}</span>
                        <span className={styles.changedFileIdentity}>
                          <strong>{basename(file.path)}</strong>
                          <span>{parentPath(file.path) || "Workspace root"}</span>
                        </span>
                        {file.hasLineStats ? (
                          <span className={styles.diffStats}><b>+{file.additions}</b><i>−{file.deletions}</i></span>
                        ) : null}
                      </button>
                    </div>
                  ))}
                  {filteredFiles.length === 0 ? <p className={styles.sidebarNote}>No changed files match this filter.</p> : null}
                  {remainingFileCount > 0 ? (
                    <p className={styles.sidebarNote}>{remainingFileCount === 1
                      ? "1 more matching file is outside this bounded view."
                      : `${remainingFileCount} more matching files are outside this bounded view.`}</p>
                  ) : null}
                </div>
              </aside>

              <article
                aria-label={selectedFile ? `Change details for ${selectedFile.path}` : "Workspace change details"}
                className={styles.diffViewer}
                ref={detailRef}
                tabIndex={-1}
              >
                {selectedFile ? (
                  <>
                    <header className={styles.diffViewerHeader}>
                      <button
                        className={styles.mobileBackButton}
                        onClick={() => {
                          returnFocusToListRef.current = true;
                          setReviewingFile(false);
                        }}
                        ref={mobileBackButtonRef}
                        type="button"
                      >← Files</button>
                      <div className={styles.diffFileTitle}>
                        <strong title={selectedFile.path}>{selectedFile.previousPath
                          ? `${selectedFile.previousPath} → ${selectedFile.path}`
                          : selectedFile.path}</strong>
                        <span>
                          {describeDiffStatus(selectedFile.status)}
                          {selectedFile.hasLineStats ? <> · <b>+{selectedFile.additions}</b> <i>−{selectedFile.deletions}</i></> : null}
                        </span>
                      </div>
                      {onOpenFile && selectedFile.status !== "deleted"
                        ? <button className={styles.openFileButton} onClick={() => onOpenFile(selectedFile.path)} type="button">Open in Files</button>
                        : null}
                    </header>
                    {visibleDiff?.wasTrimmed ? <p className={styles.diffNotice}>Workspace diff truncated to keep review responsive.</p> : null}
                    {selectedFile.lines.length > 0 ? (
                      <div
                        aria-label={`Diff for ${selectedFile.path}`}
                        className={styles.diffLines}
                        role="region"
                        tabIndex={0}
                      >
                        {selectedFile.lines.map((line, index) => (
                          <div className={clsx(styles.diffLine, styles[`diffLine${line.kind}`])} key={`${line.oldLine}:${line.newLine}:${index}`}>
                            <span>{line.oldLine ?? ""}</span>
                            <span>{line.newLine ?? ""}</span>
                            <code>{line.kind === "addition" ? "+" : line.kind === "deletion" ? "−" : " "}{line.text}</code>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className={styles.emptyDiff}>
                        <strong>No textual patch available</strong>
                        <p>{missingPatchDescription}</p>
                      </div>
                    )}
                  </>
                ) : (
                  <div className={styles.emptyDiff}>
                    <strong>No matching file selected</strong>
                    <p>Adjust the workspace change filter to review a file.</p>
                  </div>
                )}
              </article>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
