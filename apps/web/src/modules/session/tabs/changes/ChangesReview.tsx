import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";

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

export function ChangesReview({
  git,
  preferredFilePath = "",
  showWorkspaceGit = true,
  sourceDiffParts,
  onOpenFile,
  onRefreshGit,
  onSelectFile
}: DiffTabPanelProps) {
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
  const [reviewingFile, setReviewingFile] = useState(false);
  const [selectedPath, setSelectedPath] = useState("");
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

    if (preferred) setReviewingFile(true);
  }, [preferredFilePath, reviewFiles]);

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
              <button className={styles.refreshButton} onClick={onRefreshGit} type="button">
                Refresh
              </button>
            ) : null}
          </header>

          {!git ? (
            <div className={styles.loadingPanel} role="status" />
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
                    <span>{filteredFiles.length}</span>
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
                        aria-current={selectedFile?.path === file.path ? "true" : undefined}
                        className={clsx(styles.changedFileRow, selectedFile?.path === file.path && styles.changedFileRowSelected)}
                        onClick={() => {
                          setSelectedPath(file.path);
                          setReviewingFile(true);
                          onSelectFile?.(file.path);
                        }}
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
                  {remainingFileCount > 0 ? <p className={styles.sidebarNote}>{remainingFileCount} more matching files are outside this bounded view.</p> : null}
                </div>
              </aside>

              <article className={styles.diffViewer}>
                {selectedFile ? (
                  <>
                    <header className={styles.diffViewerHeader}>
                      <button className={styles.mobileBackButton} onClick={() => setReviewingFile(false)} type="button">← Files</button>
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
                      <div aria-label={`Diff for ${selectedFile.path}`} className={styles.diffLines} role="region">
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
