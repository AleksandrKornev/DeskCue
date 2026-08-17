import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

import type { SessionDetail } from "@deskcue/protocol";
import { daemonConfig } from "#config/daemonConfig";

import {
  getProductionSqliteDatabaseContext,
  initializeSqliteDatabaseContext
} from "../connection/sqliteConnection.ts";
import type {
  SqliteDatabaseContext,
  SqliteDatabaseSource
} from "../connection/sqliteConnection.ts";

export type PromptDeliveryJournalPhase =
  | "prepared"
  | "dispatching"
  | "accepted"
  | "completed"
  | "not_sent"
  | "interrupted"
  | "observed"
  | "outcome_unknown";

export type PromptDeliveryJournalRecord = {
  adapterId: string;
  id: string;
  phase: PromptDeliveryJournalPhase;
  promptText: string;
  requestedAt: string;
  sessionId: string;
  sourceSessionId: string | null;
};

export type PromptDeliveryRecoveryRecord = PromptDeliveryJournalRecord & {
  previousPhase: Extract<
    PromptDeliveryJournalPhase,
    "prepared" | "dispatching" | "accepted" | "not_sent" | "outcome_unknown"
  >;
  recoveryDisposition: "definitely_not_sent" | "outcome_unknown";
};

type PromptDeliveryJournalRow = PromptDeliveryJournalRecord;

type RecoverablePromptDeliveryJournalRow = Omit<
  PromptDeliveryJournalRow,
  "phase"
> & {
  phase: PromptDeliveryRecoveryRecord["previousPhase"];
};

const RECOVERABLE_PHASES = [
  "prepared",
  "dispatching",
  "accepted",
  "not_sent",
  "outcome_unknown"
] as const;

export class SqlitePromptDeliveryJournalStore {
  private readonly database: Database.Database;
  private readonly databaseContext: SqliteDatabaseContext;
  private readonly ownsDatabaseContext: boolean;

  constructor(
    source: SqliteDatabaseSource = getProductionSqliteDatabaseContext(
      daemonConfig.databaseFilePath
    )
  ) {
    const resolved = initializeSqliteDatabaseContext(source);
    this.databaseContext = resolved.context;
    this.ownsDatabaseContext = resolved.ownsContext;
    this.database = resolved.context.database;
  }

  prepare(
    session: Pick<SessionDetail, "adapterId" | "id" | "sourceSessionId">,
    promptText: string,
    requestedAt = new Date().toISOString()
  ) {
    const id = randomUUID();
    this.database.prepare(`
      INSERT INTO prompt_delivery_journal (
        id,
        session_id,
        adapter_id,
        source_session_id,
        prompt_text,
        phase,
        requested_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, 'prepared', ?, ?)
    `).run(
      id,
      session.id,
      session.adapterId,
      session.sourceSessionId ?? null,
      promptText,
      requestedAt,
      requestedAt
    );
    return id;
  }

  markDispatching(deliveryId: string) {
    return this.transitionById(deliveryId, "prepared", "dispatching", "dispatching_at");
  }

  markDispatchingBySession(sessionId: string) {
    return this.transitionLatestBySession(
      sessionId,
      "prepared",
      "dispatching",
      "dispatching_at"
    );
  }

  markAccepted(deliveryId: string) {
    return this.transitionById(deliveryId, "dispatching", "accepted", "accepted_at");
  }

  markAcceptedBySession(sessionId: string) {
    return this.transitionLatestBySession(
      sessionId,
      "dispatching",
      "accepted",
      "accepted_at"
    );
  }

  markObservedBySession(sessionId: string) {
    const now = new Date().toISOString();
    const result = this.database.prepare(`
      UPDATE prompt_delivery_journal
      SET phase = 'observed',
        completed_at = COALESCE(completed_at, ?),
        updated_at = ?
      WHERE session_id = ? AND phase IN ('not_sent', 'outcome_unknown')
    `).run(now, now, sessionId);
    return result.changes > 0;
  }

  markOutcomeUnknown(deliveryId: string) {
    return this.transitionById(
      deliveryId,
      ["dispatching", "accepted"],
      "outcome_unknown"
    );
  }

  markOutcomeUnknownBySession(sessionId: string) {
    return this.transitionLatestBySession(
      sessionId,
      ["dispatching", "accepted"],
      "outcome_unknown"
    );
  }

  markActiveOutcomeUnknownForShutdown() {
    const now = new Date().toISOString();
    return this.database.prepare(`
      UPDATE prompt_delivery_journal
      SET phase = 'outcome_unknown', updated_at = ?
      WHERE phase IN ('dispatching', 'accepted')
    `).run(now).changes;
  }

  markNotSent(deliveryId: string) {
    return this.transitionById(deliveryId, "prepared", "not_sent", "completed_at");
  }

  markNotSentAfterSynchronousSpawnFailure(deliveryId: string) {
    return this.transitionById(
      deliveryId,
      ["prepared", "dispatching"],
      "not_sent",
      "completed_at"
    );
  }

