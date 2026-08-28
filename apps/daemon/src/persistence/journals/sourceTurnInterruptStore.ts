import type Database from "better-sqlite3";

import { daemonConfig } from "#config/daemonConfig";

import {
  getProductionSqliteDatabaseContext,
  initializeSqliteDatabaseContext
} from "../connection/sqliteConnection.ts";
import type {
  SqliteDatabaseContext,
  SqliteDatabaseSource
} from "../connection/sqliteConnection.ts";

export type SourceTurnInterruptPhase =
  | "requested"
  | "confirmed_source"
  | "confirmed_process"
  | "confirmed_transport"
  | "unresolved";

export type SourceTurnInterruptRecord = {
  agentId: string;
  sourceSessionId: string;
  managedSessionId: string;
  turnStartEntryId: string;
  turnFingerprint: string;
  turnStartedAt: string;
  requestedAt: string;
  phase: SourceTurnInterruptPhase;
  confirmationKind: string | null;
  confirmationEntryId: string | null;
  terminalOutcome: "interrupted" | "completed" | "failed" | null;
  confirmedAt: string | null;
  updatedAt: string;
  expiresAt: string;
};

export type SourceTurnInterruptKey = Pick<
  SourceTurnInterruptRecord,
  "agentId" | "sourceSessionId" | "turnFingerprint"
>;

type SourceTurnInterruptRow = SourceTurnInterruptRecord;

export class SqliteSourceTurnInterruptStore {
  private readonly database: Database.Database;
  private readonly databaseContext: SqliteDatabaseContext;
  private readonly ownsDatabaseContext: boolean;
  private readonly getStatement: Database.Statement<
    [string, string, string],
    SourceTurnInterruptRow
  >;
  private readonly getLatestForSourceStatement: Database.Statement<
    [string, string],
    SourceTurnInterruptRow
  >;
  private readonly getLatestForManagedSessionStatement: Database.Statement<
    [string],
    SourceTurnInterruptRow
  >;
  private readonly upsertStatement: Database.Statement<SourceTurnInterruptRecord>;
  private readonly deleteStatement: Database.Statement<[string, string, string]>;
  private readonly deleteRequestedStatement: Database.Statement<
    [string, string, string, string, string]
  >;
  private readonly cleanupStatement: Database.Statement<[string]>;

