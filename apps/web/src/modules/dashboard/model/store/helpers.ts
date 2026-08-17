import type {
  AgentSessionSummary,
  SessionDetail,
  SessionSummary
} from "@deskcue/protocol";

export {
  mergeAgentSessionDetail,
  mergeAgentSessionTranscriptPage
} from "./transcript/transcriptMerge";

export function sortSessionSummariesByActivity(sessions: SessionSummary[]) {
  sessions.sort(
    (left, right) =>
      new Date(right.lastActivityAt).getTime() - new Date(left.lastActivityAt).getTime()
  );
}

export function formatCount(count: number, exact: boolean) {
  return `${count}${exact ? "" : "+"}`;
}

export function isTimestampOlder(incoming: string, current: string) {
  const incomingTimestamp = Date.parse(incoming);
  const currentTimestamp = Date.parse(current);
  if (Number.isFinite(incomingTimestamp) && Number.isFinite(currentTimestamp)) {
    return incomingTimestamp < currentTimestamp;
  }

  return incoming < current;
}

export function findSelectedManagedSessionSummary(
  sessions: SessionSummary[],
  selectedSessionId: string,
  selectedSession: SessionDetail | null
) {
  return selectedSessionId && selectedSession?.id !== selectedSessionId
    ? sessions.find((session) => session.id === selectedSessionId) ?? null
    : null;
}

export function findActiveTakenOverAgentSessionSummary(
  agentSessions: AgentSessionSummary[],
  sessions: SessionSummary[],
  selectedSessionId: string,
  selectedSession: SessionDetail | null
) {
  const selectedSessionSummary = findSelectedManagedSessionSummary(
    sessions,
    selectedSessionId,
    selectedSession
  );
  const adapterId = selectedSession?.adapterId ?? selectedSessionSummary?.adapterId;
  const sourceSessionId =
    selectedSession?.sourceSessionId ?? selectedSessionSummary?.sourceSessionId;

  return sourceSessionId
    ? agentSessions.find(
        (session) =>
          session.sourceSessionId === sourceSessionId &&
          session.agentId === adapterId
      ) ?? null
    : null;
}

export function getActiveTakenOverAgentSessionSummaryId(
  agentSessions: AgentSessionSummary[],
  sessions: SessionSummary[],
  selectedSessionId: string,
  selectedSession: SessionDetail | null
) {
  const activeSummary = findActiveTakenOverAgentSessionSummary(
    agentSessions,
    sessions,
    selectedSessionId,
    selectedSession
  );

  if (activeSummary) {
    return activeSummary.id;
  }

  const selectedSessionSummary = findSelectedManagedSessionSummary(
    sessions,
    selectedSessionId,
    selectedSession
  );
  const adapterId = selectedSession?.adapterId ?? selectedSessionSummary?.adapterId;
  const sourceSessionId =
    selectedSession?.sourceSessionId ?? selectedSessionSummary?.sourceSessionId;

  return adapterId && sourceSessionId ? `${adapterId}:${sourceSessionId}` : "";
}

export function isStructurallyEqual(left: unknown, right: unknown) {
  if (left === right) {
    return true;
  }

  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

export function hasSameObjectFields(target: object, patch: object) {
  const indexedTarget = target as Record<string, unknown>;
  return Object.entries(patch).every(([key, value]) =>
    isStructurallyEqual(indexedTarget[key], value)
  );
}
