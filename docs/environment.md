# Environment Configuration

DeskCue reads environment variables from the shell and from local `.env` files.
Shell-provided variables always win over file values.

## Files

The daemon and CLI read these files when they exist:

1. repository `.env.local`
2. repository `.env`
3. package `.env.local`
4. package `.env`
5. current working directory `.env.local`
6. current working directory `.env`

The first file value wins among `.env` files, so `.env.local` overrides `.env`.
Existing `process.env` values are never overwritten.

`.env` and `.env.local` are ignored by git. Keep machine-specific values and
secrets there. Use `.env.example` as the committed complete template. Optional
values are represented as empty assignments; DeskCue treats empty values as
unset for optional string settings.

## Syntax

DeskCue parses local environment files with `dotenv`:

```bash
DESKCUE_DATA_DIR=/path/to/deskcue-data
DESKCUE_LOG_LEVEL=debug
export DESKCUE_PUBLIC_HOST=<your-lan-ip>
# Only needed for Vite/dev or another non-default browser origin.
DESKCUE_ALLOWED_ORIGINS=http://<your-lan-ip>:4173
```

Blank lines and lines starting with `#` are ignored. Single-quoted,
double-quoted and backtick-quoted values are supported, as are multiline quoted
values and optional `export` prefixes. In unquoted values, `#` starts a comment;
quote a value when the hash character is part of the value.

## Common Variables

### Data files

| Variable | Default |
| --- | --- |
| `DESKCUE_DATA_DIR` | `.deskcue-data` |
| `DESKCUE_DATABASE_FILE` | `${DESKCUE_DATA_DIR}/service/deskcue.sqlite` |
| `DESKCUE_STATE_FILE` | `${DESKCUE_DATA_DIR}/service/state.json` |
| `DESKCUE_LOCAL_CHAT_LIBRARY_DIR` | `${DESKCUE_DATA_DIR}/deskcue-chats` |
| `DESKCUE_LOG_FILE` | `${DESKCUE_DATA_DIR}/service/logs/daemon.jsonl` |
| `DESKCUE_LOG_DIR` | unset |

Specific file variables override `DESKCUE_DATA_DIR` for that file.

## Web Settings Overrides

The `/settings` page can edit local access settings without modifying `.env`
files. Saved web settings are written to `${DESKCUE_DATA_DIR}/service/daemon-settings.json`.

For editable access settings, DeskCue resolves values in this order:

1. web settings from `daemon-settings.json`;
2. shell or `.env` variables;
3. built-in defaults

This makes web changes equivalent to environment configuration for the running
daemon and after restart, while keeping `.env` under the user's control. The
settings page shows the active source for each editable value and shows the env
default when a web override is currently replacing it.

Current editable web overrides:

- `authRequired`;
- `publicHost`;
- `allowedOrigins`

Use `Reset to env` on the `/settings` page to delete `daemon-settings.json` and
return these fields to shell or `.env` values. The web page intentionally edits
only runtime-safe access settings. The full `.env.example` remains broader
because many variables are startup, storage, logging, timing or adapter tuning
knobs that should be changed before daemon start or by advanced users.

### Access and LAN

| Variable | Default |
| --- | --- |
| `DESKCUE_AUTH_REQUIRED` | `true` |
| `DESKCUE_BIND_HOST` | `0.0.0.0` |
| `DESKCUE_COOKIE_SECURE` | `auto` |
| `DESKCUE_DAEMON_PORT` | `4100` |
| `DESKCUE_PREVIEW_PROXY_PORT` | daemon port + 1 (`4101` by default) |
| `DESKCUE_ALLOWED_ORIGINS` | unset |
| `DESKCUE_PUBLIC_HOST` | unset |

By default, source-checkout development listens on LAN with per-device token
and pairing protection enabled. Set `DESKCUE_AUTH_REQUIRED=false` only for an
isolated trusted development environment. Set `DESKCUE_BIND_HOST=127.0.0.1`
when you want loopback-only access. Never expose an unauthenticated daemon to
the public internet.

`DESKCUE_COOKIE_SECURE=auto` adds the `Secure` flag when DeskCue is served over
HTTPS. Keep `auto` unless a reverse-proxy setup requires an explicit `true` or
`false` value.

### Logging

| Variable | Default |
| --- | --- |
| `DESKCUE_LOG_LEVEL` | `info` |
| `DESKCUE_LOG_TO_STDOUT` | `true` |
| `DESKCUE_LOG_TO_FILE` | `true` outside tests |
| `DESKCUE_LOG_MAX_SIZE_MB` | `5` |
| `DESKCUE_LOG_MAX_FILES` | `3` |
| `DESKCUE_LOG_QUEUE_MAX_BYTES` | `1048576` |

