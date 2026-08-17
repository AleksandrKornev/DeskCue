import type Database from "better-sqlite3";

import { DESKCUE_SQLITE_SCHEMA_VERSION, SQLITE_MIGRATIONS } from "./index.ts";
import { createPreMigrationBackup } from "./sqliteMigrationBackup.ts";
import {
  backfillAppliedMigrationChecksums,
  prepareMigrationHistoryTables,
  readMigrationTableState,
  readSqliteSchemaVersion,
  recordAppliedMigration,
  validateAppliedMigrationChecksums,
  writeSqliteSchemaVersion
} from "./sqliteMigrationHistory.ts";
import {
  assertMigrationListIsValid,
  assertSupportedSchemaVersion
} from "./sqliteMigrationPolicy.ts";
import type { SqliteMigration } from "./types.ts";

export { DESKCUE_SQLITE_SCHEMA_VERSION };
export { readSqliteSchemaVersion } from "./sqliteMigrationHistory.ts";

export type SqliteMigrationResult = {
  backupPath: string | null;
  fromVersion: number;
  metadataUpgraded: boolean;
  toVersion: number;
};

type SqliteMigrationPlan = {
  migrations: SqliteMigration[];
  schemaVersion: number;
};

type MigrateSqliteDatabaseOptions = {
  migrationPlan?: SqliteMigrationPlan;
};

export class SqliteMigrationFailedError extends Error {
  readonly backupPath: string | null;
  readonly fromVersion: number;
  readonly toVersion: number;

