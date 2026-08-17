import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

type CreatePreMigrationBackupOptions = {
  currentVersion: number;
  database: Database.Database;
  databaseFilePath?: string;
  targetVersion: number;
};

function isEmptyDatabase(database: Database.Database) {
  const row = database
    .prepare(`
      SELECT COUNT(*) AS count
      FROM sqlite_master
      WHERE type IN ('table', 'index', 'trigger', 'view')
        AND name NOT LIKE 'sqlite_%'
        AND name NOT IN ('metadata', 'schema_migrations')
    `)
    .get() as { count: number };

  return row.count === 0;
}

function formatBackupTimestamp(date: Date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function createPreMigrationBackup({
  currentVersion,
  database,
  databaseFilePath,
  targetVersion
}: CreatePreMigrationBackupOptions) {
  if (!databaseFilePath || !existsSync(databaseFilePath) || isEmptyDatabase(database)) {
    return null;
  }

  const backupPath = `${databaseFilePath}.backup-v${currentVersion}-to-v${targetVersion}-${formatBackupTimestamp(new Date())}-${randomUUID()}`;
  mkdirSync(dirname(backupPath), {
    recursive: true
  });
  // A plain file copy is not a valid snapshot while SQLite is in WAL mode:
  // recently committed rows can still live only in the WAL. VACUUM INTO asks
  // the active connection for a transactionally consistent standalone backup.
  database.prepare("VACUUM INTO ?").run(backupPath);

  return backupPath;
}