The file logger uses a bounded asynchronous queue. Once the queue reaches
`DESKCUE_LOG_QUEUE_MAX_BYTES`, it drops additional file-log entries instead of
letting logging consume unbounded memory; stderr/stdout logging is unaffected.

### Heavy agent request limits

| Variable | Default |
| --- | --- |
| `DESKCUE_AGENT_SESSION_INDEX_FILE` | `${DESKCUE_DATA_DIR}/service/source-agent-index.json` |
| `DESKCUE_AGENT_SESSION_INDEX_SNAPSHOT_TTL_MS` | `15000` |
| `DESKCUE_HEAVY_AGENT_REQUEST_RATE_LIMIT_MAX` | `240` |
| `DESKCUE_HEAVY_AGENT_REQUEST_RATE_LIMIT_WINDOW_MS` | `60000` |
| `DESKCUE_HTTP_COMPRESSION` | `auto` |

The source-agent index file stores bounded discovery snapshots for list/count
views. A stale snapshot can be returned immediately while the daemon refreshes
the index in the background. Requests that need live metadata still refresh the
top visible sessions directly.

These limits protect transcript and diff hydration endpoints such as
`transcript-view`, `transcript-page`, `transcript-entries` and `changes`.
Limits are applied per paired device when auth is enabled, and per remote IP in
open local/LAN development, with separate buckets per heavy endpoint and agent
session. Limited requests return `429` with standard `RateLimit-*` and
`Retry-After` headers.

`DESKCUE_HTTP_COMPRESSION=auto` enables gzip for large JSON responses when the
client advertises `Accept-Encoding: gzip`. This is the right direct-daemon
default for local source-checkout usage. Set it to `off` when DeskCue runs
behind an edge, reverse proxy, or CDN that owns HTTP compression, so the edge can
make the compression decision and avoid double-compression surprises.

For cloud or reverse-proxy capacity planning, measure both browser transfer
bytes and decoded API bytes. Browser transfer is the real client/network cost
when compression is active. Decoded bytes are the conservative upper bound for a
path where neither the daemon nor the edge compresses large JSON.

### Local runtime capacity

| Variable | Default |
| --- | --- |
| `DESKCUE_LOCAL_LLM_MAX_CONCURRENT_GENERATIONS` | `2` |
| `DESKCUE_LOCAL_LLM_GENERATION_QUEUE_CAPACITY` | `16` |

The concurrency limit is shared by all DeskCue-owned Ollama and LM Studio
chats. Additional prompts wait in a FIFO queue before DeskCue creates their
turn, so a queued request does not appear as a running or recoverable turn.
Interrupting a queued chat or stopping the daemon cancels the wait. Requests
beyond the queue capacity fail with HTTP `409` instead of retaining an
unbounded number of pending requests in daemon memory.

### Storage maintenance

| Variable | Default |
| --- | --- |
| `DESKCUE_STORAGE_MAINTENANCE_INTERVAL_MS` | `21600000` |
| `DESKCUE_STORAGE_MAX_MB` | `50` |
| `DESKCUE_LOCAL_CHAT_LIBRARY_MAX_MB` | `1024` |
| `DESKCUE_LOCAL_LLM_DENY_EXECUTABLES` | unset |

DeskCue runs lightweight storage maintenance on daemon startup and then on this
interval. It prunes duplicate attached source-agent shells, old revoked device
tokens, and oversized log rotations; it does not delete attached history by
age. The storage limit applies to the complete `.deskcue-data` directory:
SQLite, WAL files, daemon logs and session detail cache. When it is exceeded,
DeskCue first reduces old attached-session payloads and older completed local
managed-session details to metadata. For local sessions this clears saved logs,
diff snapshots, and input history while preserving the session card, command,
status, timestamps, and exit code. This never deletes the source agent
transcript; reopening the source chat reads it again from the local agent runtime.

If the directory is still above its limit, DeskCue removes the oldest rotated
daemon logs before it considers SQLite compaction. If SQLite then has
reclaimable pages, it automatically runs a WAL checkpoint and `VACUUM`, at most
once every ten minutes. The manual compaction action in `/settings?tab=storage`
remains available when no managed sessions are running.

DeskCue-owned Ollama and LM Studio chats have a separate `1024 MiB` library
quota by default. When it is reached, the oldest inactive local chats are moved
to the bounded `deskcue-chats/archive` recovery buffer and recorded in
`archive-index.jsonl`. The buffer uses the same byte quota and retains entries
for up to 30 days, so it cannot grow forever. Set
`DESKCUE_LOCAL_CHAT_LIBRARY_MAX_MB` to choose a different quota.
`DESKCUE_LOCAL_LLM_DENY_EXECUTABLES` is a comma-separated exact-command
denylist applied even in Full access mode, for example `powershell,cmd,node`.
Full access remains appropriate only for a trusted machine and trusted local
model; it is not a sandbox.

