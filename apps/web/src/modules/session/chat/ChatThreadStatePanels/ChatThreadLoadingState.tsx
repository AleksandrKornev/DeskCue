import clsx from "clsx";

import styles from "@modules/session/chat/styles.module.scss";

export function ChatThreadLoadingState() {
  return (
    <div className={clsx(styles.chatThread, styles.chatThreadLoading)} aria-busy="true">
      <div className={clsx(styles.chatLoadingDay, styles.skeletonPill, styles.skeletonPillSummary)} />
      <div className={styles.chatLoadingCluster}>
        <div className={clsx(styles.chatLoadingMessage, styles.chatLoadingMessageAssistant)}>
          <div className={styles.chatLoadingMeta}>
            <span className={clsx(styles.chatLoadingPill, styles.skeletonPill)} />
            <span className={clsx(styles.chatLoadingTime, styles.skeletonPill)} />
          </div>
          <span className={clsx(styles.chatLoadingLine, styles.chatLoadingLineWide, styles.skeletonBlock)} />
          <span className={clsx(styles.chatLoadingLine, styles.chatLoadingLineMid, styles.skeletonBlock)} />
        </div>

        <div className={clsx(styles.chatLoadingMessage, styles.chatLoadingMessageUser)}>
          <div className={styles.chatLoadingMeta}>
            <span className={clsx(styles.chatLoadingPill, styles.skeletonPill)} />
            <span className={clsx(styles.chatLoadingTime, styles.skeletonPill)} />
          </div>
          <span className={clsx(styles.chatLoadingLine, styles.chatLoadingLineMid, styles.skeletonBlock)} />
        </div>
      </div>

      <div className={clsx(styles.chatLoadingCluster, styles.chatLoadingClusterBottom)}>
        <div className={clsx(styles.chatLoadingMessage, styles.chatLoadingMessageAssistant)}>
          <div className={styles.chatLoadingMeta}>
            <span className={clsx(styles.chatLoadingPill, styles.skeletonPill)} />
            <span className={clsx(styles.chatLoadingTime, styles.skeletonPill)} />
          </div>
          <span className={clsx(styles.chatLoadingLine, styles.chatLoadingLineWide, styles.skeletonBlock)} />
          <span className={clsx(styles.chatLoadingLine, styles.chatLoadingLineShort, styles.skeletonBlock)} />
        </div>

        <div className={clsx(styles.chatLoadingMessage, styles.chatLoadingMessageUser)}>
          <div className={styles.chatLoadingMeta}>
            <span className={clsx(styles.chatLoadingPill, styles.skeletonPill)} />
            <span className={clsx(styles.chatLoadingTime, styles.skeletonPill)} />
          </div>
          <span className={clsx(styles.chatLoadingLine, styles.chatLoadingLineWide, styles.skeletonBlock)} />
        </div>
      </div>
    </div>
  );
}
