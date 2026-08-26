import type {
  SessionDetail,
  SessionSummary
} from "@deskcue/protocol";
import { isTimestampOlder } from "@modules/dashboard/model/store/helpers";

function hasLifecycleDifference(detail: SessionDetail, summary: SessionSummary) {
  return detail.canSendInput !== summary.canSendInput ||
    detail.exitCode !== summary.exitCode ||
    detail.finishedAt !== summary.finishedAt ||
    detail.inputBlockedReason !== summary.inputBlockedReason ||
    detail.replyState.phase !== summary.replyState.phase ||
    detail.replyState.promptText !== summary.replyState.promptText ||
    detail.replyState.requestedAt !== summary.replyState.requestedAt ||
    detail.actionRequest?.kind !== summary.actionRequest?.kind ||
    detail.actionRequest?.command !== summary.actionRequest?.command ||
    detail.actionRequest?.reason !== summary.actionRequest?.reason ||
    detail.actionRequest?.requestedAt !== summary.actionRequest?.requestedAt ||
    detail.status !== summary.status;
}

export function mergeManagedSessionLifecycle(
  detail: SessionDetail | null,
  summary: SessionSummary | null
) {
  const hasEqualActivityTimestamp = detail && summary
    ? !isTimestampOlder(detail.lastActivityAt, summary.lastActivityAt) &&
      !isTimestampOlder(summary.lastActivityAt, detail.lastActivityAt)
    : false;
  const hasMatchingLifecycle = detail && summary
    ? !hasLifecycleDifference(detail, summary)
    : false;
  const wouldRegressTerminalLifecycle = detail && summary
    ? hasEqualActivityTimestamp && detail.status !== "running" && summary.status === "running"
    : false;

  if (
    !detail ||
    !summary ||
    detail.id !== summary.id ||
    isTimestampOlder(summary.lastActivityAt, detail.lastActivityAt) ||
    wouldRegressTerminalLifecycle ||
    (
      !isTimestampOlder(detail.lastActivityAt, summary.lastActivityAt) &&
      hasMatchingLifecycle
    )
  ) {
    return detail;
  }

  return {
    ...detail,
    actionRequest: summary.actionRequest,
    canSendInput: summary.canSendInput,
    exitCode: summary.exitCode,
    finishedAt: summary.finishedAt,
    inputBlockedReason: summary.inputBlockedReason,
    lastActivityAt: summary.lastActivityAt,
    replyState: summary.replyState,
    status: summary.status
  };
}
