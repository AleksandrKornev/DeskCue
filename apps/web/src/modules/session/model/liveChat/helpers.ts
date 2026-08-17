import type { SessionDetail, SessionSummary } from "@deskcue/protocol";
import {
  getSessionInterruptLifecycle,
  isInterruptLifecycleUnconfirmed
} from "@models/sessionInterruptLifecycle";

import type {
  SourceLiveState,
  SourceLiveStateWithAttach
} from "./types";

export function resolveContextCompactionCount(
  detailCount: number | null | undefined,
  summaryCount: number | null | undefined
) {
  return Math.max(0, detailCount ?? 0, summaryCount ?? 0);
}

function hasTerminalSourceTurn(session: SourceLiveState | null) {
  return session?.turnState?.phase !== undefined && session.turnState.phase !== "active";
}

export function resolveLiveHeaderStatus({
  isPromptInFlight,
  takenOverAgentSession,
  sessionShell
}: {
  isPromptInFlight: boolean;
  sessionShell: Pick<SessionDetail | SessionSummary, "sourceSessionId" | "status"> | null;
  takenOverAgentSession: SourceLiveState | null;
}) {
  const interruptLifecycle = getSessionInterruptLifecycle(takenOverAgentSession);
  if (sessionShell?.sourceSessionId && interruptLifecycle.phase === "requested") {
    return "running";
  }

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
  sessionShell: Pick<SessionDetail | SessionSummary, "sourceSessionId" | "status"> | null;
  takenOverAgentSession: SourceLiveStateWithAttach | null;
}) {
  if (!sessionShell?.sourceSessionId) {
    return undefined;
  }

  const interruptLifecycle = getSessionInterruptLifecycle(takenOverAgentSession);
  if (interruptLifecycle.phase === "requested") {
    return "stopping";
  }

  if (interruptLifecycle.phase === "confirmed" && interruptLifecycle.confirmation === "source_terminal") {
    return "ready";
  }

  if (isInterruptLifecycleUnconfirmed(interruptLifecycle)) {
    return "interrupt unconfirmed";
  }

  if (!isPromptInFlight && hasTerminalSourceTurn(takenOverAgentSession)) {
    return takenOverAgentSession?.attachMode === "resume" ? "ready" : "read only";
  }

  if (isPromptInFlight || takenOverAgentSession?.workState === "running") {
    return undefined;
  }

  if (takenOverAgentSession?.attachMode === "resume") {
    return "ready";
  }

  if (takenOverAgentSession?.attachMode === "read_only") {
    return "read only";
  }

  return undefined;
}
