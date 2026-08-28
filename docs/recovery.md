# DeskCue Recovery Notes

This page covers local recovery steps for the source-checkout public alpha.

DeskCue keeps daemon state in:

```text
.deskcue-data/service/deskcue.sqlite
```

Daemon operational logs are written to:

```text
.deskcue-data/service/logs/daemon.jsonl
```

## In-flight prompt delivery

DeskCue journals a prompt before invoking its runtime transport. Recovery uses
the last durable delivery phase instead of assuming that every unfinished
prompt was interrupted:

- `prepared` means dispatch never began, so the prompt is surfaced as
  `not_sent` and can be retried safely by the user;
- `dispatching` or `accepted` means the runtime may already have received the
  prompt, so DeskCue does not resend it automatically;
- for source-backed Codex and Claude Code sessions, startup keeps `checking`
  only when durable state already identifies the observed native prompt;
- without that identity, an ambiguous delivery starts as `outcome_unknown`
  instead of guessing from later transcript text;
- when the exact prompt is observed, DeskCue keeps checking until the same
  source turn has a terminal outcome; observation alone does not prove how the
  turn ended;
- when delivery or the terminal outcome cannot be confirmed, the UI exposes
  `outcome_unknown` and does not offer a resend action

Startup reconciliation is deliberately bounded to the newest 160 native
transcript entries and 8 projected chat messages. A very tool-heavy or rapidly
advancing source conversation can therefore move the matching user message
outside the inspected window. That case is a safe false negative: DeskCue keeps
the delivery as `outcome_unknown` and never turns missing bounded evidence into
an automatic or user-triggered resend from the recovery card. The user can
inspect the native chat to determine what happened.

The source-backed Codex and Claude Code prompt subprocess is designed to outlive
a graceful daemon shutdown, so the agent can keep working while DeskCue
restarts. This does not make the daemon the owner of the runtime's transcript or
guarantee continuation after an operating-system, runtime, or storage failure.

Generic CLI processes and DeskCue-owned Ollama or LM Studio generations are
managed by the daemon. DeskCue does not promise that those processes or
generations continue across a daemon restart. Their persisted finalized history
is still recovered according to the relevant runtime contract.

## Failed SQLite Migration

When a SQLite schema migration fails, the daemon stops startup instead of
continuing with uncertain state. The log entry is:

```text
SQLite schema migration failed
```

The log context includes:

- `databaseFile`: the database that failed to open or migrate;
- `fromVersion`: the schema version found before migration, when available;
- `toVersion`: the daemon target schema version;
- `backupPath`: the pre-migration backup path, when a non-empty database file
  existed before migration;
- `message`: the underlying error

The safest first recovery path is to install a fixed DeskCue build and start the
daemon again. Pending migrations run transactionally, so a failed migration
should leave the main database at the previous schema version unless SQLite
itself reports otherwise.

Run the read-only doctor command first:

```bash
npm run doctor
```

Use its output to confirm the database file, the daemon log file, recent backup
files and the most recent `SQLite schema migration failed` entry. The command
does not restore, delete or rewrite data.

## Manual Backup Restore

Use manual restore when you need to return to the old daemon version or when a
fixed build is not available yet.

1. Stop the DeskCue daemon
2. Preserve the failed database for debugging
3. Copy the logged backup over `deskcue.sqlite`
4. Start the DeskCue version that supported the restored schema

PowerShell example from the repository root:

```powershell
cd .deskcue-data/service
Copy-Item .\deskcue.sqlite .\deskcue.sqlite.failed
Copy-Item ".\deskcue.sqlite.backup-v0-to-v1-2026-06-24T08-00-00-000Z" .\deskcue.sqlite
```

Replace the backup filename with the exact `backupPath` from the daemon log.

Do not delete `.deskcue-data` as a first recovery step. It contains the local
session history, paired device token hashes, daemon logs and migration backups.

## Future Schema Version

If the daemon reports an unsupported future schema version, the database was
already opened by a newer DeskCue build. Use one of these paths:

- run the newer DeskCue build again;
- install a build that supports that schema version;
- restore a backup made before the newer build upgraded the database

DeskCue intentionally refuses to silently downgrade or rewrite a future schema.
