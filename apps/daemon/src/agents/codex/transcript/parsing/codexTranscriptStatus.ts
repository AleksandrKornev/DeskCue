import { isRecord } from "./codexTranscriptShared.ts";

export type CodexTaskCompleteStatus =
  | {
      detail: string | null;
      label: "Turn completed";
      text: string;
    }
  | {
      detail: string;
      label: "Turn failed";
      text: string;
    };

export function buildContextCompactedDetail(payload: Record<string, unknown>) {
  const replacementHistory = Array.isArray(payload.replacement_history)
    ? payload.replacement_history
    : [];
  const summarizedMessageCount = replacementHistory.filter((entry) => isRecord(entry)).length;

  if (summarizedMessageCount > 0) {
    return `Codex summarized ${summarizedMessageCount} earlier message${summarizedMessageCount === 1 ? "" : "s"} to keep the conversation going.`;
  }

  return "Codex summarized earlier conversation state to stay within context limits.";
}

function readTaskCompleteFailureMessage(lastAgentMessage: unknown) {
  if (typeof lastAgentMessage !== "string" || !lastAgentMessage.trim()) {
    return null;
  }

  const trimmedMessage = lastAgentMessage.trim();

  try {
    const parsed = JSON.parse(trimmedMessage) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    const message = typeof parsed.message === "string" ? parsed.message.trim() : "";
    const errorInfo =
      typeof parsed.codex_error_info === "string" ? parsed.codex_error_info.trim() : "";

    if (message && errorInfo) {
      return message;
    }
  } catch {
    return null;
  }

  return null;
}

export function buildTaskCompleteStatus(
  payload: Record<string, unknown>
): CodexTaskCompleteStatus {
  const durationDetail =
    typeof payload.duration_ms === "number"
      ? `after ${Math.max(1, Math.round(payload.duration_ms / 1000))}s`
      : null;
  const failedMessage = readTaskCompleteFailureMessage(payload.last_agent_message);

  if (failedMessage) {
    const detail = [failedMessage, durationDetail].filter(Boolean).join(" ");
    return {
      detail,
      label: "Turn failed",
      text: failedMessage
    };
  }

  const detail =
    typeof payload.duration_ms === "number"
      ? `Completed in ${Math.max(1, Math.round(payload.duration_ms / 1000))}s`
      : null;

  return {
    detail,
    label: "Turn completed",
    text: detail ?? "Turn completed"
  };
}

function capitalize(value: string) {
  return value.length > 0 ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

export function buildTurnAbortedDetail(reason: string | null, durationMs: unknown) {
  const parts: string[] = [];

  if (reason) {
    parts.push(reason === "interrupted" ? "Interrupted by user" : capitalize(reason));
  }

  if (typeof durationMs === "number") {
    parts.push(`after ${Math.max(1, Math.round(durationMs / 1000))}s`);
  }

  return parts.join(" ") || null;
}
