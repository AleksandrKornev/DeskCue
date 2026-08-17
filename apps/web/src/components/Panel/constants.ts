import styles from "./styles.module.scss";

export const STATUS_CLASS_BY_STATUS: Record<string, string> = {
  done: styles.statusBadgeDone,
  failed: styles.statusBadgeFailed,
  read_only: styles.statusBadgeReadOnly,
  running: styles.statusBadgeRunning,
  stopped: styles.statusBadgeStopped
};
