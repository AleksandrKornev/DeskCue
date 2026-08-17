import type Database from "better-sqlite3";

import { SQLITE_MIGRATIONS } from "./index.ts";
import type { SqliteMigration } from "./types.ts";

export type SqliteMigrationTableState = {
  hasChecksumColumn: boolean;
  hasMigrationTable: boolean;
  needsMetadataUpgrade: boolean;
};

export function writeSqliteSchemaVersion(database: Database.Database, version: number) {
  database.prepare(`
    INSERT INTO metadata (key, value, updated_at)
    VALUES ('schema_version', ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(String(version), new Date().toISOString());
}

export function recordAppliedMigration(
  database: Database.Database,
  migration: SqliteMigration
) {
  database.prepare(`
    INSERT INTO schema_migrations (version, name, checksum, applied_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(version) DO UPDATE SET
      name = excluded.name,
      checksum = excluded.checksum,
      applied_at = excluded.applied_at
  `).run(migration.version, migration.name, migration.checksum, new Date().toISOString());
}

export function backfillAppliedMigrationChecksums(
  database: Database.Database,
  currentVersion: number,
  migrations = SQLITE_MIGRATIONS
) {
  const appliedMigrations = migrations.filter(
    (migration) => migration.version <= currentVersion
  );
  const readAppliedMigration = database.prepare(
    "SELECT checksum FROM schema_migrations WHERE version = ?"
  );

  for (const migration of appliedMigrations) {
    const row = readAppliedMigration.get(migration.version) as
      | {
          checksum: string | null;
        }
      | undefined;
    if (row?.checksum) {
      continue;
    }

    recordAppliedMigration(database, migration);
  }
}

function createMetadataTable(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function createMigrationTable(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT,
      applied_at TEXT NOT NULL
    );
  `);
}

function hasTable(database: Database.Database, tableName: string) {
  const row = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);

  return Boolean(row);
}

export function readSqliteSchemaVersion(database: Database.Database) {
  if (!hasTable(database, "metadata")) {
    return 0;
  }

  const row = database
    .prepare("SELECT value FROM metadata WHERE key = ?")
    .get("schema_version") as { value: string } | undefined;
  const version = row ? Number(row.value) : 0;

  return Number.isInteger(version) ? version : 0;
}

function hasColumn(database: Database.Database, tableName: string, columnName: string) {
  const rows = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string;
  }>;

  return rows.some((row) => row.name === columnName);
}

export function readMigrationTableState(database: Database.Database): SqliteMigrationTableState {
  const hasMigrationTable = hasTable(database, "schema_migrations");
  const hasChecksumColumn = hasMigrationTable && hasColumn(database, "schema_migrations", "checksum");

  return {
    hasMigrationTable,
    hasChecksumColumn,
    needsMetadataUpgrade: !hasMigrationTable || !hasChecksumColumn
  };
}

export function validateAppliedMigrationChecksums(
  database: Database.Database,
  currentVersion: number,
  migrations = SQLITE_MIGRATIONS
) {
  if (!hasTable(database, "schema_migrations")) {
    if (currentVersion === 0) {
      return;
    }

    throw new Error("DeskCue SQLite migration history is missing.");
  }

  if (!hasColumn(database, "schema_migrations", "checksum")) {
    throw new Error("DeskCue SQLite migration history is missing checksums.");
  }

  const readAppliedMigration = database.prepare(
    "SELECT checksum FROM schema_migrations WHERE version = ?"
  );
  const appliedMigrations = migrations.filter(
    (migration) => migration.version <= currentVersion
  );

  for (const migration of appliedMigrations) {
    const row = readAppliedMigration.get(migration.version) as
      | {
          checksum: string | null;
        }
      | undefined;
    if (!row) {
      throw new Error(`DeskCue SQLite migration ${migration.version} is missing from history.`);
    }

    if (
      row.checksum !== migration.checksum &&
      !migration.compatibleChecksums?.includes(row.checksum ?? "")
    ) {
      throw new Error(`DeskCue SQLite migration ${migration.version} checksum mismatch.`);
    }
  }
}

function ensureMigrationChecksumColumn(database: Database.Database) {
  if (!hasTable(database, "schema_migrations") || hasColumn(database, "schema_migrations", "checksum")) {
    return;
  }

  database.exec("ALTER TABLE schema_migrations ADD COLUMN checksum TEXT;");
}

export function prepareMigrationHistoryTables(database: Database.Database) {
  createMetadataTable(database);
  createMigrationTable(database);
  ensureMigrationChecksumColumn(database);
}
