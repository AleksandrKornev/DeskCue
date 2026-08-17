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

export type NotificationOutboxRecord = {
  attempt: number;
  createdAt: string;
  event: string;
  key: string;
  maxAttempts: number;
  nextRetryAt: string;
  payloadJson: string;
  provider: string;
};

type NotificationOutboxRow = {
  attempt: number;
  createdAt: string;
  event: string;
  key: string;
  maxAttempts: number;
  nextRetryAt: string;
  payloadJson: string;
  provider: string;
};

export class SqliteNotificationStateStore {
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

  loadStateJson() {
    const row = this.database.prepare(`
      SELECT json
      FROM notification_state
      WHERE id = 1
    `).get() as { json: string } | undefined;
    return row?.json ?? null;
  }

  saveStateJson(json: string) {
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO notification_state (id, json, updated_at)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        json = excluded.json,
        updated_at = excluded.updated_at
    `).run(json, now);
  }

  saveStateAndOutbox(json: string, records: NotificationOutboxRecord[]) {
    const saveState = this.database.prepare(`
      INSERT INTO notification_state (id, json, updated_at)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        json = excluded.json,
        updated_at = excluded.updated_at
    `);
    const upsertOutbox = this.database.prepare(`
      INSERT INTO notification_outbox (
        key,
        event,
        provider,
        payload_json,
        attempt,
        max_attempts,
        next_retry_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        event = excluded.event,
        provider = excluded.provider,
        payload_json = excluded.payload_json,
        attempt = excluded.attempt,
        max_attempts = excluded.max_attempts,
        next_retry_at = excluded.next_retry_at,
        updated_at = excluded.updated_at
    `);
    const now = new Date().toISOString();

    this.database.transaction(() => {
      saveState.run(json, now);
      for (const record of records) {
        upsertOutbox.run(
          record.key,
          record.event,
          record.provider,
          record.payloadJson,
          record.attempt,
          record.maxAttempts,
          record.nextRetryAt,
          record.createdAt,
          now
        );
      }
    })();
  }

  listOutbox(): NotificationOutboxRecord[] {
    return (this.database.prepare(`
      SELECT
        key,
        event,
        provider,
        payload_json AS payloadJson,
        attempt,
        max_attempts AS maxAttempts,
        next_retry_at AS nextRetryAt,
        created_at AS createdAt
      FROM notification_outbox
      ORDER BY next_retry_at ASC, key ASC
    `).all() as NotificationOutboxRow[]).map((row) => ({ ...row }));
  }

  upsertOutbox(record: NotificationOutboxRecord) {
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO notification_outbox (
        key,
        event,
        provider,
        payload_json,
        attempt,
        max_attempts,
        next_retry_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        event = excluded.event,
        provider = excluded.provider,
        payload_json = excluded.payload_json,
        attempt = excluded.attempt,
        max_attempts = excluded.max_attempts,
        next_retry_at = excluded.next_retry_at,
        updated_at = excluded.updated_at
    `).run(
      record.key,
      record.event,
      record.provider,
      record.payloadJson,
      record.attempt,
      record.maxAttempts,
      record.nextRetryAt,
      record.createdAt,
      now
    );
  }

  pruneOutbox({
    maxRecords,
    oldestCreatedAt
  }: {
    maxRecords: number;
    oldestCreatedAt: string;
  }) {
    const staleKeys = (this.database.prepare(`
      SELECT key
      FROM notification_outbox
      WHERE created_at < ?
    `).all(oldestCreatedAt) as Array<{ key: string }>).map((row) => row.key);
    const excessKeys = (this.database.prepare(`
      SELECT key
      FROM notification_outbox
      WHERE created_at >= ?
      ORDER BY created_at DESC, updated_at DESC, key DESC
      LIMIT -1 OFFSET ?
    `).all(oldestCreatedAt, Math.max(0, maxRecords)) as Array<{ key: string }>).map(
      (row) => row.key
    );
    const keys = [...new Set([...staleKeys, ...excessKeys])];
    if (keys.length === 0) {
      return [];
    }

    const deleteStatement = this.database.prepare(
      "DELETE FROM notification_outbox WHERE key = ?"
    );
    this.database.transaction(() => {
      for (const key of keys) {
        deleteStatement.run(key);
      }
    })();
    return keys;
  }

  deleteOutbox(key: string) {
    this.database.prepare("DELETE FROM notification_outbox WHERE key = ?").run(key);
  }

  close() {
    if (this.ownsDatabaseContext) {
      this.databaseContext.close();
    }
  }

}
