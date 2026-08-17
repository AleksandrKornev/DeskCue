# DeskCue Development Notes

## Repository Commands

Run these from the repository root.

### Install

```bash
npm install
```

### Development

```bash
npm run dev
npm run dev:daemon
npm run dev:web
npm run dev:cli -- start
npm run dev --workspace @deskcue/cli -- doctor
```

### Validation

```bash
npm run build
npm run typecheck
npm run lint
npm run smoke:daemon
npm run smoke:web
npm run test:release --workspace @deskcue/web
```

`lint` checks both the daemon and web app.

For daemon-only changes, prefer the focused checks first:

```bash
npm run typecheck --workspace @deskcue/daemon
npm run test --workspace @deskcue/daemon
```

The daemon runner accepts an exact relative path or test filename and runs only
matching files:

```bash
npm run test --workspace @deskcue/daemon -- localLlmChatService.test.ts
```

Web tests are intentionally split by runner. `npm run test --workspace
@deskcue/web` runs Node `*.test.ts` files and excludes Vitest
`*.unit.test.ts(x)` files; `npm run test:unit --workspace @deskcue/web` runs the
Vitest suite. `test:release` runs both sets plus typecheck and lint.

Repository-specific test runner implementations are centralized in
`scripts/test/`; application packages contain only their source, configuration
and standard package commands.

The daemon test suite includes architecture boundary checks for the current
domain layout, so broad source moves should keep those tests green.

## Package Responsibilities

### `apps/daemon`

- Express API
- WebSocket server
- PTY process execution
- git snapshot polling
- runtime discovery
- transcript discovery and attach flows
- local state persistence

### `apps/web`

- route shell and session navigation
- mobile and desktop review UI
- transcript rendering
- preview iframe
- runtime and workspace controls

### `apps/cli`

- minimal entrypoint that points users back to the main dev flow
- read-only `deskcue doctor` report for daemon data files, backups and recent
  migration failures

### `packages/protocol`

- shared TypeScript types
- default ports
- event payloads

### `packages/adapters`

- generic CLI launch normalization
- runtime-specific resume command helpers

See [Agent Adapters](./adapters.md) for the runtime support levels and the
expected extension path for new agent runtimes.

## Local Data and State

DeskCue stores daemon data here:

```text
.deskcue-data/
```

Important files:

- `service/deskcue.sqlite`: local SQLite state;
- `service/logs/daemon.jsonl`: daemon operational log output;
- `deskcue-chats/`: DeskCue-owned Ollama and LM Studio chat library

Legacy `state.json` is imported into SQLite when the database is empty.
SQLite schema DDL is applied through the daemon migration runner in
`apps/daemon/src/persistence/migrations/sqliteMigrations.ts`. Individual migrations live
under `apps/daemon/src/persistence/migrations/`.

Migration policy:

- migrations are forward-only and versioned with contiguous integers starting at `1`;
- `DESKCUE_SQLITE_SCHEMA_VERSION` must match the latest migration version;
- applied migrations are recorded in `schema_migrations` with checksums;
- already-applied migration checksums are validated at startup, so released
  migration files must not be edited in place;
- the current schema version is mirrored in `metadata.schema_version`;
- a daemon binary refuses to open a database whose `schema_version` is newer than it supports;
- before applying pending migrations to a non-empty database file, the daemon writes a sibling backup file named `*.backup-v<from>-to-v<to>-<timestamp>`;
- the backup is created before migration-owned service tables are created or changed;
- pending migrations run in a SQLite transaction; if a migration fails, the daemon logs `SQLite schema migration failed` with the database path, target version, error message and backup path, then stops startup;
- destructive migrations must include an explicit backup-aware migration plan and focused tests before they are added;
- release migrations should include a checked-in SQLite fixture or SQL fixture
  for the previous schema version when the shape changes

To recover from a failed migration, stop the daemon, preserve the failing database
file for debugging, then either install a fixed daemon build and retry or restore
the logged sibling backup over `deskcue.sqlite`. Run `npm run doctor` first to
locate the current database, daemon log and backup files. See
[Recovery Notes](./recovery.md) for the user-facing restore flow and
[Release and Migration Playbook](./release-migrations.md) for release steps.

## Runtime Discovery Sources

Current runtime inspection relies on local machine state.

- Ollama: local API at `127.0.0.1:11434`
- LM Studio: local config and model metadata under `~/.lmstudio`
- Claude Code: `claude agents --json` plus `~/.claude`
- Codex: local session files under `~/.codex`

Useful environment variables:

- `DESKCUE_DATA_DIR`
- `DESKCUE_LOG_LEVEL`
- `DESKCUE_LOG_TO_STDOUT`
- `DESKCUE_LOG_TO_FILE`
- `DESKCUE_LOG_FILE`
- `DESKCUE_LOG_DIR`
- `DESKCUE_LOG_MAX_SIZE_MB`
- `DESKCUE_LOG_MAX_FILES`
- `DESKCUE_ALLOWED_ORIGINS`
- `DESKCUE_PUBLIC_HOST`
- `DESKCUE_SESSION_WEBHOOK_URL`
- `DESKCUE_NOTIFICATION_PROVIDER_TIMEOUT_MS`
- `CODEX_HOME`
- `CLAUDE_CONFIG_DIR`

The daemon and CLI read `.env.local` and `.env` files for source-checkout
development. Shell-provided environment variables take priority. See
[Environment Configuration](./environment.md).

