import type { AgentSessionDetail } from "@deskcue/protocol";

import type { SourceTurnInterruptTarget } from "./sourceTurnInterruptLifecycle.ts";

export type ManagedPromptIdentity = {
  promptText: string;
  requestedAtMs: number;
  acceptedUntilMs?: number;
};

function readLifecycleLabel(entry: AgentSessionDetail["transcript"][number]) {
  const status = entry.parts?.find((part) => part.type === "status");

  return status?.type === "status" ? status.label : entry.text;
}

function isTurnBoundary(entry: AgentSessionDetail["transcript"][number]) {
  if (entry.role !== "system") return false;

  const label = readLifecycleLabel(entry);

  return label === "Turn started" || label === "Turn completed" ||
    label === "Turn failed" || label === "Turn interrupted";
}

export function findOwnedActiveSourceTurn(
  agentSession: AgentSessionDetail,
  prompt: ManagedPromptIdentity
): SourceTurnInterruptTarget | null {
  const turnState = agentSession.turnState;

  if (
    turnState?.phase !== "active" ||
    !turnState.fingerprint ||
    !turnState.startedAt
  ) {
    return null;
  }

  const activeTurnIndex = agentSession.transcript.findIndex(
    (entry) => entry.id === turnState.fingerprint
  );

  if (activeTurnIndex < 0) return null;

  for (let index = activeTurnIndex; index >= 0; index -= 1) {
    const entry = agentSession.transcript[index];

    if (index < activeTurnIndex && isTurnBoundary(entry)) return null;
    if (entry.role !== "user" || entry.text.trim() !== prompt.promptText) continue;

    const entryTimestamp = Date.parse(entry.timestamp);

    if (!Number.isFinite(entryTimestamp) || entryTimestamp < prompt.requestedAtMs) return null;
    if (prompt.acceptedUntilMs !== undefined && entryTimestamp > prompt.acceptedUntilMs) return null;

    return {
      fingerprint: turnState.fingerprint,
      startedAt: turnState.startedAt,
      userEntryId: entry.id
    };
  }

  return null;
}

export function isActiveSourceTurnAlreadyInterrupted(agentSession: AgentSessionDetail) {
  const lifecycle = agentSession.interruptLifecycle;
  const turnState = agentSession.turnState;

  if (
    lifecycle?.phase !== "confirmed" ||
    lifecycle.confirmation !== "verified_process" ||
    lifecycle.outcome !== "interrupted" ||
    !lifecycle.turnFingerprint ||
    turnState?.phase !== "active" ||
    !turnState.fingerprint
  ) {
    return false;
  }

  if (lifecycle.turnFingerprint === turnState.fingerprint) return true;

  const markerIndex = agentSession.transcript.findIndex(
    (entry) => entry.id === lifecycle.turnFingerprint
  );
  const activeTurnIndex = agentSession.transcript.findIndex(
    (entry) => entry.id === turnState.fingerprint
  );

  if (markerIndex < 0 || activeTurnIndex < 0 || markerIndex > activeTurnIndex) return false;

  for (let index = markerIndex + 1; index < activeTurnIndex; index += 1) {
    if (isTurnBoundary(agentSession.transcript[index])) return false;
  }

  return true;
}
