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

For a Windows packaged candidate, also verify the distribution from its built
payload rather than from TypeScript source or the Vite development server:

1. build and test the self-contained Windows tray;
2. run `node --test tooling/windows-installer/payload-lib.test.mjs`;
3. assemble the allowlisted payload under Node.js `24.14.0` and require both
   `better-sqlite3` and `@lydell/node-pty` through its bundled runtime;
4. compile the unsigned Inno Setup artifact and record its SHA-256;
5. install silently into a clean per-user test profile and verify both the
   default autostart choice and explicit opt-out;
6. exercise `deskcue start`, `status`, `open --print`, `logs`, `restart`,
   `stop` and `doctor` from a fresh terminal;
7. confirm direct installer-over-install is rejected without interrupting the
   running Host;
8. verify failure rollback and Host recovery before any destructive copy;
9. exercise a coordinated update and confirm data plus a user-disabled
   autostart preference are preserved;
10. uninstall while DeskCue is running, confirm program integration is removed,
    and confirm that `%LOCALAPPDATA%\DeskCue` was preserved.

The current unsigned Windows x64 artifact passed 14/14 isolated installer
scenarios, 55/55 recorded observations and three independent
static/operational reviews. Coverage includes the checklist above, partial
committed and uncommitted recovery, registry-cleanup fail-closed retention and
retry, and pre-existing PATH preservation. Payload and tray provenance were
bound to the exact tested artifact, but that binding is not a reproducible-build
proof.

The smoke used explicit isolated paths on the build workstation rather than a
separate clean Windows VM. The native installer's interactive visual and
accessibility behavior remains unreviewed. Every release candidate must repeat
the full checklist for its exact built payload; do not promote a new artifact
merely because source-level tests passed.

## User Upgrade Flow

Source-checkout users do not run migration commands manually. On first startup
after updating their checkout:

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

The Windows updater, daemon readiness gate and Host integration are checked in,
and the stable release feed is available starting with `v0.2.0`. The private
Inno `/UPDATE` mode is not a supported direct upgrade path. Every packaged
update must:

1. start only after an explicit CLI or confirmed tray action;
2. begin the daemon's update drain and reject active managed sessions,
   source-agent turns, local-model generations, manual commands and LM Studio
   operations;
3. create a consistent `deskcue.sqlite.backup-update-...` snapshot;
4. download and stage only through the bounded HTTPS/host allowlist policy;
5. verify the staged installer's size and SHA-256 again;
6. shut down the managed daemon without killing unrelated Node processes;
7. launch the installer detached, then let the Host exit while the installer
   coordinates the remaining tray and Host shutdown;
8. reconcile interrupted state or the installed version on the next Host start.

Updates must not be checked or installed in the background. Do not automatically
roll back to an older daemon after a newer daemon may have committed a schema
migration: the older build can correctly reject that future schema. Use the
migration backup and recovery procedure instead.

## Failure Support

Ask the user to run:

```bash
npm run doctor
```

For an installed Windows build, use:

```powershell
deskcue doctor
```

The doctor command is read-only. It reports the daemon database file, log file,
recent backups and recent migration failures. Use it to find the backup path
and the exact failure detail before recommending a restore.

Recovery steps live in [Recovery Notes](./recovery.md).
