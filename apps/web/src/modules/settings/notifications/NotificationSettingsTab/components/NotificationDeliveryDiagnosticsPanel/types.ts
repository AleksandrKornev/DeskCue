export type DiagnosticMetricTone = "neutral" | "success" | "warning";

export type NotificationDiagnosticMetricProps = {
  label: string;
  tone?: DiagnosticMetricTone;
  value: string;
};
