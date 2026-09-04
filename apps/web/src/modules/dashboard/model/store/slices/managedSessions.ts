import type { SessionSummary } from "@deskcue/protocol";

export function selectManagedSessions(
  sessions: SessionSummary[],
  selectedSessionId: string
) {
  const visibleSessions = sessions.filter(
    (session) =>
      session.status === "running" ||
      session.status === "read_only" ||
      (session.id === selectedSessionId && !session.sourceSessionId)
  );

  const deduped = new Map<string, SessionSummary>();

  for (const session of visibleSessions) {
    const key = session.sourceSessionId
      ? `${session.adapterId}:${session.sourceSessionId}`
      : session.id;
    const existing = deduped.get(key);

    if (
      !existing ||
      (existing.status !== "running" && session.status === "running") ||
      (existing.status === session.status &&
        new Date(session.lastActivityAt).getTime() > new Date(existing.lastActivityAt).getTime())
    ) {
      deduped.set(key, session);
    }
  }

  return Array.from(deduped.values());
}

export function countRunningSessions(sessions: SessionSummary[]) {
  return sessions.filter((session) => session.status === "running").length;
}
