import clsx from "clsx";
import { useState } from "react";

import {
  getDiffStatusLabel,
  getDiffStatusLetter,
  groupDiffPartsByFile,
} from "@modules/transcript/RichTranscriptContent/helpers";

import {
  DEFAULT_COLLAPSED_DIFF_FILE_LIMIT,
  diffStatusClassByChangeType
} from "./constants";
import { DiffPath } from "./DiffPath";
import { DiffStats } from "./DiffStats";
import styles from "./styles.module.scss";
import { TranscriptDiffModal } from "./TranscriptDiffModal";
import type { TranscriptDiffListProps } from "./types";

export function TranscriptDiffList(props: TranscriptDiffListProps) {
  const { parts } = props;

  const [selectedDiffIndex, setSelectedDiffIndex] = useState<number | null>(null);

  const fileGroups = groupDiffPartsByFile(parts);
  const canCollapseFileList = fileGroups.length > DEFAULT_COLLAPSED_DIFF_FILE_LIMIT;
  const [showAllFiles, setShowAllFiles] = useState(false);
  const visibleFileGroups =
    canCollapseFileList && !showAllFiles
      ? fileGroups.slice(0, DEFAULT_COLLAPSED_DIFF_FILE_LIMIT)
      : fileGroups;
  const hiddenFileCount = fileGroups.length - visibleFileGroups.length;
  const selectedDiff =
    selectedDiffIndex === null ? null : (fileGroups[selectedDiffIndex] ?? null);

  const aggregateStats = fileGroups.reduce(
    (stats, part) => {
      stats.additions += part.additions;
      stats.deletions += part.deletions;
      return stats;
    },
    {
      additions: 0,
      deletions: 0
    }
  );

  const summaryLabel =
    fileGroups.length === 1 ? "Changed 1 file" : `Changed ${fileGroups.length} files`;

  return (
    <>
      <div className={styles.diffList}>
        <div className={styles.diffListHeader}>
          <div className={styles.diffListSummary}>
            <strong>{summaryLabel}</strong>
            <span className={styles.diffListSummaryMeta}>
              <span className={clsx(styles.diffStat, styles.diffStatAdd)}>
                +{aggregateStats.additions}
              </span>
              <span className={clsx(styles.diffStat, styles.diffStatDelete)}>
                -{aggregateStats.deletions}
              </span>
            </span>
          </div>
        </div>

        <div className={styles.diffListItems}>
          {visibleFileGroups.map((group, index) => {
            return (
              <button
                className={styles.diffListItem}
                key={group.displayPath}
                onClick={() => setSelectedDiffIndex(index)}
                type="button"
              >
                <span
                  className={clsx(styles.diffStatus, diffStatusClassByChangeType[group.changeType])}
                  aria-label={getDiffStatusLabel(group.changeType)}
                  title={getDiffStatusLabel(group.changeType)}
                >
                  {getDiffStatusLetter(group.changeType)}
                </span>
                <DiffPath displayPath={group.displayPath} />
                <DiffStats group={group} />
              </button>
            );
          })}
          {canCollapseFileList ? (
            <button
              className={styles.diffListMoreButton}
              onClick={() => setShowAllFiles((current) => !current)}
              type="button"
            >
              {showAllFiles
                ? "Show fewer files"
                : `Show ${hiddenFileCount} more files`}
              <span
                aria-hidden="true"
                className={clsx(
                  styles.diffListMoreIcon,
                  showAllFiles ? styles.diffListMoreIconExpanded : null
                )}
              />
            </button>
          ) : null}
        </div>
      </div>

      {selectedDiff ? (
        <TranscriptDiffModal
          onClose={() => setSelectedDiffIndex(null)}
          group={selectedDiff}
        />
      ) : null}
    </>
  );
}
