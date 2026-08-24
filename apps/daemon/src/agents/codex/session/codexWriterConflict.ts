import type { SessionDetail } from "@deskcue/protocol";

export const CODEX_ACTIVE_WRITER_BLOCKED_REASON =
  "Codex Desktop still owns this chat. Close it there, then retry the prompt from DeskCue.";

type CodexActiveWriterConflictScope = {
  requestedAt?: string | null;
};

function isLogInConflictScope(timestamp: string, requestedAt: string | null | undefined) {
  if (requestedAt === undefined) return true;
  if (!requestedAt) return false;

  const logTime = Date.parse(timestamp);
  const requestTime = Date.parse(requestedAt);

  return !Number.isNaN(logTime) && !Number.isNaN(requestTime) && logTime >= requestTime;
}

export function hasCodexActiveWriterConflict(
  session: Pick<SessionDetail, "adapterId" | "logs" | "sourceSessionId">,
  scope: CodexActiveWriterConflictScope = {}
) {
  if (session.adapterId !== "codex" || !session.sourceSessionId) return false;

  const recentErrorOutput = session.logs
    .slice(-24)
    .filter((log) =>
      log.stream === "stderr" && isLogInConflictScope(log.timestamp, scope.requestedAt)
    )
    .map((log) => log.text)
    .join("\n");

  return recentErrorOutput.includes("thread-store conflict") &&
    recentErrorOutput.includes("already has an active writer");
}
