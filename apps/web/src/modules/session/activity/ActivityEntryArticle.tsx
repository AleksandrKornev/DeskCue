import clsx from "clsx";
import { memo } from "react";

import { formatDate } from "@lib/format";
import { labelForTranscriptRole } from "@models/transcriptEntries";

import { ActivityTranscriptContent } from "./ActivityTranscriptContent";
import { activityEntryClassByRole } from "./constants";
import styles from "./styles.module.scss";
import type { ActivityEntryArticleProps } from "./types";

export const ActivityEntryArticle = memo(function ActivityEntryArticle({
  assetContext,
  entry
}: ActivityEntryArticleProps) {
  return (
    <article
      className={clsx(styles.activityEntry, activityEntryClassByRole[entry.role])}
    >
      <header className={styles.activityEntryHeader}>
        {entry.role !== "commentary" ? <strong>{labelForTranscriptRole(entry.role)}</strong> : null}
        <span>{formatDate(entry.timestamp)}</span>
      </header>
      <ActivityTranscriptContent assetContext={assetContext} entry={entry} />
    </article>
  );
});
