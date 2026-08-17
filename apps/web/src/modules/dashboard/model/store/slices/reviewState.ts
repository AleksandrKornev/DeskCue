import type {
  AgentSessionDetail,
  AgentSessionSummary
} from "@deskcue/protocol";

const MAX_READY_FOR_REVIEW_SESSION_IDS = 50;

export function markReadyForReviewSessionId(
  currentSessionIds: string[],
  sessionId: string,
  selectedAgentSessionId: string
) {
  if (!sessionId || sessionId === selectedAgentSessionId) {
    return currentSessionIds;
  }

  if (currentSessionIds.includes(sessionId)) {
    return currentSessionIds;
  }

  return [sessionId, ...currentSessionIds].slice(0, MAX_READY_FOR_REVIEW_SESSION_IDS);
}

export function clearReadyForReviewSessionId(
  currentSessionIds: string[],
  sessionId: string
) {
  return currentSessionIds.filter((currentSessionId) => currentSessionId !== sessionId);
}

export function reconcileReadyForReviewSessionIds(
  currentSessionIds: string[],
  sessions: AgentSessionSummary[]
) {
  const runningSessionIds = new Set(
    sessions.filter((session) => session.workState === "running").map((session) => session.id)
  );

  if (runningSessionIds.size === 0) {
    return currentSessionIds;
  }

  return currentSessionIds.filter((sessionId) => !runningSessionIds.has(sessionId));
}

export function applyAgentSessionReviewedAt<
  T extends AgentSessionSummary | AgentSessionDetail | null
>(
  session: T,
  sessionId: string,
  reviewedAt: string
): T {
  if (!session || session.id !== sessionId) {
    return session;
  }

  return {
    ...session,
    reviewedAt
  };
}
