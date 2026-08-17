import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { DESKCUE_SQLITE_SCHEMA_VERSION, SQLITE_MIGRATIONS } from "./index.ts";
import {
  migrateSqliteDatabase,
  readSqliteSchemaVersion,
  SqliteMigrationFailedError
} from "./sqliteMigrations.ts";
import type { SqliteMigration } from "./types.ts";

function hasTable(database: Database.Database, tableName: string) {
  const row = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);

  return Boolean(row);
}

function hasIndex(database: Database.Database, indexName: string) {
  const row = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(indexName);
  return Boolean(row);
}

function getColumnNames(database: Database.Database, tableName: string) {
  const rows = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function hasColumn(database: Database.Database, tableName: string, columnName: string) {
  return getColumnNames(database, tableName).includes(columnName);
}

function readAppliedMigrationChecksum(database: Database.Database, version: number) {
  const row = database
    .prepare("SELECT checksum FROM schema_migrations WHERE version = ?")
    .get(version) as { checksum: string };

  return row.checksum;
}

function readWorkspaceJsonById(database: Database.Database, workspaceId: string) {
  const row = database
    .prepare("SELECT json FROM workspaces WHERE id = ?")
    .get(workspaceId) as { json: string };

  return row.json;
}

function readWorkspaceJson(database: Database.Database) {
  return readWorkspaceJsonById(database, "workspace-fixture");
}

function readSqliteFixture(fileName: string) {
  return readFileSync(
    resolve(import.meta.dirname, "fixtures", "sqlite", fileName),
    "utf8"
  );
}

function readAppliedMigrationCount(database: Database.Database) {
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
    .get() as { count: number };

  return row.count;
}

test("migrates an empty SQLite database to the current schema without backup", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-migrations-"));
  const databasePath = join(tempDir, "state.sqlite");
  const database = new Database(databasePath);

  try {
    const result = migrateSqliteDatabase(database, databasePath);

    assert.equal(result.backupPath, null);
    assert.equal(result.fromVersion, 0);
    assert.equal(result.metadataUpgraded, true);
    assert.equal(DESKCUE_SQLITE_SCHEMA_VERSION, 1);
    assert.equal(result.toVersion, DESKCUE_SQLITE_SCHEMA_VERSION);
    assert.equal(readSqliteSchemaVersion(database), DESKCUE_SQLITE_SCHEMA_VERSION);
    assert.equal(hasTable(database, "workspaces"), true);
    assert.equal(hasTable(database, "sessions"), true);
    assert.equal(hasTable(database, "access_devices"), true);
    assert.equal(hasTable(database, "access_recovery_codes"), true);
    assert.equal(hasTable(database, "agent_session_reviews"), true);
    assert.equal(hasTable(database, "source_turn_interrupts"), true);
    assert.equal(hasTable(database, "notification_state"), true);
    assert.equal(hasTable(database, "notification_outbox"), true);
    assert.equal(hasTable(database, "prompt_delivery_journal"), true);
    assert.equal(hasColumn(database, "prompt_delivery_journal", "dispatching_at"), true);
    assert.equal(hasColumn(database, "prompt_delivery_journal", "accepted_at"), true);
    assert.equal(hasColumn(database, "prompt_delivery_journal", "transport_started_at"), false);
    assert.equal(hasTable(database, "cloud_installation_identity"), true);
    assert.equal(hasTable(database, "cloud_connector_profiles"), true);
    assert.equal(hasTable(database, "cloud_enrollment_attempt"), true);
    assert.equal(hasTable(database, "cloud_connector_capabilities"), true);
    assert.equal(hasTable(database, "cloud_data_grants"), true);
    assert.equal(hasTable(database, "cloud_transfer_jobs"), true);
    assert.equal(hasTable(database, "cloud_sync_cursors"), true);
    assert.equal(hasTable(database, "cloud_sync_outbox"), true);
    assert.equal(hasTable(database, "cloud_inbound_receipts"), true);
    assert.equal(hasTable(database, "schema_migrations"), true);
    assert.equal(readAppliedMigrationCount(database), DESKCUE_SQLITE_SCHEMA_VERSION);
  } finally {
    database.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("keeps a current SQLite database unchanged without creating backup", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-migrations-"));
  const databasePath = join(tempDir, "state.sqlite");
  const database = new Database(databasePath);

  try {
    migrateSqliteDatabase(database, databasePath);
    const result = migrateSqliteDatabase(database, databasePath);

    assert.equal(result.backupPath, null);
    assert.equal(result.fromVersion, DESKCUE_SQLITE_SCHEMA_VERSION);
    assert.equal(result.metadataUpgraded, false);
    assert.equal(result.toVersion, DESKCUE_SQLITE_SCHEMA_VERSION);
    assert.equal(readAppliedMigrationCount(database), DESKCUE_SQLITE_SCHEMA_VERSION);
  } finally {
    database.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("reconciles the exact local pre-release v1 prompt journal without losing data", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-migrations-"));
  const databasePath = join(tempDir, "state.sqlite");
  const database = new Database(databasePath);

  try {
    migrateSqliteDatabase(database, databasePath);
    database.exec(`
      ALTER TABLE prompt_delivery_journal RENAME TO prompt_delivery_journal_current;

      CREATE TABLE prompt_delivery_journal (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        adapter_id TEXT NOT NULL,
        source_session_id TEXT,
        prompt_text TEXT NOT NULL,
        phase TEXT NOT NULL CHECK (
          phase IN ('prepared', 'transport_started', 'completed', 'interrupted')
        ),
        requested_at TEXT NOT NULL,
        transport_started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      );

      DROP TABLE prompt_delivery_journal_current;

      CREATE INDEX idx_prompt_delivery_journal_session
        ON prompt_delivery_journal(session_id, requested_at DESC);
      CREATE INDEX idx_prompt_delivery_journal_active
        ON prompt_delivery_journal(phase, updated_at);
    `);
    database.prepare(`
      INSERT INTO prompt_delivery_journal (
        id, session_id, adapter_id, source_session_id, prompt_text, phase,
        requested_at, transport_started_at, completed_at, updated_at
      ) VALUES (?, ?, 'codex', 'source-1', 'private prompt', 'transport_started', ?, ?, NULL, ?)
    `).run(
      "transport-started-1",
      "session-1",
      "2026-08-11T10:00:00.000Z",
      "2026-08-11T10:00:01.000Z",
      "2026-08-11T10:00:01.000Z"
    );
    database.prepare(`
      UPDATE schema_migrations
      SET checksum = ?
      WHERE version = 1
    `).run("sha256:c07edfe32b42cd3089ae63671e83c4bcc6fa2ab7b1b783ec4b320e11e5898932");

    const result = migrateSqliteDatabase(database, databasePath);

    assert.equal(result.fromVersion, 1);
    assert.equal(result.toVersion, 1);
    assert.ok(result.backupPath);
    assert.equal(readAppliedMigrationChecksum(database, 1), SQLITE_MIGRATIONS[0]!.checksum);
    assert.equal(hasColumn(database, "prompt_delivery_journal", "dispatching_at"), true);
    assert.equal(hasColumn(database, "prompt_delivery_journal", "accepted_at"), true);
    assert.equal(hasColumn(database, "prompt_delivery_journal", "transport_started_at"), false);
    assert.deepEqual(
      database.prepare(`
        SELECT id, phase, prompt_text AS promptText,
          dispatching_at AS dispatchingAt, accepted_at AS acceptedAt
        FROM prompt_delivery_journal WHERE id = ?
      `).get("transport-started-1"),
      {
        acceptedAt: null,
        dispatchingAt: "2026-08-11T10:00:01.000Z",
        id: "transport-started-1",
        phase: "dispatching",
        promptText: "private prompt"
      }
    );
  } finally {
    database.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("rejects a v1 checksum reconciliation when the prompt journal shape is not exact", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-migrations-"));
  const databasePath = join(tempDir, "state.sqlite");
  const database = new Database(databasePath);

  try {
    migrateSqliteDatabase(database, databasePath);
    database.exec("ALTER TABLE prompt_delivery_journal ADD COLUMN unexpected TEXT;");
    database.prepare(`
      UPDATE schema_migrations
      SET checksum = ?
      WHERE version = 1
    `).run("sha256:c07edfe32b42cd3089ae63671e83c4bcc6fa2ab7b1b783ec4b320e11e5898932");

    assert.throws(
      () => migrateSqliteDatabase(database, databasePath),
      (error) => {
        assert.equal(error instanceof SqliteMigrationFailedError, true);
        assert.match(
          String((error as SqliteMigrationFailedError).cause),
          /unsupported pre-release shape/
        );
        return true;
      }
    );
    assert.equal(
      readAppliedMigrationChecksum(database, 1),
      "sha256:c07edfe32b42cd3089ae63671e83c4bcc6fa2ab7b1b783ec4b320e11e5898932"
    );
    assert.equal(hasColumn(database, "prompt_delivery_journal", "unexpected"), true);
  } finally {
    database.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("consolidates the exact pre-release v2 history to v1 without losing recovery state", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-migrations-"));
  const databasePath = join(tempDir, "state.sqlite");
  const database = new Database(databasePath);

  try {
    migrateSqliteDatabase(database, databasePath);
    database.prepare(`
      INSERT INTO prompt_delivery_journal (
        id, session_id, adapter_id, source_session_id, prompt_text, phase,
        requested_at, dispatching_at, accepted_at, completed_at, updated_at
      ) VALUES (?, ?, 'codex', 'source-1', 'private prompt', 'accepted', ?, ?, ?, NULL, ?)
    `).run(
      "accepted-1",
      "session-1",
      "2026-08-11T10:00:00.000Z",
      "2026-08-11T10:00:01.000Z",
      "2026-08-11T10:00:02.000Z",
      "2026-08-11T10:00:02.000Z"
    );
    database.prepare(`
      UPDATE schema_migrations
      SET checksum = ?
      WHERE version = 1
    `).run("sha256:c07edfe32b42cd3089ae63671e83c4bcc6fa2ab7b1b783ec4b320e11e5898932");
    database.prepare(`
      INSERT INTO schema_migrations (version, name, checksum, applied_at)
      VALUES (2, ?, ?, ?)
    `).run(
      "prompt delivery recovery state machine",
      "sha256:209e77627d433f0374a51c31d4a7843c397cc593088f719a3d850758ff177841",
      "2026-08-11T10:00:02.000Z"
    );
    database.prepare(`
      UPDATE metadata
      SET value = '2'
      WHERE key = 'schema_version'
    `).run();

    const result = migrateSqliteDatabase(database, databasePath);

    assert.equal(result.fromVersion, 2);
    assert.equal(result.toVersion, 1);
    assert.ok(result.backupPath);
    assert.equal(readSqliteSchemaVersion(database), 1);
    assert.equal(readAppliedMigrationCount(database), 1);
    assert.equal(
      readAppliedMigrationChecksum(database, 1),
      SQLITE_MIGRATIONS[0]!.checksum
    );
    assert.equal(hasColumn(database, "prompt_delivery_journal", "dispatching_at"), true);
    assert.equal(hasColumn(database, "prompt_delivery_journal", "accepted_at"), true);
    assert.equal(hasColumn(database, "prompt_delivery_journal", "transport_started_at"), false);
    assert.deepEqual(
      database.prepare(`
        SELECT id, phase, prompt_text AS promptText,
          dispatching_at AS dispatchingAt, accepted_at AS acceptedAt
        FROM prompt_delivery_journal WHERE id = ?
      `).get("accepted-1"),
      {
        acceptedAt: "2026-08-11T10:00:02.000Z",
        dispatchingAt: "2026-08-11T10:00:01.000Z",
        id: "accepted-1",
        phase: "accepted",
        promptText: "private prompt"
      }
    );
    assert.equal(hasIndex(database, "idx_prompt_delivery_journal_session"), true);
    assert.equal(hasIndex(database, "idx_prompt_delivery_journal_active"), true);
  } finally {
    database.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("rejects a pre-release v2 history when the recovery table shape was changed", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-migrations-"));
  const databasePath = join(tempDir, "state.sqlite");
  const database = new Database(databasePath);

  try {
    migrateSqliteDatabase(database, databasePath);
    database.prepare(`
      UPDATE schema_migrations
      SET checksum = ?
      WHERE version = 1
    `).run("sha256:c07edfe32b42cd3089ae63671e83c4bcc6fa2ab7b1b783ec4b320e11e5898932");
    database.prepare(`
      INSERT INTO schema_migrations (version, name, checksum, applied_at)
      VALUES (2, ?, ?, ?)
    `).run(
      "prompt delivery recovery state machine",
      "sha256:209e77627d433f0374a51c31d4a7843c397cc593088f719a3d850758ff177841",
      "2026-08-11T10:00:02.000Z"
    );
    database.prepare(`
      UPDATE metadata
      SET value = '2'
      WHERE key = 'schema_version'
    `).run();
    database.exec("ALTER TABLE prompt_delivery_journal ADD COLUMN unexpected TEXT;");

    assert.throws(
      () => migrateSqliteDatabase(database, databasePath),
      /Unsupported DeskCue SQLite schema version 2/
    );
    assert.equal(readSqliteSchemaVersion(database), 2);
    assert.equal(readAppliedMigrationCount(database), 2);
  } finally {
    database.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("cloud connector schema stores credential references and keeps heavy payloads out of the outbox", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-migrations-"));
  const databasePath = join(tempDir, "state.sqlite");
  const database = new Database(databasePath);

  try {
    migrateSqliteDatabase(database, databasePath);

    assert.deepEqual(
      getColumnNames(database, "cloud_installation_identity").filter((name) =>
        /token|secret|private_key/i.test(name)
      ),
      []
    );
    assert.equal(hasColumn(database, "cloud_installation_identity", "credential_ref"), true);

    database.prepare(`
      INSERT INTO cloud_installation_identity (
        id, installation_id, public_key, key_algorithm, credential_ref, created_at, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?)
    `).run(
      "installation-test",
      "public-key-test",
      "Ed25519",
      "credential-store://deskcue/cloud/installation-test",
      "2026-08-07T00:00:00.000Z",
      "2026-08-07T00:00:00.000Z"
    );
    database.prepare(`
      INSERT INTO cloud_connector_profiles (
        id, cloud_origin, display_name, enabled, state, created_at, updated_at
      ) VALUES (?, ?, ?, 1, 'disconnected', ?, ?)
    `).run(
      "profile-test",
      "https://cloud.example.test",
      "Test Cloud",
      "2026-08-07T00:00:00.000Z",
      "2026-08-07T00:00:00.000Z"
    );

    const insertOutbox = database.prepare(`
      INSERT INTO cloud_sync_outbox (
        id, profile_id, stream, sequence, event_type, payload_kind, payload_json, payload_bytes,
        device_id, workspace_id, session_id,
        max_attempts, next_attempt_at, expires_at, created_at, updated_at
      ) VALUES (?, 'profile-test', 'sessions', ?, ?, ?, '{}', 2, ?, ?, ?, 4, ?, ?, ?, ?)
    `);

    assert.throws(() => insertOutbox.run(
      "outbox-heavy-payload",
      1,
      "session.transcript",
      "transcript",
      "device-test",
      "workspace-test",
      "session-test",
      "2026-08-07T00:00:00.000Z",
      "2026-08-14T00:00:00.000Z",
      "2026-08-07T00:00:00.000Z",
      "2026-08-07T00:00:00.000Z"
    ), /CHECK constraint failed/);

    insertOutbox.run(
      "outbox-metadata",
      1,
      "session.summary",
      "metadata",
      "device-test",
      "workspace-test",
      null,
      "2026-08-07T00:00:00.000Z",
      "2026-08-14T00:00:00.000Z",
      "2026-08-07T00:00:00.000Z",
      "2026-08-07T00:00:00.000Z"
    );
    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM cloud_sync_outbox").get() as { count: number }).count,
      1
    );
  } finally {
    database.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("rejects SQLite databases from future schema versions before migration", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-migrations-"));
  const databasePath = join(tempDir, "state.sqlite");
  const database = new Database(databasePath);

  try {
    database.exec(`
      CREATE TABLE metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    database.prepare(`
      INSERT INTO metadata (key, value, updated_at)
      VALUES ('schema_version', ?, ?)
    `).run(String(DESKCUE_SQLITE_SCHEMA_VERSION + 1), new Date().toISOString());

    assert.throws(
      () => migrateSqliteDatabase(database, databasePath),
      /Unsupported DeskCue SQLite schema version/
    );
    assert.equal(hasTable(database, "schema_migrations"), false);
    assert.equal(hasTable(database, "workspaces"), false);
  } finally {
    database.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("creates a pre-migration backup for non-empty legacy databases", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-migrations-"));
  const databasePath = join(tempDir, "state.sqlite");
  const database = new Database(databasePath);

  try {
    database.pragma("journal_mode = WAL");
    database.exec(`
      CREATE TABLE legacy_state (
        id TEXT PRIMARY KEY
      );
    `);
    database.prepare("INSERT INTO legacy_state (id) VALUES (?)").run("legacy-row");

    const result = migrateSqliteDatabase(database, databasePath);

    assert.ok(result.backupPath);
    assert.equal(existsSync(result.backupPath), true);
    assert.equal(result.fromVersion, 0);
    assert.equal(result.metadataUpgraded, true);
    assert.equal(result.toVersion, DESKCUE_SQLITE_SCHEMA_VERSION);

    const backup = new Database(result.backupPath!);
    try {
      assert.equal(hasTable(backup, "legacy_state"), true);
      assert.equal(hasTable(backup, "metadata"), false);
      assert.equal(hasTable(backup, "schema_migrations"), false);
      assert.equal(hasTable(backup, "workspaces"), false);
    } finally {
      backup.close();
    }
  } finally {
    database.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("backfills migration checksums for current databases with legacy migration history", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-migrations-"));
  const databasePath = join(tempDir, "state.sqlite");
  const database = new Database(databasePath);

  try {
    database.exec(`
      CREATE TABLE metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        adapter_id TEXT NOT NULL,
        source_session_id TEXT,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        last_activity_at TEXT NOT NULL,
        json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE access_devices (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        user_agent TEXT,
        created_at TEXT NOT NULL,
        last_seen_at TEXT,
        last_ip TEXT,
        revoked_at TEXT
      );
      CREATE INDEX idx_access_devices_token_hash ON access_devices(token_hash);
      CREATE INDEX idx_access_devices_revoked_at ON access_devices(revoked_at);
    `);
    database.prepare(`
      INSERT INTO metadata (key, value, updated_at)
      VALUES ('schema_version', ?, ?)
    `).run(String(DESKCUE_SQLITE_SCHEMA_VERSION), new Date().toISOString());
    database.prepare(`
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (?, ?, ?)
    `).run(1, "initial workspace, session and access device tables", new Date().toISOString());

    const result = migrateSqliteDatabase(database, databasePath);

    assert.ok(result.backupPath);
    assert.equal(existsSync(result.backupPath), true);
    assert.equal(result.fromVersion, DESKCUE_SQLITE_SCHEMA_VERSION);
    assert.equal(result.metadataUpgraded, true);
    assert.equal(result.toVersion, DESKCUE_SQLITE_SCHEMA_VERSION);
    assert.equal(hasColumn(database, "schema_migrations", "checksum"), true);
    assert.match(readAppliedMigrationChecksum(database, 1), /^sha256:/);
  } finally {
    database.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("rejects current databases when an applied migration checksum changed", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-migrations-"));
  const databasePath = join(tempDir, "state.sqlite");
  const database = new Database(databasePath);

  try {
    migrateSqliteDatabase(database, databasePath);
    database.prepare(`
      UPDATE schema_migrations
      SET checksum = ?
      WHERE version = ?
    `).run("sha256:changed", 1);

    assert.throws(
      () => migrateSqliteDatabase(database, databasePath),
      /checksum mismatch/
    );
  } finally {
    database.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("reconciles the previous pre-release v1 checksum without losing existing data", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-migrations-"));
  const databasePath = join(tempDir, "state.sqlite");
  const database = new Database(databasePath);

  try {
    const v1Migration = SQLITE_MIGRATIONS[0]!;
    migrateSqliteDatabase(database, databasePath, {
      migrationPlan: {
        migrations: [v1Migration],
        schemaVersion: 1
      }
    });
    const canonicalChecksum = readAppliedMigrationChecksum(database, 1);
    database.exec("DROP TABLE access_recovery_codes;");
    database.prepare(`
      INSERT INTO workspaces (id, name, path, created_at, json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      "workspace-existing",
      "Existing",
      "C:\\existing",
      "2026-08-05T00:00:00.000Z",
      '{"id":"workspace-existing"}',
      "2026-08-05T00:00:00.000Z"
    );
    database.prepare(`
      UPDATE schema_migrations
      SET checksum = ?
      WHERE version = 1
    `).run("sha256:9a9c94c906478bc582d3f948060b68d7fb3b19f03c12b0f7deeb33a1d731318c");

    const result = migrateSqliteDatabase(database, databasePath);

    assert.ok(result.backupPath);
    assert.equal(result.fromVersion, 1);
    assert.equal(result.toVersion, DESKCUE_SQLITE_SCHEMA_VERSION);
    assert.equal(hasTable(database, "access_recovery_codes"), true);
    assert.equal(hasTable(database, "cloud_connector_profiles"), true);
    assert.equal(hasTable(database, "cloud_sync_outbox"), true);
    assert.equal(readAppliedMigrationChecksum(database, 1), canonicalChecksum);
    assert.deepEqual(
      database.prepare("SELECT id, name FROM workspaces WHERE id = ?").get("workspace-existing"),
      { id: "workspace-existing", name: "Existing" }
    );
  } finally {
    database.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("reconciles the pre-enrollment-attempt v1 checksum without losing existing data", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-migrations-"));
  const databasePath = join(tempDir, "state.sqlite");
  const database = new Database(databasePath);

  try {
    migrateSqliteDatabase(database, databasePath);
    database.prepare(`
      INSERT INTO workspaces (id, name, path, created_at, json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      "workspace-before-cloud-attempt",
      "Existing",
      "C:\\existing",
      "2026-08-12T00:00:00.000Z",
      '{"id":"workspace-before-cloud-attempt"}',
      "2026-08-12T00:00:00.000Z"
    );
    database.exec("DROP TABLE cloud_enrollment_attempt;");
    database.prepare(`
      UPDATE schema_migrations
      SET checksum = ?
      WHERE version = 1
    `).run("sha256:9084e40fea671a743ece0ffd9d0812d94502b5575dcf6a6594624d3af6000723");

    const result = migrateSqliteDatabase(database, databasePath);

    assert.ok(result.backupPath);
    assert.equal(result.fromVersion, 1);
    assert.equal(result.toVersion, 1);
    assert.equal(hasTable(database, "cloud_enrollment_attempt"), true);
    assert.deepEqual(
      database.prepare("SELECT id, name FROM workspaces WHERE id = ?")
        .get("workspace-before-cloud-attempt"),
      { id: "workspace-before-cloud-attempt", name: "Existing" }
    );
    assert.equal(readAppliedMigrationChecksum(database, 1), SQLITE_MIGRATIONS[0]!.checksum);
  } finally {
    database.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("migrates the checked-in legacy v1 SQLite fixture to the current schema", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-migrations-"));
  const databasePath = join(tempDir, "state.sqlite");
  const database = new Database(databasePath);

  try {
    database.exec(readSqliteFixture("v1-legacy-without-checksums.sql"));

    const result = migrateSqliteDatabase(database, databasePath);

    assert.ok(result.backupPath);
    assert.equal(result.fromVersion, 1);
    assert.equal(result.metadataUpgraded, true);
    assert.equal(result.toVersion, DESKCUE_SQLITE_SCHEMA_VERSION);
    assert.equal(readAppliedMigrationCount(database), DESKCUE_SQLITE_SCHEMA_VERSION);
    assert.match(readAppliedMigrationChecksum(database, 1), /^sha256:/);
    assert.equal(readWorkspaceJson(database), '{"id":"workspace-fixture","name":"Fixture Workspace","path":"C:\\\\deskcue-fixture","isGitRepo":true,"branch":"main","createdAt":"2026-06-24T00:00:00.000Z"}');
  } finally {
    database.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("keeps a pre-migration backup and rolls back service tables when migration fails", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-migrations-"));
  const databasePath = join(tempDir, "state.sqlite");
  const database = new Database(databasePath);

  try {
    database.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY
      );
    `);
    database.prepare("INSERT INTO workspaces (id) VALUES (?)").run("legacy-workspace");

    assert.throws(
      () => migrateSqliteDatabase(database, databasePath),
      (error) => {
        assert.equal(error instanceof SqliteMigrationFailedError, true);
        assert.equal(existsSync((error as SqliteMigrationFailedError).backupPath!), true);

        const backup = new Database((error as SqliteMigrationFailedError).backupPath!);
        try {
          assert.equal(hasTable(backup, "workspaces"), true);
          assert.equal(hasTable(backup, "metadata"), false);
          assert.equal(hasTable(backup, "schema_migrations"), false);
        } finally {
          backup.close();
        }

        return true;
      }
    );

    assert.equal(hasTable(database, "metadata"), false);
    assert.equal(hasTable(database, "schema_migrations"), false);
  } finally {
    database.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("rehearses a future migration without changing the production schema version", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-migrations-"));
  const databasePath = join(tempDir, "state.sqlite");
  const database = new Database(databasePath);
  const futureSchemaVersion = DESKCUE_SQLITE_SCHEMA_VERSION + 1;
  const rehearsalMigration: SqliteMigration = {
    apply(targetDatabase) {
      targetDatabase.exec(`
        CREATE TABLE artifacts (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
    },
    checksum: "sha256:rehearsal-add-artifacts",
    name: "rehearsal add artifacts table",
    version: futureSchemaVersion
  };

  try {
    migrateSqliteDatabase(database, databasePath);
    assert.equal(readSqliteSchemaVersion(database), DESKCUE_SQLITE_SCHEMA_VERSION);

    const result = migrateSqliteDatabase(database, databasePath, {
      migrationPlan: {
        migrations: [...SQLITE_MIGRATIONS, rehearsalMigration],
        schemaVersion: futureSchemaVersion
      }
    });

    assert.ok(result.backupPath);
    assert.equal(existsSync(result.backupPath), true);
    assert.equal(result.fromVersion, DESKCUE_SQLITE_SCHEMA_VERSION);
    assert.equal(result.metadataUpgraded, false);
    assert.equal(result.toVersion, futureSchemaVersion);
    assert.equal(readSqliteSchemaVersion(database), futureSchemaVersion);
    assert.equal(hasTable(database, "artifacts"), true);
    assert.equal(readAppliedMigrationCount(database), futureSchemaVersion);
    assert.equal(
      readAppliedMigrationChecksum(database, futureSchemaVersion),
      rehearsalMigration.checksum
    );

    const backup = new Database(result.backupPath!);
    try {
      assert.equal(readSqliteSchemaVersion(backup), DESKCUE_SQLITE_SCHEMA_VERSION);
      assert.equal(hasTable(backup, "artifacts"), false);
    } finally {
      backup.close();
    }
  } finally {
    database.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});
