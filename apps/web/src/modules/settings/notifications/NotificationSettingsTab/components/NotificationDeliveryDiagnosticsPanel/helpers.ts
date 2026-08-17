import type {
  NotificationDeliveryAttemptDiagnostic,
  NotificationDeliveryDiagnosticEvent
} from "@deskcue/protocol";
import { formatNotificationProviderLabel } from "@modules/settings/notifications/NotificationSettingsTab/helpers";

import type { DiagnosticMetricTone } from "./types";

export function formatDiagnosticEvent(event: NotificationDeliveryDiagnosticEvent | null) {
  if (event === "test") {
    return "test";
  }

  return event ?? "event";
}

export function formatDiagnosticTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(timestamp);
}

export function formatAttemptSummary(attempt: NotificationDeliveryAttemptDiagnostic | null) {
  if (!attempt) {
    return "No attempts";
  }

  const provider = formatNotificationProviderLabel(attempt.provider);
  const event = formatDiagnosticEvent(attempt.event);
  const time = formatDiagnosticTime(attempt.completedAt ?? attempt.attemptedAt);
  const retry = attempt.status === "scheduled" && attempt.nextRetryAt
    ? `, retry ${formatDiagnosticTime(attempt.nextRetryAt)}`
    : "";
  return `${provider} / ${event} / ${attempt.status} at ${time}${retry}`;
}

export function readAttemptTone(
  attempt: NotificationDeliveryAttemptDiagnostic | null
): DiagnosticMetricTone {
  if (attempt?.status === "delivered") {
    return "success";
  }

  if (
    attempt?.status === "failed" ||
    attempt?.status === "scheduled" ||
    attempt?.status === "uncertain"
  ) {
    return "warning";
  }

  return "neutral";
}

export function isFailureUnresolved(
  failure: NotificationDeliveryAttemptDiagnostic | null,
  success: NotificationDeliveryAttemptDiagnostic | null
) {
  if (!failure) {
    return false;
  }

  if (!success || success.provider !== failure.provider) {
    return true;
  }

  const failureTime = Date.parse(failure.completedAt ?? failure.attemptedAt);
  const successTime = Date.parse(success.completedAt ?? success.attemptedAt);

  if (!Number.isFinite(failureTime) || !Number.isFinite(successTime)) {
    return true;
  }

  return successTime <= failureTime;
}
