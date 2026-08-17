# Release and Migration Playbook

DeskCue applies SQLite migrations automatically when the daemon starts. This
page describes how to prepare a release that changes local state without
surprising users.

## Adding a Migration

During the public alpha, the consolidated v1 schema may still be refined only
through an exact alpha-compatibility normalization path:
every previously emitted v1 checksum must be explicitly allowlisted as
compatible, the idempotent v1 migration must normalize that known shape, and
tests must prove data preservation before recording the canonical checksum.
This exception ends with the first stable release. From that release onward,
migration v1 is immutable; every schema or data change must be a new contiguous
migration v2 or later.

1. Add a new file under `apps/daemon/src/persistence/migrations/` named with
   the next contiguous version, for example `NNNN_addArtifacts.ts`
2. Export the migration from `apps/daemon/src/persistence/migrations/index.ts`
   and bump `DESKCUE_SQLITE_SCHEMA_VERSION` to the same version
3. Keep released migration files immutable. Checksums are stored in
   `schema_migrations`, and editing a released migration will make existing
   databases fail startup. The compatible-checksum v1 normalization above is
   permitted only during the public alpha and must not become a general
   checksum-bypass mechanism
4. Write focused tests in `sqliteMigrations.test.ts`
5. For schema shape changes, add a checked-in SQL fixture representing the
   previous version and verify it migrates to the new version
6. For destructive or data-moving migrations, document the exact backup and
   recovery expectation in the test name and in this playbook

## Before Release

Run the repository verification and isolated smoke gates from the repository
root:

```bash
npm run verify
npm run doctor
npm run smoke:daemon
npm run smoke:web
```

Do an isolated daemon smoke with temporary paths:

```powershell
$env:DESKCUE_DATABASE_FILE = "$env:TEMP\deskcue-smoke\deskcue.sqlite"
$env:DESKCUE_LOG_FILE = "$env:TEMP\deskcue-smoke\daemon.jsonl"
$env:DESKCUE_DAEMON_PORT = "44100"
npm run dev --workspace @deskcue/daemon
```

Verify health, pairing, workspace registration, generic command start/input,
git refresh, preview port update, daemon logs and final session status.

## User Upgrade Flow

Users do not run migration commands manually. On first startup after upgrade:

1. The daemon opens `deskcue.sqlite`
2. It rejects unsupported future schema versions before creating migration
   service tables
3. It validates applied migration checksums
4. It creates a sibling backup before mutating a non-empty database
5. It runs pending migrations inside a SQLite transaction
6. It records each applied migration in `schema_migrations`

If all steps pass, the daemon continues normally. If a migration fails, startup
stops and the daemon log contains `SQLite schema migration failed` with the
database path and backup path when available.

## Failure Support

Ask the user to run:

```bash
npm run doctor
```

The doctor command is read-only. It reports the daemon database file, log file,
recent backups and recent migration failures. Use it to find the backup path
and the exact failure detail before recommending a restore.

Recovery steps live in [Recovery Notes](./recovery.md).
