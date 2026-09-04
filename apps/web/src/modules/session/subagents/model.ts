import type { AgentSessionSummary } from "@deskcue/protocol";

export function selectDirectSubagentSessions(
  sessions: AgentSessionSummary[],
  parentSessionId: string
) {
  return sessions
    .filter((session) => session.subagent?.parentSessionId === parentSessionId)
    .sort((left, right) => {
      if (left.workState !== right.workState) return left.workState === "running" ? -1 : 1;

      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    });
}

export function mergeSubagentSessions(
  fetchedSessions: AgentSessionSummary[],
  knownSessions: AgentSessionSummary[]
) {
  const sessionsById = new Map(fetchedSessions.map((session) => [session.id, session]));

  for (const session of knownSessions) {
    const fetchedSession = sessionsById.get(session.id);
    const fetchedTimestamp = fetchedSession ? Date.parse(fetchedSession.updatedAt) : Number.NaN;
    const knownTimestamp = Date.parse(session.updatedAt);

    if (
      !fetchedSession ||
      (Number.isFinite(knownTimestamp) && !Number.isFinite(fetchedTimestamp)) ||
      knownTimestamp >= fetchedTimestamp
    ) {
      sessionsById.set(session.id, session);
    }
  }

  return Array.from(sessionsById.values());
}

export function readSubagentDisplayText(session: AgentSessionSummary) {
  const nickname = session.subagent?.nickname?.trim() || null;
  const role = session.subagent?.role?.trim() || null;

  return {
    detail: role ?? (nickname ? session.title : session.agentLabel),
    label: nickname ?? session.title
  };
}

export function readSubagentStatus(session: AgentSessionSummary) {
  if (session.workState === "running" || session.turnState?.phase === "active") {
    return { label: "Running", tone: "running" as const };
  }

  if (session.turnState?.phase === "completed") {
    return { label: "Finished", tone: "finished" as const };
  }

  if (session.turnState?.phase === "failed") {
    return { label: "Failed", tone: "failed" as const };
  }

  if (session.turnState?.phase === "interrupted") {
    return { label: "Stopped", tone: "stopped" as const };
  }

  return { label: "Idle", tone: "idle" as const };
}
