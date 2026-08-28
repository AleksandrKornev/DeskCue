import type {
  AgentSessionDetail,
  AgentSessionSummary,
  AgentSessionInterruptLifecycle,
  SessionDetail,
  SessionLogLine
} from "@deskcue/protocol";
import { deriveSourceAgentTurnState } from "#agents/sourceAgentTurnState";
import { SqliteSourceTurnInterruptStore } from "#persistence/journals/sourceTurnInterruptStore";
import type { SourceTurnInterruptRecord } from "#persistence/journals/sourceTurnInterruptStore";

import { findOwnedActiveSourceTurn } from "./managedSourceTurnOwnership.ts";

export type SourceTurnInterruptTarget = {
  fingerprint: string;
  startedAt: string;
  userEntryId?: string;
};

export type ManagedSourceTurnInterruptRequest = {
  ownsCancellation: boolean;
  record: SourceTurnInterruptRecord;
};

const REQUEST_CONFIRMATION_GRACE_MS = 20_000;
const REQUESTED_RETENTION_MS = 24 * 60 * 60 * 1000;
const UNRESOLVED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const EXTERNAL_FORCE_STOP_FALLBACK_PREFIX = "external-force-stop:";
const LATE_SOURCE_ENTRY_GRACE_MS = 15_000;
const INPUT_SENT_LOG = "Input sent.\n";
const PROMPT_INTERRUPT_REQUESTED_LOG = "Prompt interrupt requested.\n";

function toPublicLifecycle(record: SourceTurnInterruptRecord): AgentSessionInterruptLifecycle {
  if (record.phase === "confirmed_source") {
    return {
      phase: "confirmed",
      requestedAt: record.requestedAt,
      confirmedAt: record.confirmedAt,
      turnFingerprint: record.turnFingerprint,
      confirmation: "source_terminal",
      outcome: record.terminalOutcome
    };
  }

  if (record.phase === "confirmed_transport") {
    return {
      phase: "unresolved",
      requestedAt: record.requestedAt,
      confirmedAt: record.confirmedAt,
      turnFingerprint: record.turnFingerprint,
      confirmation: "managed_transport",
      outcome: null
    };
  }

  if (record.phase === "confirmed_process") {
    return {
      phase: "confirmed",
      requestedAt: record.requestedAt,
      confirmedAt: record.confirmedAt,
      turnFingerprint: record.turnFingerprint,
      confirmation: "verified_process",
      outcome: "interrupted"
    };
  }

  return {
    phase: record.phase,
    requestedAt: record.requestedAt,
    confirmedAt: null,
    turnFingerprint: record.turnFingerprint,
    confirmation: null,
    outcome: null
  };
}

function expiresAt(timestamp: string, durationMs: number) {
  return new Date(Date.parse(timestamp) + durationMs).toISOString();
}

function findLastSystemLogIndex(logs: SessionLogLine[], text: string) {
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    if (logs[index].stream === "system" && logs[index].text === text) return index;
  }

  return -1;
}

export class SourceTurnInterruptLifecycle {
  constructor(private readonly store: SqliteSourceTurnInterruptStore) {}

  close() {
    this.store.close();
  }

  request(session: SessionDetail, target: SourceTurnInterruptTarget) {
    if (!session.sourceSessionId) return null;

    const now = new Date().toISOString();

    return this.store.upsert({
      agentId: session.adapterId,
      sourceSessionId: session.sourceSessionId,
      managedSessionId: session.id,
      turnStartEntryId: target.fingerprint,
      // `turnStartEntryId` keeps lifecycle reconciliation tied to the source
      // turn. `turnFingerprint` is intentionally the user entry when we have
      // one: transcript projection then marks the precise DeskCue prompt,
      // rather than searching backwards from an older `Turn started` entry.
      turnFingerprint: target.userEntryId ?? target.fingerprint,
      turnStartedAt: target.startedAt,
      requestedAt: now,
      phase: "requested",
      confirmationKind: null,
      confirmationEntryId: null,
      terminalOutcome: null,
      confirmedAt: null,
      updatedAt: now,
      expiresAt: expiresAt(now, REQUESTED_RETENTION_MS)
    });
  }