  constructor({
    backupPath,
    cause,
    fromVersion,
    toVersion
  }: {
    backupPath: string | null;
    cause: unknown;
    fromVersion: number;
    toVersion: number;
  }) {
    super(`Failed to migrate DeskCue SQLite schema from ${fromVersion} to ${toVersion}.`);
    this.name = "SqliteMigrationFailedError";
    this.backupPath = backupPath;
    this.fromVersion = fromVersion;
    this.toVersion = toVersion;
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

const PRE_RELEASE_V2_SCHEMA_VERSION = 2;
const PRE_RELEASE_V2_MIGRATION_CHECKSUMS = [
  "sha256:c07edfe32b42cd3089ae63671e83c4bcc6fa2ab7b1b783ec4b320e11e5898932",
  "sha256:209e77627d433f0374a51c31d4a7843c397cc593088f719a3d850758ff177841"
] as const;
const PROMPT_DELIVERY_RECOVERY_COLUMNS = [
  { name: "id", notnull: 0, pk: 1, type: "TEXT" },
  { name: "session_id", notnull: 1, pk: 0, type: "TEXT" },
  { name: "adapter_id", notnull: 1, pk: 0, type: "TEXT" },
  { name: "source_session_id", notnull: 0, pk: 0, type: "TEXT" },
  { name: "prompt_text", notnull: 1, pk: 0, type: "TEXT" },
  { name: "phase", notnull: 1, pk: 0, type: "TEXT" },
  { name: "requested_at", notnull: 1, pk: 0, type: "TEXT" },
  { name: "dispatching_at", notnull: 0, pk: 0, type: "TEXT" },
  { name: "accepted_at", notnull: 0, pk: 0, type: "TEXT" },
  { name: "completed_at", notnull: 0, pk: 0, type: "TEXT" },
  { name: "updated_at", notnull: 1, pk: 0, type: "TEXT" }
] as const;

assertMigrationListIsValid(SQLITE_MIGRATIONS);

function isKnownPreReleaseV2Database(database: Database.Database) {
  const migrationTableState = readMigrationTableState(database);
  if (!migrationTableState.hasMigrationTable || !migrationTableState.hasChecksumColumn) {
    return false;
  }

  const migrationRows = database.prepare(`
    SELECT version, checksum
    FROM schema_migrations
    ORDER BY version ASC
  `).all() as Array<{ checksum: string | null; version: number }>;
  if (
    migrationRows.length !== PRE_RELEASE_V2_MIGRATION_CHECKSUMS.length ||
    migrationRows.some((row, index) =>
      row.version !== index + 1 ||
      row.checksum !== PRE_RELEASE_V2_MIGRATION_CHECKSUMS[index]
    )
  ) {
    return false;
  }

  const promptDeliveryColumns = database.prepare(
    "PRAGMA table_info(prompt_delivery_journal)"
  ).all() as Array<{
    name: string;
    notnull: 0 | 1;
    pk: 0 | 1;
    type: string;
  }>;
  return (
    promptDeliveryColumns.length === PROMPT_DELIVERY_RECOVERY_COLUMNS.length &&
    promptDeliveryColumns.every((column, index) => {
      const expected = PROMPT_DELIVERY_RECOVERY_COLUMNS[index];
      return Boolean(
        expected &&
        column.name === expected.name &&
        column.notnull === expected.notnull &&
        column.pk === expected.pk &&
        column.type.toUpperCase() === expected.type
      );
    })
  );
}

function consolidateKnownPreReleaseV2Database({
  database,
  databaseFilePath,
  migration
}: {
  database: Database.Database;
  databaseFilePath?: string;
  migration: SqliteMigration;
}): SqliteMigrationResult {
  const backupPath = createPreMigrationBackup({
    currentVersion: PRE_RELEASE_V2_SCHEMA_VERSION,
    database,
    databaseFilePath,
    targetVersion: migration.version
  });
  const run = database.transaction(() => {
    database.prepare("DELETE FROM schema_migrations WHERE version = ?")
      .run(PRE_RELEASE_V2_SCHEMA_VERSION);
    recordAppliedMigration(database, migration);
    writeSqliteSchemaVersion(database, migration.version);
  });

  try {
    run();
  } catch (error) {
    throw new SqliteMigrationFailedError({
      backupPath,
      cause: error,
      fromVersion: PRE_RELEASE_V2_SCHEMA_VERSION,
      toVersion: migration.version
    });
  }

  return {
    backupPath,
    fromVersion: PRE_RELEASE_V2_SCHEMA_VERSION,
    metadataUpgraded: false,
    toVersion: migration.version
  };
}

export function migrateSqliteDatabase(
  database: Database.Database,
  databaseFilePath?: string,
  options: MigrateSqliteDatabaseOptions = {}
): SqliteMigrationResult {
  const migrationPlan = options.migrationPlan ?? {
    migrations: SQLITE_MIGRATIONS,
    schemaVersion: DESKCUE_SQLITE_SCHEMA_VERSION
  };
  assertMigrationListIsValid(migrationPlan.migrations, migrationPlan.schemaVersion);

  const storedVersion = readSqliteSchemaVersion(database);
  if (
    options.migrationPlan === undefined &&
    storedVersion === PRE_RELEASE_V2_SCHEMA_VERSION &&
    migrationPlan.schemaVersion === 1 &&
    isKnownPreReleaseV2Database(database)
  ) {
    return consolidateKnownPreReleaseV2Database({
      database,
      databaseFilePath,
      migration: migrationPlan.migrations[0]
    });
  }
  assertSupportedSchemaVersion(storedVersion, migrationPlan.schemaVersion);

  const pendingMigrations = migrationPlan.migrations.filter(
    (migration) => migration.version > storedVersion
  );
  const migrationTableState = readMigrationTableState(database);
  const compatibleAppliedMigrations =
    migrationTableState.hasMigrationTable && migrationTableState.hasChecksumColumn
    ? migrationPlan.migrations.filter((migration) => {
        if (migration.version > storedVersion || !migration.compatibleChecksums?.length) {
          return false;
        }
        const row = database.prepare(
          "SELECT checksum FROM schema_migrations WHERE version = ?"
        ).get(migration.version) as { checksum: string | null } | undefined;
        return Boolean(
          row?.checksum &&
          row.checksum !== migration.checksum &&
          migration.compatibleChecksums.includes(row.checksum)
        );
      })
    : [];
  const appliedMigrationsToReconcile = migrationTableState.needsMetadataUpgrade
    ? migrationPlan.migrations.filter((migration) => migration.version <= storedVersion)
    : compatibleAppliedMigrations;

  if (
    pendingMigrations.length === 0 &&
    appliedMigrationsToReconcile.length === 0 &&
    !migrationTableState.needsMetadataUpgrade
  ) {
    validateAppliedMigrationChecksums(
      database,
      storedVersion,
      migrationPlan.migrations
    );
    return {
      backupPath: null,
      fromVersion: storedVersion,
      metadataUpgraded: false,
      toVersion: storedVersion
    };
  }

  const backupPath = createPreMigrationBackup({
    currentVersion: storedVersion,
    database,
    databaseFilePath,
    targetVersion: migrationPlan.schemaVersion
  });
  const run = database.transaction(() => {
    prepareMigrationHistoryTables(database);
    backfillAppliedMigrationChecksums(
      database,
      storedVersion,
      migrationPlan.migrations
    );
    validateAppliedMigrationChecksums(
      database,
      storedVersion,
      migrationPlan.migrations
    );

    for (const migration of appliedMigrationsToReconcile) {
      migration.apply(database);
      recordAppliedMigration(database, migration);
    }

    for (const migration of pendingMigrations) {
      migration.apply(database);
      recordAppliedMigration(database, migration);
      writeSqliteSchemaVersion(database, migration.version);
    }
  });

  try {
    run();
  } catch (error) {
    throw new SqliteMigrationFailedError({
      backupPath,
      cause: error,
      fromVersion: storedVersion,
      toVersion: migrationPlan.schemaVersion
    });
  }

  return {
    backupPath,
    fromVersion: storedVersion,
    metadataUpgraded: migrationTableState.needsMetadataUpgrade,
    toVersion: migrationPlan.schemaVersion
  };
}
