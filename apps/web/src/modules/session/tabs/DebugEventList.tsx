import clsx from "clsx";

import { formatDate } from "@lib/format";

import {
  debugEntryClassByStream,
  debugStreamClassByStream
} from "./constants";
import styles from "./styles.module.scss";
import type { DebugEventListProps } from "./types";

export function DebugEventList({
  debugEntries,
  hasSelectedSession,
  hasSourceSession
}: DebugEventListProps) {
  if (!hasSelectedSession) {
    return (
      <div className={styles.stackLarge}>
        <div className={clsx(styles.skeletonBlock, styles.skeletonTerminal)} />
      </div>
    );
  }

  if (debugEntries.length === 0) {
    return (
      <pre className={styles.terminal}>
        {hasSourceSession
          ? "No transport events yet. The transcript remains the main surface"
          : "Waiting for output..."}
      </pre>
    );
  }

  return (
    <div className={styles.debugFeed}>
      {debugEntries.map((entry) => (
        <article
          key={entry.id}
          className={clsx(styles.debugEntry, debugEntryClassByStream[entry.stream])}
        >
          <header className={styles.debugEntryHeader}>
            <span
              className={clsx(
                styles.debugEntryStream,
                debugStreamClassByStream[entry.stream]
              )}
            >
              {entry.stream}
            </span>
            <span>{formatDate(entry.timestamp)}</span>
          </header>
          <p className={styles.debugEntryText}>{entry.text}</p>
        </article>
      ))}
    </div>
  );
}
