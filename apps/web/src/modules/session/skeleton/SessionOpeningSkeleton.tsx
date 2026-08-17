import clsx from "clsx";

import styles from "./styles.module.scss";

export type SessionOpeningSkeletonProps = {
  errorMessage?: string | null;
  onRetry?: () => Promise<unknown>;
};

export function SessionOpeningSkeleton({
  errorMessage,
  onRetry
}: SessionOpeningSkeletonProps) {
  if (errorMessage) {
    return (
      <div className={styles.sessionLoadError} role="alert">
        <p>Unable to load the session.</p>
        <span>{errorMessage}</span>
        {onRetry ? (
          <button type="button" onClick={() => void onRetry()}>
            Retry
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      aria-busy="true"
      aria-label="Loading source-agent chat"
      className={styles.sessionOpeningSkeleton}
      role="status"
    >
      <div className={styles.toolbarShell} data-loading-region="toolbar">
        <div className={styles.sessionOpeningHeader}>
          <div className={styles.sessionOpeningCopy}>
            <div className={styles.sessionOpeningTitleRow}>
              <span className={clsx(styles.skeletonBlock, styles.sessionOpeningTitle)} />
              <span className={clsx(styles.skeletonPill, styles.sessionOpeningStatus)} />
            </div>
            <div className={styles.sessionOpeningMetaRow}>
              <span className={clsx(styles.skeletonPill, styles.sessionOpeningPill)} />
              <span className={clsx(styles.skeletonPill, styles.sessionOpeningPillWide)} />
              <span className={clsx(styles.skeletonPill, styles.sessionOpeningPill)} />
            </div>
            <span className={clsx(styles.skeletonBlock, styles.sessionOpeningMeta)} />
          </div>
          <div className={styles.sessionOpeningActions}>
            <span className={clsx(styles.skeletonPill, styles.sessionOpeningAction)} />
            <span className={clsx(styles.skeletonPill, styles.sessionOpeningIcon)} />
          </div>
        </div>
        <div className={styles.sessionOpeningTabs}>
          <span className={styles.sessionOpeningTabActive} />
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>

      <div className={styles.sessionOpeningWorkspace}>
        <div className={styles.sessionOpeningThread} data-loading-region="transcript">
          <span className={styles.sessionOpeningDay} />
          <div className={styles.sessionOpeningCluster}>
            <div className={clsx(styles.sessionOpeningMessage, styles.sessionOpeningMessageAssistant)}>
              <span className={styles.sessionOpeningMessageMeta} />
              <span className={styles.sessionOpeningLineWide} />
              <span className={styles.sessionOpeningLineMid} />
            </div>
            <div className={clsx(styles.sessionOpeningMessage, styles.sessionOpeningMessageUser)}>
              <span className={styles.sessionOpeningMessageMeta} />
              <span className={styles.sessionOpeningLineMid} />
            </div>
          </div>
          <div className={clsx(styles.sessionOpeningCluster, styles.sessionOpeningClusterBottom)}>
            <div className={clsx(styles.sessionOpeningMessage, styles.sessionOpeningMessageAssistant)}>
              <span className={styles.sessionOpeningMessageMeta} />
              <span className={styles.sessionOpeningLineWide} />
              <span className={styles.sessionOpeningLineShort} />
            </div>
            <div className={clsx(styles.sessionOpeningMessage, styles.sessionOpeningMessageUser)}>
              <span className={styles.sessionOpeningMessageMeta} />
              <span className={styles.sessionOpeningLineWide} />
            </div>
          </div>
        </div>
      </div>

      <div className={styles.sessionOpeningComposerShell} data-loading-region="composer">
        <div className={styles.sessionOpeningComposer}>
          <span className={clsx(styles.skeletonBlock, styles.sessionOpeningComposerField)} />
          <span className={clsx(styles.skeletonPill, styles.sessionOpeningSendButton)} />
        </div>
      </div>
    </div>
  );
}
