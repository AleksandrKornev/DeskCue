import clsx from "clsx";
import { memo } from "react";

import { formatDate } from "@lib/format";
import { labelForTranscriptRole } from "@models/transcriptEntries";
import type { ChatTranscriptEntry } from "@modules/session/types";

import { ActivityTranscriptContent } from "./ActivityTranscriptContent";
import { activityEntryClassByRole } from "./constants";
import styles from "./styles.module.scss";

export const ActivityEntryArticle = memo(function ActivityEntryArticle({
  entry
}: {
  entry: ChatTranscriptEntry;
}) {
  return (
    <article
      className={clsx(styles.activityEntry, activityEntryClassByRole[entry.role])}
    >
      <header className={styles.activityEntryHeader}>
        {entry.role !== "commentary" ? <strong>{labelForTranscriptRole(entry.role)}</strong> : null}
        <span>{formatDate(entry.timestamp)}</span>
      </header>
      <ActivityTranscriptContent entry={entry} />
    </article>
  );
});
