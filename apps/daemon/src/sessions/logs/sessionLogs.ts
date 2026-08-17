import type { SessionLogLine } from "@deskcue/protocol";

export const MAX_SESSION_LOG_LINES = 200;
export const MAX_LOG_TEXT_LENGTH = 2000;

export function truncateSessionLogText(text: string) {
  return `${text.slice(0, MAX_LOG_TEXT_LENGTH)}\n...[truncated by DeskCue]\n`;
}

export function normalizeSessionLogs(logs: SessionLogLine[] | undefined) {
  const sourceLogs = Array.isArray(logs) ? logs : [];
  const tailLogs = sourceLogs.slice(-MAX_SESSION_LOG_LINES);
  let changed = tailLogs.length !== sourceLogs.length;

  const normalizedLogs = tailLogs.map((log) => {
    if (log.text.length <= MAX_LOG_TEXT_LENGTH) {
      return log;
    }

    changed = true;
    return {
      ...log,
      text: truncateSessionLogText(log.text)
    };
  });

  return {
    logs: normalizedLogs,
    changed
  };
}
