import styles from "./styles.module.scss";
import { ToolIcon } from "./ToolIcon";
import type { ToolRowProps } from "./types";

export function ToolRow({
  active,
  badge,
  icon,
  subtitle,
  title,
  onClick
}: ToolRowProps) {
  return (
    <button
      className={`${styles.toolRow} ${active ? styles.toolRowActive : ""}`}
      aria-expanded={active}
      onClick={onClick}
      type="button"
    >
      <span className={styles.toolIcon} aria-hidden="true">
        <ToolIcon className={styles.toolIconSvg} kind={icon} />
      </span>
      <span className={styles.toolText}>
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </span>
      {badge ? <span className={styles.toolBadge}>{badge}</span> : null}
      <span className={styles.toolChevron} aria-hidden="true" />
    </button>
  );
}
