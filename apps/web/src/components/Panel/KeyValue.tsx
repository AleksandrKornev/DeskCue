import clsx from "clsx";

import styles from "./styles.module.scss";
import type { KeyValueProps } from "./types";

export function KeyValue({
  label,
  value,
  className,
  valueClassName
}: KeyValueProps) {
  return (
    <div className={clsx(styles.keyValue, className)}>
      <span className={styles.keyValueLabel}>{label}</span>
      <span className={clsx(styles.keyValueValue, valueClassName)}>{value}</span>
    </div>
  );
}