  constructor(
    source: SqliteDatabaseSource = getProductionSqliteDatabaseContext(
      daemonConfig.databaseFilePath
    )
  ) {
    const resolved = initializeSqliteDatabaseContext(source);

    this.databaseContext = resolved.context;

    this.ownsDatabaseContext = resolved.ownsContext;
    this.database = resolved.context.database;

    this.getStatement = this.database.prepare(`
      SELECT
        agent_id AS agentId,
        source_session_id AS sourceSessionId,
        managed_session_id AS managedSessionId,
        turn_start_entry_id AS turnStartEntryId,
        turn_fingerprint AS turnFingerprint,
        turn_started_at AS turnStartedAt,
        requested_at AS requestedAt,
        phase,
        confirmation_kind AS confirmationKind,
        confirmation_entry_id AS confirmationEntryId,
        terminal_outcome AS terminalOutcome,
        confirmed_at AS confirmedAt,
        updated_at AS updatedAt,
        expires_at AS expiresAt
      FROM source_turn_interrupts
      WHERE agent_id = ?
        AND source_session_id = ?
        AND turn_fingerprint = ?
    `);
    this.getLatestForSourceStatement = this.database.prepare(`
      SELECT
        agent_id AS agentId,
        source_session_id AS sourceSessionId,
        managed_session_id AS managedSessionId,
        turn_start_entry_id AS turnStartEntryId,
        turn_fingerprint AS turnFingerprint,
        turn_started_at AS turnStartedAt,
        requested_at AS requestedAt,
        phase,
        confirmation_kind AS confirmationKind,
        confirmation_entry_id AS confirmationEntryId,
        terminal_outcome AS terminalOutcome,
        confirmed_at AS confirmedAt,
        updated_at AS updatedAt,
        expires_at AS expiresAt
      FROM source_turn_interrupts
      WHERE agent_id = ?
        AND source_session_id = ?
      ORDER BY requested_at DESC
      LIMIT 1
    `);
    this.getLatestForManagedSessionStatement = this.database.prepare(`
      SELECT
        agent_id AS agentId,
        source_session_id AS sourceSessionId,
        managed_session_id AS managedSessionId,
        turn_start_entry_id AS turnStartEntryId,
        turn_fingerprint AS turnFingerprint,
        turn_started_at AS turnStartedAt,
        requested_at AS requestedAt,
        phase,
        confirmation_kind AS confirmationKind,
        confirmation_entry_id AS confirmationEntryId,
        terminal_outcome AS terminalOutcome,
        confirmed_at AS confirmedAt,
        updated_at AS updatedAt,
        expires_at AS expiresAt
      FROM source_turn_interrupts
      WHERE managed_session_id = ?
      ORDER BY requested_at DESC
      LIMIT 1
    `);
    this.upsertStatement = this.database.prepare(`
      INSERT INTO source_turn_interrupts (
        agent_id,
        source_session_id,
        managed_session_id,
        turn_start_entry_id,
        turn_fingerprint,
        turn_started_at,
        requested_at,
        phase,
        confirmation_kind,
        confirmation_entry_id,
        terminal_outcome,
        confirmed_at,
        updated_at,
        expires_at
      ) VALUES (
        @agentId,
        @sourceSessionId,
        @managedSessionId,
        @turnStartEntryId,
        @turnFingerprint,
        @turnStartedAt,
        @requestedAt,
        @phase,
        @confirmationKind,
        @confirmationEntryId,
        @terminalOutcome,
        @confirmedAt,
        @updatedAt,
        @expiresAt
      )
      ON CONFLICT(agent_id, source_session_id, turn_fingerprint) DO UPDATE SET
        managed_session_id = excluded.managed_session_id,
        turn_start_entry_id = excluded.turn_start_entry_id,
        turn_started_at = excluded.turn_started_at,
        requested_at = excluded.requested_at,
        phase = excluded.phase,
        confirmation_kind = excluded.confirmation_kind,
        confirmation_entry_id = excluded.confirmation_entry_id,
        terminal_outcome = excluded.terminal_outcome,
        confirmed_at = excluded.confirmed_at,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at
    `);
    this.deleteStatement = this.database.prepare(`
      DELETE FROM source_turn_interrupts
      WHERE agent_id = ?
        AND source_session_id = ?
        AND turn_fingerprint = ?
    `);
    this.deleteRequestedStatement = this.database.prepare(`
      DELETE FROM source_turn_interrupts
      WHERE agent_id = ?
        AND source_session_id = ?
        AND turn_fingerprint = ?
        AND managed_session_id = ?
        AND requested_at = ?
        AND phase = 'requested'
    `);
    this.cleanupStatement = this.database.prepare(`
      DELETE FROM source_turn_interrupts
      WHERE expires_at <= ?
    `);
  }

  close() {
    if (this.ownsDatabaseContext) this.databaseContext.close();
  }

  get(key: SourceTurnInterruptKey) {
    return (
      this.getStatement.get(key.agentId, key.sourceSessionId, key.turnFingerprint) ?? null
    );
  }

  getLatestForSource(agentId: string, sourceSessionId: string) {
    return this.getLatestForSourceStatement.get(agentId, sourceSessionId) ?? null;
  }

  getLatestForManagedSession(managedSessionId: string) {
    return this.getLatestForManagedSessionStatement.get(managedSessionId) ?? null;
  }

  upsert(record: SourceTurnInterruptRecord) {
    this.upsertStatement.run(record);
    return record;
  }

  delete(key: SourceTurnInterruptKey) {
    return this.deleteStatement.run(
      key.agentId,
      key.sourceSessionId,
      key.turnFingerprint
    ).changes;
  }

  deleteRequested(record: SourceTurnInterruptRecord) {
    return this.deleteRequestedStatement.run(
      record.agentId,
      record.sourceSessionId,
      record.turnFingerprint,
      record.managedSessionId,
      record.requestedAt
    ).changes;
  }

  cleanup(now = new Date().toISOString()) {
    return this.cleanupStatement.run(now).changes;
  }
}