  requestManaged(
    session: SessionDetail,
    target: SourceTurnInterruptTarget
  ): ManagedSourceTurnInterruptRequest | null {
    if (!session.sourceSessionId) return null;

    const turnFingerprint = target.userEntryId ?? target.fingerprint;
    const existing = this.store.get({
      agentId: session.adapterId,
      sourceSessionId: session.sourceSessionId,
      turnFingerprint
    });

    if (
      existing?.managedSessionId === session.id &&
      existing.turnStartEntryId === target.fingerprint &&
      existing.phase === "requested" &&
      Date.parse(existing.expiresAt) > Date.now()
    ) {
      return { ownsCancellation: false, record: existing };
    }

    const record = this.request(session, target);

    return record ? { ownsCancellation: true, record } : null;
  }

  requestExternalForceStop(
    session: SessionDetail,
    target?: SourceTurnInterruptTarget | null
  ) {
    const now = new Date().toISOString();
    const record = this.request(session, target ?? {
      fingerprint: `${EXTERNAL_FORCE_STOP_FALLBACK_PREFIX}${Date.now()}`,
      startedAt: now
    });

    // The process identity was verified immediately before this method is called
    // and the operating system confirmed its termination. A source transcript can
    // lag or omit its terminal event, so it must not keep the chat blocked.
    return record
      ? this.upsertPhase(record, "confirmed_process", "verified_process", null, "interrupted")
      : null;
  }

  confirmManagedTransportExit(session: SessionDetail) {
    const record = this.store.getLatestForManagedSession(session.id);

    if (
      !record ||
      (record.phase !== "requested" && record.phase !== "unresolved")
    ) {
      return null;
    }

    // DeskCue owns this transport and observed its process exit. A source file
    // may never append a terminal entry for a killed one-shot `codex exec
    // resume`, but that cannot keep the compose box blocked or make the UI
    // claim that the turn started outside DeskCue.
    return this.upsertPhase(record, "confirmed_process", "verified_process", null, "interrupted");
  }

  reconcileManagedTransportExit(session: SessionDetail, agentSession: AgentSessionDetail) {
    const existing = this.store.getLatestForManagedSession(session.id);

    if (existing) return this.confirmManagedTransportExit(session);

    const interruptLogIndex = findLastSystemLogIndex(
      session.logs,
      PROMPT_INTERRUPT_REQUESTED_LOG
    );
    const interruptLog = session.logs[interruptLogIndex];
    const hasNewerInput = interruptLogIndex >= 0 && session.logs.slice(interruptLogIndex + 1)
      .some((log) => log.stream === "system" && log.text === INPUT_SENT_LOG);

    if (hasNewerInput) return null;

    const inputLog = [...session.logs].reverse().find((log) =>
      log.stream === "system" &&
      log.text === INPUT_SENT_LOG &&
      (!interruptLog || Date.parse(log.timestamp) <= Date.parse(interruptLog.timestamp))
    );
    const promptText = session.inputHistory.at(-1)?.trim() ?? "";
    const requestedAtMs = inputLog ? Date.parse(inputLog.timestamp) : Number.NaN;
    const interruptedAtMs = interruptLog ? Date.parse(interruptLog.timestamp) : Number.NaN;

    if (!promptText || !Number.isFinite(requestedAtMs) || !Number.isFinite(interruptedAtMs)) return null;

    const target = findOwnedActiveSourceTurn(agentSession, {
      promptText,
      requestedAtMs,
      acceptedUntilMs: interruptedAtMs + LATE_SOURCE_ENTRY_GRACE_MS
    });

    if (!target || !this.requestManaged(session, target)) return null;

    return this.confirmManagedTransportExit(session);
  }

  cancelManagedRequest(
    session: SessionDetail,
    target: SourceTurnInterruptTarget,
    request: ManagedSourceTurnInterruptRequest
  ) {
    if (!request.ownsCancellation) return false;

    const record = this.store.getLatestForManagedSession(session.id);

    if (
      !record ||
      record.phase !== "requested" ||
      record.turnStartEntryId !== target.fingerprint ||
      record.requestedAt !== request.record.requestedAt
    ) {
      return false;
    }

    return this.store.deleteRequested(request.record) === 1;
  }

