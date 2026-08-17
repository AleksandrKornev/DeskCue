import type { SessionDetail, SessionSummary } from "@deskcue/protocol";

function isSessionDetail(session: SessionDetail | SessionSummary): session is SessionDetail {
  return "logs" in session && "inputHistory" in session;
}

export function mergeSessionUpdate(
  currentSession: SessionDetail | null,
  update: SessionDetail | SessionSummary
): SessionDetail {
  if (isSessionDetail(update)) {
    return update;
  }

  return {
    ...(currentSession ?? {}),
    ...update,
    logs: currentSession?.logs ?? [],
    inputHistory: currentSession?.inputHistory ?? []
  };
}