## Local and LAN Access

Source-checkout development listens on LAN by default so the dashboard can be
opened from another device without changing daemon bind settings. When auth is enabled,
pairing creates one device token per browser or device and stores only token
hashes in SQLite.

Use the pairing flow for another browser or device:

1. Open `GET /api/access/link` from the host machine
2. Open the returned `webUrl` from the target browser
3. The dashboard exchanges the one-time pairing code for a daemon URL and device token

When `DESKCUE_PUBLIC_HOST` is set, the daemon uses it in generated pairing links
and allowed dashboard origins.

Set `DESKCUE_BIND_HOST=127.0.0.1` if you want loopback-only development.

Use `/settings?tab=access` to revoke the current browser token or revoke other
paired devices. `POST /api/access/reset` remains as a compatibility alias for
revoking other active device tokens.

## Daemon Logs

Daemon operational logs are written to `.deskcue-data/service/logs/daemon.jsonl`
by default. They are separate from managed-session stdout/stderr logs.

The dashboard exposes the daemon log viewer at `/logs` and reads the latest log
tail through `GET /api/daemon/logs`.

## Session Execution Notes

- Generic commands run inside a PTY
- On Windows, generic commands run through `cmd.exe /d /c` with a temporary
  `.cmd` wrapper so
  quoted absolute paths such as `node "C:\path\script.cjs"` survive
  PTY argument escaping
- For explicit spawn specs such as Codex resume, the daemon spawns the target executable directly
- DeskCue keeps at most `2000` log lines per managed session and truncates oversized chunks

## Preview Behavior

- Preview is enabled per managed session by selecting a port
- The browser requests a short-lived, owner-scoped preview capability from the
  daemon and opens the stable `/api/preview/...` relay URL; raw relay
  credentials are not returned in JSON
- Local DeskCue and optional Cloud Preview use the same bounded daemon engine
  for target validation, rewriting, cookies, HTTP and WebSockets. The Cloud
  transport adapts this engine to a short-lived lease on a distinct Preview
  origin; it is not a second implementation of Preview rules. The current
  public-alpha uses wildcard origins under the same registrable `deskcue.io`
  site, while a separate registrable content domain remains planned hardening
- `device-direct` leaves safe external destinations with the viewing browser.
  `deskcue-host` relays HTTP(S), SSE, streaming, Range and WebSocket traffic
  through the host machine so it can use host DNS and VPN reachability without
  exposing the Preview port directly
- Application cookies, authorization and the bounded custom-header allowlist
  are relayed, while DeskCue/Cloud service cookies and credentials are stripped.
  Host-mode cookie jars are isolated by owner and browser viewer namespace
- Cloud HTTP bodies use credit-based backpressure. A deadline covers connection
  and response start, then active streams use an idle timeout refreshed by
  activity; lease expiry remains a hard Cloud-side bound
- A dropped Cloud data connection fails its in-flight HTTP streams and
  WebSockets. The daemon reconnects outbound with bounded backoff and the
  browser obtains a new lease before retrying; requests are not blindly replayed
- The path-based relay cannot make every origin-sensitive application
  transparent. Service workers, WebTransport, and strict origin assumptions
  remain compatibility-dependent

## Current Distribution Path

The project is still optimized for source checkout development:

1. Install Node.js 22.22 or newer within the 22.x release line, or Node.js
   24.x, plus npm 10+ and Git for clone/diff features
2. Run `npm install` from the repository root
3. Run `npm run start` to start the daemon and built dashboard on one port
4. Use `GET /api/access/link` from the host machine when pairing another browser or device

Use `npm run dev` when actively changing the frontend and you need the Vite
dashboard on `4173`.

Playwright targets the built app at `http://127.0.0.1:4100` by default. Override
`DESKCUE_E2E_BASE_URL` only for another already-running DeskCue instance. The
normal `test:e2e` command is strict: selecting only optional scenarios without
their target variables fails instead of reporting a false green with zero
executed tests. Use `test:e2e:optional` while preparing an optional fixture.

For release-style chat network checks, run the built app through the daemon and
enable the opt-in long Playwright scenario:

```powershell
$env:DESKCUE_HTTP_COMPRESSION = "auto"
npm run start

$env:DESKCUE_E2E_BASE_URL = "http://127.0.0.1:4100"
$env:DESKCUE_E2E_AGENT_ID = "<agent-session-id>"
$env:DESKCUE_E2E_LIVE_USER_MS = "300000"
npm run test:e2e --workspace @deskcue/web -- network-budget.spec.ts
```

Set `DESKCUE_E2E_SESSION_ID` as well when the target chat is opened through a
managed session route. The long scenario does not submit prompts and does not
stop sessions.

A packaged installer, Docker Compose file, and release artifact flow are still future work.

## Current Design Constraints

- Keep the core local experience local-first and self-hostable
- Prefer simple, readable code over speculative abstraction
- Keep module-scope runtime declarations in dependency-first order: constants,
  helpers, and classes appear before their first use instead of relying on
  JavaScript hoisting. Explicit recursion is the only local exception
- Avoid introducing cloud-only assumptions into public docs or implementation
- Reuse `@deskcue/protocol` types instead of redefining API shapes in the daemon or web app

## Documentation Rule

Repository-level docs inside `DeskCue/` should stay self-contained. Do not make them depend on private files that live outside the repository root.
