import type {
  AgentSessionDetail,
  AgentSessionSummary,
  AgentSessionInterruptLifecycle,
  SessionDetail
} from "@deskcue/protocol";
import { deriveSourceAgentTurnState } from "#agents/sourceAgentTurnState";
import { SqliteSourceTurnInterruptStore } from "#persistence/journals/sourceTurnInterruptStore";
import type { SourceTurnInterruptRecord } from "#persistence/journals/sourceTurnInterruptStore";

export type SourceTurnInterruptTarget = {
  fingerprint: string;
  startedAt: string;
  userEntryId?: string;
};

const REQUEST_CONFIRMATION_GRACE_MS = 20_000;
const REQUESTED_RETENTION_MS = 24 * 60 * 60 * 1000;
const UNRESOLVED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const EXTERNAL_FORCE_STOP_FALLBACK_PREFIX = "external-force-stop:";

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

export class SourceTurnInterruptLifecycle {
  constructor(private readonly store: SqliteSourceTurnInterruptStore) {}

  close() {
    this.store.close();
  }

  request(session: SessionDetail, target: SourceTurnInterruptTarget) {
    if (!session.sourceSessionId) {
      return null;
    }

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

  decorate<T extends AgentSessionSummary | AgentSessionDetail>(session: T): T {
    const record = this.store.getLatestForSource(session.agentId, session.sourceSessionId);
    if (!record) {
      return session;
    }

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
    if (!nextRecord) {
      return session;
    }

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
      if (!hasTranscript) {
        return record;
      }

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