  decorate<T extends AgentSessionSummary | AgentSessionDetail>(session: T): T {
    const record = this.store.getLatestForSource(session.agentId, session.sourceSessionId);

    if (!record) return session;

    const now = Date.now();

    if (Date.parse(record.expiresAt) <= now) {
      this.store.delete(record);
      return session;
    }

    const hasTranscript = "transcript" in session;
    const turnState = hasTranscript
      ? deriveSourceAgentTurnState(session)
      : session.turnState;
    const nextRecord = this.reconcileRecord(record, turnState, hasTranscript);

    if (!nextRecord) return session;

    return {
      ...session,
      interruptLifecycle: toPublicLifecycle(nextRecord)
    };
  }

  getStateVersion(agentId: string, sourceSessionId: string) {
    const record = this.store.getLatestForSource(agentId, sourceSessionId);

    return record
      ? {
          confirmationEntryId: record.confirmationEntryId,
          confirmedAt: record.confirmedAt,
          phase: record.phase,
          requestedAt: record.requestedAt,
          terminalOutcome: record.terminalOutcome,
          turnFingerprint: record.turnFingerprint,
          updatedAt: record.updatedAt
        }
      : null;
  }

  private reconcileRecord(
    record: SourceTurnInterruptRecord,
    turnState: AgentSessionDetail["turnState"] | ReturnType<typeof deriveSourceAgentTurnState> | undefined,
    hasTranscript: boolean
  ) {
    const isExternalForceStopFallback = record.turnFingerprint.startsWith(
      EXTERNAL_FORCE_STOP_FALLBACK_PREFIX
    );

    if (turnState?.phase === "active") {
      if (
        isExternalForceStopFallback &&
        turnState.startedAt &&
        Date.parse(turnState.startedAt) > Date.parse(record.requestedAt)
      ) {
        this.store.delete(record);
        return null;
      }

      if (
        !isExternalForceStopFallback &&
        turnState.fingerprint &&
        turnState.fingerprint !== record.turnStartEntryId
      ) {
        this.store.delete(record);
        return null;
      }

      if (
        record.phase === "requested" &&
        Date.now() - Date.parse(record.requestedAt) >= REQUEST_CONFIRMATION_GRACE_MS
      ) {
        return this.upsertPhase(record, "unresolved", null, null);
      }

      return record;
    }

    if (
      (turnState?.phase === "completed" ||
        turnState?.phase === "failed" ||
        turnState?.phase === "interrupted") &&
      turnState.completedAt &&
      Date.parse(turnState.completedAt) >= Date.parse(record.turnStartedAt)
    ) {
      const terminalTurnStartFingerprint = hasTranscript && "turnStartFingerprint" in turnState
        ? turnState.turnStartFingerprint
        : null;
      if (terminalTurnStartFingerprint && terminalTurnStartFingerprint !== record.turnStartEntryId) {
        this.store.delete(record);
        return null;
      }

      // Summary payloads do not tell us which turn a terminal entry belongs to.
      // Wait for a transcript-backed refresh instead of confirming a newer turn.
      if (!hasTranscript) return record;

      return this.upsertPhase(
        record,
        "confirmed_source",
        "source_terminal",
        turnState.fingerprint,
        turnState.phase
      );
    }

    if (
      record.phase === "requested" &&
      Date.now() - Date.parse(record.requestedAt) >= REQUEST_CONFIRMATION_GRACE_MS
    ) {
      return this.upsertPhase(record, "unresolved", null, null);
    }

    return record;
  }

  private upsertPhase(
    record: SourceTurnInterruptRecord,
    phase: SourceTurnInterruptRecord["phase"],
    confirmationKind: string | null,
    confirmationEntryId: string | null,
    terminalOutcome: SourceTurnInterruptRecord["terminalOutcome"] = null
  ) {
    const now = new Date().toISOString();

    return this.store.upsert({
      ...record,
      phase,
      confirmationKind,
      confirmationEntryId,
      terminalOutcome,
      confirmedAt: phase === "requested" || phase === "unresolved" ? null : now,
      updatedAt: now,
      expiresAt: expiresAt(
        now,
        phase === "unresolved" ? UNRESOLVED_RETENTION_MS : REQUESTED_RETENTION_MS
      )
    });
  }
}
