import type {
  SessionDetail,
  SessionSummary
} from "@deskcue/protocol";
import { isTimestampOlder } from "@modules/dashboard/model/store/helpers";

export function mergeManagedSessionLifecycle(
  detail: SessionDetail | null,
  summary: SessionSummary | null
) {
  if (
    !detail ||
    !summary ||
    detail.id !== summary.id ||
    !isTimestampOlder(detail.lastActivityAt, summary.lastActivityAt)
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
