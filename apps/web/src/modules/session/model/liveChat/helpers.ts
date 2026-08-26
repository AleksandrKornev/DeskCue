import type {
  AgentSessionSummary,
  SessionDetail,
  SessionStatus,
  SessionSummary
} from "@deskcue/protocol";
import {
  getSessionInterruptLifecycle,
  isInterruptLifecycleUnconfirmed
} from "@models/sessionInterruptLifecycle";

import type {
  SourceLiveState,
  SourceLiveStateWithAttach
} from "./types";

export function findManagedSourceSessionSummary(
  agentSessions: AgentSessionSummary[],
  sessionShell: Pick<SessionDetail | SessionSummary, "adapterId" | "sourceSessionId"> | null,
  sourceSession: Pick<AgentSessionSummary, "id"> | null
) {
  const exactSession = sourceSession
    ? agentSessions.find((session) => session.id === sourceSession.id)
    : null;

  if (exactSession) return exactSession;
  if (!sessionShell?.sourceSessionId) return null;

  return agentSessions.find(
    (session) =>
      session.agentId === sessionShell.adapterId &&
      session.sourceSessionId === sessionShell.sourceSessionId
  ) ?? null;
}

export function resolveContextCompactionCount(
  detailCount: number | null | undefined,
  summaryCount: number | null | undefined
) {
  return Math.max(0, detailCount ?? 0, summaryCount ?? 0);
}

function hasTerminalSourceTurn(session: SourceLiveState | null) {
  return session?.turnState?.phase !== undefined && session.turnState.phase !== "active";
}

function readTurnStateTimestamp(session: SourceLiveStateWithAttach) {
  const timestamp = session.turnState?.completedAt ??
    session.turnState?.activityAt ??
    session.turnState?.startedAt ??
    null;
  const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;

  return Number.isFinite(parsed) ? parsed : null;
}

export function resolveLiveSourceState(
  detail: SourceLiveStateWithAttach | null,
  summary: SourceLiveStateWithAttach | null
) {
  if (!summary) return detail;
  if (!detail) return summary;

  const detailTurnTimestamp = readTurnStateTimestamp(detail);
  const summaryTurnTimestamp = readTurnStateTimestamp(summary);

  if (summaryTurnTimestamp === null) return detail;
  if (detailTurnTimestamp !== null && summaryTurnTimestamp < detailTurnTimestamp) return detail;

  return {
    ...detail,
    ...summary
  };
}

export function resolveLiveHeaderStatus({
  isPromptInFlight,
  takenOverAgentSession,
  sessionShell
}: {
  isPromptInFlight: boolean;
  sessionShell: Pick<
    SessionDetail | SessionSummary,
    "promptRecovery" | "sourceSessionId" | "status"
  > | null;
  takenOverAgentSession: SourceLiveState | null;
}): SessionStatus {
  if (sessionShell?.status === "failed") return "failed";
  if (sessionShell?.status === "done") return "done";
  if (sessionShell?.status === "stopped") return "stopped";
  if (sessionShell?.promptRecovery) return "read_only";

  const interruptLifecycle = getSessionInterruptLifecycle(takenOverAgentSession);

  if (sessionShell?.sourceSessionId && interruptLifecycle.phase === "requested") return "running";

  if (
    sessionShell?.sourceSessionId &&
    (interruptLifecycle.confirmation === "source_terminal" ||
      isInterruptLifecycleUnconfirmed(interruptLifecycle))
  ) {
    return "read_only";
  }

  if (
    sessionShell?.sourceSessionId &&
    !isPromptInFlight &&
    hasTerminalSourceTurn(takenOverAgentSession)
  ) {
    return "read_only";
  }

  if (
    sessionShell?.sourceSessionId &&
    (isPromptInFlight || takenOverAgentSession?.workState === "running")
  ) {
    return "running";
  }

  return sessionShell?.status ?? "running";
}

export function resolveLiveHeaderStatusLabel({
  isPromptInFlight,
  sessionShell,
  takenOverAgentSession
}: {
  isPromptInFlight: boolean;
  sessionShell: Pick<
    SessionDetail | SessionSummary,
    "inputBlockedReason" | "promptRecovery" | "sourceSessionId" | "status"
  > | null;
  takenOverAgentSession: SourceLiveStateWithAttach | null;
}) {
  if (!sessionShell?.sourceSessionId) return undefined;
  if (sessionShell.status === "failed") return "failed";
  if (sessionShell.promptRecovery?.phase === "not_sent") return "retry required";
  if (sessionShell.promptRecovery?.phase === "checking") return "recovering";
  if (sessionShell.promptRecovery?.phase === "outcome_unknown") return "control lost";
  if (sessionShell.status === "done") return "ready";
  if (sessionShell.status === "stopped") return "ready";

  const interruptLifecycle = getSessionInterruptLifecycle(takenOverAgentSession);

  if (interruptLifecycle.phase === "requested") return "stopping";
  if (interruptLifecycle.phase === "confirmed" && interruptLifecycle.confirmation === "source_terminal") return "ready";
  if (isInterruptLifecycleUnconfirmed(interruptLifecycle)) return "interrupt unconfirmed";

  if (!isPromptInFlight && hasTerminalSourceTurn(takenOverAgentSession)) {
    return takenOverAgentSession?.attachMode === "resume" ? "ready" : "view only";
  }

  if (isPromptInFlight) return undefined;

  if (
    takenOverAgentSession?.workState === "running" &&
    takenOverAgentSession.attachMode === "read_only"
  ) return "observing";
  if (takenOverAgentSession?.workState === "running") return undefined;
  if (takenOverAgentSession?.attachMode === "resume") return "ready";
  if (takenOverAgentSession?.attachMode === "read_only") return "view only";

  return undefined;
}
