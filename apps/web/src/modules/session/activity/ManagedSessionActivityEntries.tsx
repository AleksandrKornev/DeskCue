import { useMemo } from "react";

import { ActivityEntryList } from "./ActivityEntryList";
import { PROGRESSIVE_RENDER_THRESHOLD } from "./constants";
import { isCompactSummaryEntry } from "./helpers";
import styles from "./styles.module.scss";
import type { ManagedSessionActivityEntriesProps } from "./types";
import { useProgressiveActivityEntryWindow } from "./useProgressiveActivityEntryWindow";

export function ManagedSessionActivityEntries({
  assetContext,
  deferEntryRender = false,
  entries,
  entryLimit,
  errorLabel,
  hideCompactEntries = false,
  loadingLabel = "Loading activity details..."
}: ManagedSessionActivityEntriesProps) {
  const {
    compactEntryCount,
    targetEntries
  } = useMemo(() => {
    const nextCompactEntryCount = entries.filter(isCompactSummaryEntry).length;
    const nextRenderableEntries = hideCompactEntries
      ? entries.filter((entry) => !isCompactSummaryEntry(entry))
      : entries;

    return {
      compactEntryCount: nextCompactEntryCount,
      targetEntries: entryLimit
        ? nextRenderableEntries.slice(0, entryLimit)
        : nextRenderableEntries
    };
  }, [entries, entryLimit, hideCompactEntries]);

  const shouldRenderProgressively =
    deferEntryRender && targetEntries.length > PROGRESSIVE_RENDER_THRESHOLD;
  const targetEntrySignature = useMemo(
    () => shouldRenderProgressively
      ? targetEntries.map((entry) => entry.id).join("|")
      : "",
    [shouldRenderProgressively, targetEntries]
  );

  const progressiveWindow = useProgressiveActivityEntryWindow({
    entrySignature: targetEntrySignature,
    enabled: shouldRenderProgressively,
    targetCount: targetEntries.length
  });
  const visibleEntries = shouldRenderProgressively
    ? targetEntries.slice(0, progressiveWindow.visibleCount)
    : targetEntries;
  const shouldShowError = Boolean(errorLabel) && visibleEntries.length === 0;
  const hasDeferredEntries =
    shouldRenderProgressively &&
    visibleEntries.length === 0 &&
    targetEntries.length > 0;

  return (
    <>
      {shouldShowError ? (
        <div className={styles.activityEntryNotice}>{errorLabel}</div>
      ) : null}
      {visibleEntries.length > 0 ? (
        <ActivityEntryList assetContext={assetContext} entries={visibleEntries} />
      ) : null}
      {hideCompactEntries &&
      !hasDeferredEntries &&
      !errorLabel &&
      visibleEntries.length === 0 &&
      compactEntryCount > 0 ? (
        <div className={styles.activityEntryNotice}>{loadingLabel}</div>
      ) : null}
    </>
  );
}
