import type { AgentSessionDetail, AgentSessionSummary } from "@deskcue/protocol";
import { readSourceAgentDetailMetadata } from "#agents/sourceAgentDetailMetadata";
import { deriveSourceAgentTurnState } from "#agents/sourceAgentTurnState";
import type { SourceAgentTurnState } from "#agents/sourceAgentTurnState";
import type { SourceAgentSessionService } from "#application/sourceAgentSessionService";

export function readAgentSessionDetailReadMode(session: AgentSessionDetail) {
  return readSourceAgentDetailMetadata(session)?.readMode ?? null;
}

function toAgentSessionObservedTurnState(turnState: SourceAgentTurnState) {
  if (turnState.phase === "active") {
    return {
      activityAt: turnState.activityAt,
      completedAt: null,
      evidence: turnState.evidence,
      fingerprint: turnState.fingerprint,
      phase: turnState.phase,
      startedAt: turnState.startedAt
    };
  }

  if (turnState.phase === "idle") {
    return {
      activityAt: null,
      completedAt: null,
      evidence: turnState.evidence,
      fingerprint: turnState.fingerprint,
      phase: turnState.phase,
      startedAt: null
    };
  }

  return {
    activityAt: null,
    completedAt: turnState.completedAt,
    evidence: turnState.evidence,
    fingerprint: turnState.fingerprint,
    phase: turnState.phase,
    startedAt: null
  };
}

export function reconcileSourceWindowSession(
  sourceAgentSessions: SourceAgentSessionService,
  session: AgentSessionDetail
): AgentSessionDetail {
  const reconciledSession = sourceAgentSessions.reconcileAttachedSession(session);
  const turnState = deriveSourceAgentTurnState({ transcript: session.transcript });
  const observedTurnState = toAgentSessionObservedTurnState(turnState);
  const workState = turnState.phase === "active"
    ? "running"
    : turnState.phase === "completed" ||
        turnState.phase === "failed" ||
        turnState.phase === "interrupted"
      ? "idle"
      : reconciledSession.workState;

  return {
    ...reconciledSession,
    attachMode: turnState.phase === "active"
      ? "read_only"
      : reconciledSession.attachMode,
    attachModeReason: turnState.phase === "active"
      ? "This session is active in another client right now"
      : reconciledSession.attachModeReason,
    turnState: observedTurnState.phase !== "idle" || !reconciledSession.turnState
      ? observedTurnState
      : reconciledSession.turnState,
    workState
  };
}

export function toAgentSessionSummary(session: AgentSessionDetail): AgentSessionSummary {
  const {
    transcript: _transcript,
    transcriptView: _transcriptView,
    ...summary
  } = session;
  return summary;
}
