import clsx from "clsx";

import { STATUS_CLASS_BY_STATUS } from "./constants";
import styles from "./styles.module.scss";
import type { StatusBadgeProps } from "./types";

export function StatusBadge({ status, className, label: labelOverride }: StatusBadgeProps) {
  const label = labelOverride ?? (status === "read_only" ? "read only" : status);

  return (
    <span className={clsx(styles.statusBadge, STATUS_CLASS_BY_STATUS[status], className)}>
      {label}
    </span>
  );
}