### Runtime overrides

| Variable | Default |
| --- | --- |
| `DESKCUE_CODEX_PATH` | auto-detect |
| `DESKCUE_CODEX_MODEL` | unset |
| `DESKCUE_OLLAMA_ENDPOINT` | `http://127.0.0.1:11434` |
| `DESKCUE_LM_STUDIO_ENDPOINT` | `http://127.0.0.1:1234` |
| `DESKCUE_LM_STUDIO_HOME` | `~/.lmstudio` |
| `CODEX_HOME` | `~/.codex` |
| `CLAUDE_CONFIG_DIR` | `~/.claude` |

DeskCue also understands the runtime-native `OLLAMA_HOST`,
`LM_STUDIO_ENDPOINT`, and `LM_STUDIO_HOME` variables. The `DESKCUE_*` endpoint
variables take precedence over their runtime-native equivalents. For the LM
Studio data directory, `LM_STUDIO_HOME` takes precedence over the compatibility
alias `DESKCUE_LM_STUDIO_HOME`.

### Agent synchronization

| Variable | Default |
| --- | --- |
| `DESKCUE_AGENT_SESSION_SYNC_INTERVAL_MS` | `2500` |
| `DESKCUE_AGENT_DISCOVERY_CACHE_TTL_MS` | `5000` |
| `DESKCUE_SOURCE_AGENT_ACTIVE_TURN_STALE_MS` | `120000` |
| `DESKCUE_SOURCE_AGENT_NOTIFICATION_POLLING_INTERVAL_MS` | `5000` |
| `DESKCUE_SESSION_GIT_POLLING_INTERVAL_MS` | `4000` |

### Notifications

Provider settings and per-event routes are normally stored from the
Notifications settings tab in SQLite. The environment variables below remain
the source-checkout webhook defaults/compatibility path; see
[Notifications](./notifications.md) for all providers.

| Variable | Default |
| --- | --- |
| `DESKCUE_SESSION_WEBHOOK_URL` | unset |
| `DESKCUE_NOTIFICATION_PROVIDER_TIMEOUT_MS` | `10000` |

`DESKCUE_NOTIFICATION_PROVIDER_TIMEOUT_MS` is the canonical deadline for each
external notification-provider attempt. The legacy
`DESKCUE_SESSION_WEBHOOK_TIMEOUT_MS` variable is read only as a compatibility
fallback when the canonical variable is unset; new configurations should not
use it.

## Examples

Source checkout with data outside the repository:

```bash
DESKCUE_DATA_DIR=/path/to/deskcue-data
```

LAN source checkout with `npm run start`:

```bash
DESKCUE_PUBLIC_HOST=<your-lan-ip>
```

Vite frontend development with `npm run dev`:

```bash
DESKCUE_PUBLIC_HOST=<your-lan-ip>
DESKCUE_ALLOWED_ORIGINS=http://<your-lan-ip>:4173
```

Protected LAN development with one-time pairing:

```bash
DESKCUE_AUTH_REQUIRED=true
```

The `/settings?tab=access` page can create a device pairing link. For device links,
DeskCue uses `DESKCUE_PUBLIC_HOST` when configured; otherwise it tries the first
detected LAN IPv4 address. Source-checkout defaults already listen on LAN. If
you changed `DESKCUE_BIND_HOST` back to `127.0.0.1`, set it to `0.0.0.0` and
restart the daemon before opening the link from another device. When
`DESKCUE_PUBLIC_HOST` is empty, DeskCue also allows browser origins from the
detected local interface on the daemon port and Vite dev port so the one-time
pairing flow can work without manually filling `DESKCUE_ALLOWED_ORIGINS` for the
normal `npm run start` path.

Pairing creates one device token per browser or device. Plaintext device tokens
are shown only once to the pairing client and stored by that browser. The daemon
stores token hashes in SQLite.

Reverse proxy deployments are intentionally conservative in the current
source-checkout release.
DeskCue does not have a general `trusted proxies` setting yet, and it does not
trust forwarded headers from arbitrary LAN clients for host-local bootstrap
actions. Keep auth enabled, use HTTPS at the proxy, configure
`DESKCUE_PUBLIC_HOST` to the browser-facing origin, and add proxy-level access
controls before exposing DeskCue outside a trusted LAN.

For a proxied device/domain setup, point the proxy at the browser-facing origin
and forward:

- `/` to the web app;
- `/api` to the daemon HTTP API;
- `/ws` to the daemon WebSocket endpoint;
- `/preview` to the daemon preview proxy

When `DESKCUE_PUBLIC_HOST=https://deskcue.example.com`, pairing links use
`https://deskcue.example.com/pair/<code>` and the browser first tries same-origin
`/api/access/pair`, so the daemon does not need to be reachable from that device
on port `4100`.
