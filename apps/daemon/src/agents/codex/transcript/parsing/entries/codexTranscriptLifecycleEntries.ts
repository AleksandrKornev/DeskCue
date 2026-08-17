import { createCodexTranscriptEntry } from "./codexTranscriptEntryFactory.ts";
import {
  buildContextCompactedDetail,
  buildTaskCompleteStatus,
  buildTurnAbortedDetail
} from "../codexTranscriptStatus.ts";

export function toCodexLifecycleTranscriptEntry(
  itemType: string,
  payload: Record<string, unknown> | null,
  sessionId: string,
  index: number,
  timestamp: string
) {
  if (itemType === "event_msg" && payload?.type === "task_started") {
    return createCodexTranscriptEntry(
      sessionId,
      index,
      timestamp,
      "system",
      "Turn started",
      null,
      [
        {
          type: "status",
          label: "Turn started",
          detail: null
        }
      ]
    );
  }

  if (itemType === "event_msg" && payload?.type === "task_complete") {
    const status = buildTaskCompleteStatus(payload);

    return createCodexTranscriptEntry(
      sessionId,
      index,
      timestamp,
      "system",
      status.text,
      null,
      [
        {
          type: "status",
          label: status.label,
          detail: status.detail
        }
      ]
    );
  }

  if (
    itemType === "compacted" ||
    (itemType === "response_item" && payload?.type === "compacted")
  ) {
    const detail = buildContextCompactedDetail(payload ?? {});

    return createCodexTranscriptEntry(
      sessionId,
      index,
      timestamp,
      "system",
      "Context compressed",
      "context_compacted",
      [
        {
          type: "status",
          label: "Context compressed",
          detail
        }
      ]
    );
  }

  if (itemType === "event_msg" && payload?.type === "turn_aborted") {
    const reason =
      typeof payload.reason === "string" && payload.reason.trim()
        ? payload.reason.trim()
        : null;
    const detail = buildTurnAbortedDetail(reason, payload.duration_ms);

    return createCodexTranscriptEntry(
      sessionId,
      index,
      timestamp,
      "system",
      "Turn interrupted",
      null,
      [
        {
          type: "status",
          label: "Turn interrupted",
          detail
        }
      ]
    );
  }

  return undefined;
}
