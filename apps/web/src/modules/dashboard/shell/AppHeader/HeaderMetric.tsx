import clsx from "clsx";

import { HeaderMetricIcon } from "./HeaderMetricIcon";
import styles from "./styles.module.scss";
import type { HeaderMetricProps } from "./types";

export function HeaderMetric({ icon, label, title, value }: HeaderMetricProps) {
  return (
    <span
      className={clsx(styles.metricPill, styles.iconMetricPill, styles[`${icon}MetricPill`])}
      title={title}
      aria-label={title}
    >
      <HeaderMetricIcon className={styles.metricIcon} kind={icon} />
      <span className={styles.metricLabel}>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}
