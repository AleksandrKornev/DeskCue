import styles from "@modules/settings/notifications/NotificationSettingsTab/styles.module.scss";

import type { NotificationDiagnosticMetricProps } from "./types";

export function NotificationDiagnosticMetric({
  label,
  tone = "neutral",
  value
}: NotificationDiagnosticMetricProps) {
  return (
    <div className={styles.deliveryDiagnosticMetric} data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
