import clsx from "clsx";

import styles from "@modules/session/chat/styles.module.scss";

export function ChatThreadEmptyState() {
  return (
    <div className={clsx(styles.chatThread, styles.chatThreadEmpty)}>
      <div className={styles.chatEmptyState}>
        <div className={styles.chatEmptyStateCard}>
          <strong>No chat messages yet</strong>
          <span>
            DeskCue is already connected to this local thread. The first turns
            from the session files will appear here automatically
          </span>
        </div>
      </div>
    </div>
  );
}