  markNotSentBySession(sessionId: string) {
    return this.transitionLatestBySession(
      sessionId,
      "prepared",
      "not_sent",
      "completed_at"
    );
  }

  markCompleted(sessionId: string) {
    this.markTerminalBySession(sessionId, "completed");
  }

  markInterrupted(sessionId: string) {
    this.markTerminalBySession(sessionId, "interrupted");
  }

  recoverActiveAfterRestart(): PromptDeliveryRecoveryRecord[] {
    return this.database.transaction(() => {
      const recoverable = this.listRecoverable();
      if (recoverable.length === 0) {
        return [];
      }

      const now = new Date().toISOString();
      this.database.prepare(`
        UPDATE prompt_delivery_journal
        SET phase = 'not_sent', completed_at = ?, updated_at = ?
        WHERE phase = 'prepared'
      `).run(now, now);
      this.database.prepare(`
        UPDATE prompt_delivery_journal
        SET phase = 'outcome_unknown', updated_at = ?
        WHERE phase IN ('dispatching', 'accepted')
      `).run(now);

      return recoverable.map((record): PromptDeliveryRecoveryRecord => {
        const definitelyNotSent = record.phase === "prepared" || record.phase === "not_sent";
        return {
          ...record,
          phase: definitelyNotSent ? "not_sent" : "outcome_unknown",
          previousPhase: record.phase,
          recoveryDisposition: definitelyNotSent
            ? "definitely_not_sent"
            : "outcome_unknown"
        };
      });
    })();
  }

  close() {
    if (this.ownsDatabaseContext) {
      this.databaseContext.close();
    }
  }

  private listRecoverable(): RecoverablePromptDeliveryJournalRow[] {
    return this.database.prepare(`
      SELECT
        id,
        session_id AS sessionId,
        adapter_id AS adapterId,
        source_session_id AS sourceSessionId,
        prompt_text AS promptText,
        phase,
        requested_at AS requestedAt
      FROM prompt_delivery_journal
      WHERE phase IN (${RECOVERABLE_PHASES.map(() => "?").join(", ")})
      ORDER BY requested_at ASC
    `).all(...RECOVERABLE_PHASES) as RecoverablePromptDeliveryJournalRow[];
  }

  private markTerminalBySession(
    sessionId: string,
    phase: Extract<PromptDeliveryJournalPhase, "completed" | "interrupted">
  ) {
    const now = new Date().toISOString();
    this.database.prepare(`
      UPDATE prompt_delivery_journal
      SET phase = ?, completed_at = ?, updated_at = ?
      WHERE session_id = ?
        AND phase IN (
          'prepared',
          'dispatching',
          'accepted',
          'not_sent',
          'outcome_unknown'
        )
    `).run(phase, now, now, sessionId);
  }

  private transitionById(
    deliveryId: string,
    from: PromptDeliveryJournalPhase | readonly PromptDeliveryJournalPhase[],
    to: PromptDeliveryJournalPhase,
    timestampColumn?: "accepted_at" | "completed_at" | "dispatching_at"
  ) {
    const now = new Date().toISOString();
    const fromPhases = typeof from === "string" ? [from] : from;
    const timestampAssignment = timestampColumn
      ? `, ${timestampColumn} = COALESCE(${timestampColumn}, ?)`
      : "";
    const parameters = timestampColumn
      ? [to, now, now, deliveryId, ...fromPhases]
      : [to, now, deliveryId, ...fromPhases];
    const result = this.database.prepare(`
      UPDATE prompt_delivery_journal
      SET phase = ?, updated_at = ?${timestampAssignment}
      WHERE id = ? AND phase IN (${fromPhases.map(() => "?").join(", ")})
    `).run(...parameters);
    return result.changes === 1;
  }

  private transitionLatestBySession(
    sessionId: string,
    from: PromptDeliveryJournalPhase | readonly PromptDeliveryJournalPhase[],
    to: PromptDeliveryJournalPhase,
    timestampColumn?: "accepted_at" | "completed_at" | "dispatching_at"
  ) {
    const now = new Date().toISOString();
    const fromPhases = typeof from === "string" ? [from] : from;
    const timestampAssignment = timestampColumn
      ? `, ${timestampColumn} = COALESCE(${timestampColumn}, ?)`
      : "";
    const parameters = timestampColumn
      ? [to, now, now, sessionId, ...fromPhases]
      : [to, now, sessionId, ...fromPhases];
    const result = this.database.prepare(`
      UPDATE prompt_delivery_journal
      SET phase = ?, updated_at = ?${timestampAssignment}
      WHERE id = (
        SELECT id
        FROM prompt_delivery_journal
        WHERE session_id = ? AND phase IN (${fromPhases.map(() => "?").join(", ")})
        ORDER BY requested_at DESC
        LIMIT 1
      )
    `).run(...parameters);
    return result.changes === 1;
  }
}
