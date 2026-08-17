import clsx from "clsx";

import { shouldShowDiffStats } from "./helpers";
import styles from "./styles.module.scss";
import type { DiffStatsProps } from "./types";

export function DiffStats({
  group
}: DiffStatsProps) {
  if (!shouldShowDiffStats(group)) {
    return null;
  }

  return (
    <span className={styles.diffListStats} aria-label="Diff stats">
      <span className={clsx(styles.diffStat, styles.diffStatAdd)}>
        +{group.additions}
      </span>
      <span className={clsx(styles.diffStat, styles.diffStatDelete)}>
        -{group.deletions}
      </span>
    </span>
  );
}
