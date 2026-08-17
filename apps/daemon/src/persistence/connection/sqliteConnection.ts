import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { migrateSqliteDatabase } from "../migrations/sqliteMigrations.ts";
import type { SqliteMigrationResult } from "../migrations/sqliteMigrations.ts";

export const DESKCUE_SQLITE_BUSY_TIMEOUT_MS = 5_000;

/**
 * Opens a DeskCue SQLite connection with the same concurrency and durability
 * policy for every repository. Schema ownership remains in sqliteMigrations.
 */
export function openDeskCueSqliteDatabase(databaseFilePath: string): Database.Database {
  mkdirSync(dirname(databaseFilePath), { recursive: true });
  const database = new Database(databaseFilePath);
  try {
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    database.pragma("synchronous = NORMAL");
    database.pragma(`busy_timeout = ${DESKCUE_SQLITE_BUSY_TIMEOUT_MS}`);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export type SqliteDatabaseSource = string | SqliteDatabaseContext;

export type ResolvedSqliteDatabaseContext = {
  context: SqliteDatabaseContext;
  ownsContext: boolean;
};

let productionContext: SqliteDatabaseContext | null = null;

/**
 * Owns one physical SQLite connection and the one-time schema initialization
 * performed on that connection. Repositories borrow the context in production;
 * standalone repositories created with a file path own a private context.
 */
export class SqliteDatabaseContext {
  readonly database: Database.Database;
  readonly databaseFilePath: string;
  private closed = false;
  private migrationResult: SqliteMigrationResult | null = null;

  constructor(databaseFilePath: string) {
    this.databaseFilePath = databaseFilePath;
    this.database = openDeskCueSqliteDatabase(databaseFilePath);
  }

  get isClosed() {
    return this.closed;
  }

  ensureMigrated() {
    if (this.closed) {
      throw new Error("DeskCue SQLite context is closed.");
    }
    this.migrationResult ??= migrateSqliteDatabase(
      this.database,
      this.databaseFilePath
    );
    return this.migrationResult;
  }

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.database.close();
    if (productionContext === this) {
      productionContext = null;
    }
  }
}

/** Returns the process-wide connection owner used by production repositories. */
export function getProductionSqliteDatabaseContext(databaseFilePath: string) {
  if (productionContext) {
    if (productionContext.databaseFilePath !== databaseFilePath) {
      throw new Error(
        `DeskCue production SQLite context already targets ${productionContext.databaseFilePath}.`
      );
    }
    if (productionContext.isClosed) {
      throw new Error("DeskCue production SQLite context is already closed.");
    }
    return productionContext;
  }

  productionContext = new SqliteDatabaseContext(databaseFilePath);
  return productionContext;
}

export function resolveSqliteDatabaseContext(
  source: SqliteDatabaseSource
): ResolvedSqliteDatabaseContext {
  if (typeof source === "string") {
    return {
      context: new SqliteDatabaseContext(source),
      ownsContext: true
    };
  }
  return {
    context: source,
    ownsContext: false
  };
}

export function initializeSqliteDatabaseContext(
  source: SqliteDatabaseSource
): ResolvedSqliteDatabaseContext {
  const resolved = resolveSqliteDatabaseContext(source);
  try {
    resolved.context.ensureMigrated();
    return resolved;
  } catch (error) {
    if (resolved.ownsContext) {
      resolved.context.close();
    }
    throw error;
  }
}
