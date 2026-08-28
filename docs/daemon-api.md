# DeskCue Daemon API

## Base URL

Default daemon URL:

```text
http://localhost:4100
```

The default port comes from `@deskcue/protocol` as `DEFAULT_DAEMON_PORT`.

## Transport Model

DeskCue uses:

- HTTP for reads and commands;
- WebSocket at `/ws` for live updates and client presence

Most HTTP endpoints require an access token:

```http
Authorization: Bearer <deskcue-access-token>
```

Pairing creates a separate device token for each browser or device. The daemon
stores only token hashes in SQLite. Source-checkout defaults bind the daemon to
LAN with authentication enabled by default. Use
`DESKCUE_AUTH_REQUIRED=false` only for isolated trusted development.

## HTTP Endpoints

### Access

`GET /api/access/link`

Host-local or already-paired endpoint that returns a ready dashboard URL, daemon
URL, and one-time pairing code. This endpoint is intended for local bootstrap,
LAN setup, and paired-device recovery.

Use `GET /api/access/link?target=device` when generating a link for another
device. The legacy `target=mobile` value is still accepted as an alias. In
device mode the daemon chooses the host in this order:

1. `DESKCUE_PUBLIC_HOST` or the web override value;
2. first detected LAN IPv4 address;
3. request host fallback

Returns:

```json
{
  "webUrl": "http://localhost:4100/pair/one-time-code",
  "daemonUrl": "http://localhost:4100",
  "hostSource": "request_host",
  "lanReady": true,
  "pairCode": "one-time-code",
  "warnings": []
}
```

`lanReady=false` means the link was created, but another device may not be able to
reach it. The common case is an explicit `DESKCUE_BIND_HOST=127.0.0.1` override;
set `DESKCUE_BIND_HOST=0.0.0.0` and restart the daemon before opening LAN links
from another device.

When `DESKCUE_PUBLIC_HOST` is configured as a full browser-facing origin, for
example `https://deskcue.example.com`, the returned `webUrl` and `daemonUrl`
use that origin without adding local dev ports. A reverse proxy should route
same-origin `/api` and `/ws` traffic to the daemon.

`POST /api/access/pair`

Body:

```json
{
  "code": "one-time-code"
}
```

Exchanges the one-time pairing code for:

```json
{
  "daemonUrl": "http://localhost:4100",
  "accessToken": "...",
  "deviceId": "device-id"
}
```

`GET /api/access/link/:pairCode/status`

Returns whether an outstanding one-time device link is pending, used, or
expired without returning its access token.

`POST /api/access/recovery-codes`

Creates a single-use recovery code from a host-local or authenticated request.
The plaintext code is returned only once.

`POST /api/access/recover`

Exchanges a valid recovery code for a new device token.

`POST /api/access/reset`

Compatibility endpoint that revokes other active device tokens. This endpoint
requires the current Bearer token when auth is enabled. Prefer
`POST /api/access/devices/revoke-others` in new clients.

Returns:

```json
{
  "revokedCount": 2
}
```

`GET /api/access/devices`

Returns paired device records. Token values are never returned.

```json
{
  "devices": [
    {
      "id": "device-id",
      "label": "Chrome browser",
      "userAgent": "...",
      "createdAt": "2026-06-26T00:00:00.000Z",
      "lastSeenAt": "2026-06-26T00:00:00.000Z",
      "lastIp": "127.0.0.1",
      "revokedAt": null,
      "current": true
    }
  ]
}
```

`DELETE /api/access/devices/current`

Revokes the current browser device token.

`DELETE /api/access/devices/:deviceId`

Revokes one device token by id.

`PATCH /api/access/devices/:deviceId`

Updates the user-visible label of one paired device.

`POST /api/access/devices/revoke-others`

Revokes all active device tokens except the current one.

### Health and Overview

`GET /api/health`

Returns:

```json
{
  "ok": true
}
```

`GET /api/overview`

Returns:

- `clientContext.canOpenNativeDialogs`
- registered workspaces
- current managed sessions

The daemon records lightweight request metrics for this endpoint so large local
or future cloud deployments can distinguish dashboard summary cost from
transcript/diff hydration cost.

### Optional DeskCue Cloud connector

All connector endpoints require the normal DeskCue device authorization.

`GET /api/cloud/connection`

Returns connector availability, connection state, Cloud origin, machine id,
last connection/error metadata and the pending durable event count. It never
returns enrollment, machine or relay credentials.

`POST /api/cloud/connection`

Manual fallback: consumes a short-lived machine enrollment ticket created by an
authenticated DeskCue Cloud account:

```json
{
  "cloudOrigin": "https://cloud.example.com",
  "displayName": "Workstation",
  "enrollmentTicket": "<one-time-ticket>",
  "allowRemoteRead": false,
  "allowRemoteControl": false
}
```

The ticket is not persisted. On success the daemon stores the returned machine
credential in an authenticated encrypted envelope outside SQLite, creates a
metadata-only durable outbox and opens an outbound WebSocket using a separate
single-use relay token.

`POST /api/cloud/enrollment-attempts`

Starts the primary browser-confirmed enrollment flow without copying a secret:

```json
{
  "cloudOrigin": "https://cloud.example.com",
  "displayName": "Workstation",
  "allowRemoteRead": false,
  "allowRemoteFiles": false,
  "allowRemoteControl": false,
  "allowRemotePreview": false
}
```

The response contains a short-lived `verificationUrl` such as
`https://cloud.example.com/enroll?attempt=<public-id>`. The URL contains only a
public attempt identifier. The independent `attemptSecret` returned by Cloud is
kept in the daemon's authenticated local secret envelope and is never placed in
the URL, browser storage, logs, or the local HTTP response.

DeskCue opens the verification URL. Cloud preserves a validated same-origin
`/enroll?...` return path through login, registration, and email verification.
The authenticated user reviews the machine metadata and explicitly approves the
request. Meanwhile the daemon polls Cloud independently. Poll metadata is stored
durably in SQLite and the attempt secret remains in the encrypted envelope, so a
daemon restart resumes polling rather than requiring another approval.

Cloud provisions the machine only after approval and stores the final result in
an encrypted, attempt-scoped envelope. This makes final credential retrieval
restart-safe: if either side loses the response, the daemon can poll the same
attempt again until its expiry. On success DeskCue durably stores the machine
credential, removes the attempt secret and starts the normal outbound relay.

`GET /api/cloud/enrollment-attempt` returns the current local attempt status and
safe verification metadata, or `{ "attempt": null }`. It never returns the
attempt secret or machine credential. `DELETE /api/cloud/enrollment-attempt`
cancels local polling and removes the local attempt state. The legacy ticket
form remains available as a bounded manual fallback.

`allowRemoteRead` is an explicit local grant. When true, the daemon additionally
advertises `deskcue.read` and accepts only bounded, typed overview/session/
transcript/changes reads. Bodies are transient and not placed in the outbox or
logs; the current Cloud transport is not end-to-end encrypted.

`allowRemoteControl` is a separate explicit local grant. When true, the daemon
advertises `deskcue.control` and accepts only source attach, managed input, and
managed interrupt commands. Each command requires a stable command id and is
deduplicated by a bounded durable local receipt. The receipt stores an input
digest and sanitized result, not prompt text. An outcome left unknown by a crash
is not automatically retried. Cloud cannot invoke arbitrary daemon routes,
external process fallbacks, or host-specific force-stop behavior.

When remote reads are allowed, the daemon can also advertise
`deskcue.realtime`. This forwards the existing small DeskCue WebSocket events
while the connector is online; transcript, diff, and file hydration remains on
the bounded HTTP facade. Realtime bodies are transient and are not persisted in
the Cloud outbox.

`DELETE /api/cloud/connection`

Stops reconnect, closes the outbound socket, disables the profile and removes
the machine credential from the local envelope. Local DeskCue operation is not
affected.

### Workspaces

`GET /api/workspaces`

Returns all registered workspaces.

`POST /api/workspaces`

Body:

```json
{
  "path": "/path/to/my-app"
}
```

Creates or reuses a registered workspace after resolving the path and inspecting git state.

`POST /api/workspaces/pick`

Attempts to open the native folder picker. This is only allowed from a host-local request.

`GET /api/workspaces/:workspaceId/files?path=src&cursor=<opaque>&limit=50`

Lists one workspace-relative directory page for the read-only Files view. `path`
defaults to the workspace root, `limit` defaults to 50 and is capped at 100, and
`nextCursor` is an opaque, name-based continuation token, so entries inserted or
removed before the current page do not shift later pages. A directory scan is
bounded at 20,000 entries. Entries expose only bounded metadata; symbolic links
are visible but cannot be opened.

`GET /api/workspaces/:workspaceId/file?path=src/index.ts`

Returns a bounded UTF-8 file preview with `binary` and `truncated` metadata. At
most 256 KiB is read. Binary files return `content: null`. Both workspace file
endpoints reject absolute paths, traversal and symbolic-link components, and
can only access the selected registered workspace root.

### Managed Sessions

`GET /api/sessions`

Returns managed session summaries.

`GET /api/sessions/:sessionId`

Returns a managed session detail object with logs and input history.

`POST /api/sessions`

Body:

```json
{
  "workspaceId": "workspace-id",
  "command": "codex"
}
```

Starts a new generic CLI session in the selected workspace.

`POST /api/sessions/:sessionId/input`

Body:

```json
{
  "input": "Continue with the refactor and run tests."
}
```

Sends follow-up input to the running managed session.

For attached Codex sessions, the daemon chooses the safest delivery path:

- if DeskCue owns a live managed Codex process, input is written to that process;
- if the same Codex thread is active in another client, DeskCue keeps it observation-only and rejects prompts while the other writer remains active;
- once that source thread becomes resumable, DeskCue continues it with a one-shot `codex exec resume <sessionId> "<prompt>"`

Managed session summaries may include a `promptRecovery` object after source
prompt transport loss:

```json
{
  "observedPromptAt": "2026-08-11T09:00:01.000Z",
  "phase": "checking",
  "promptText": "Continue with the refactor.",
  "requestedAt": "2026-08-11T09:00:00.000Z",
  "retryable": false
}
```

`phase` is `checking` while a bounded Codex or Claude Code source-detail read
reconciles an exactly observed prompt, `outcome_unknown` when delivery or its
terminal outcome cannot be confirmed, or `not_sent` when dispatch definitely
never began. Observation alone does not clear recovery; the same source turn
must have a terminal entry. DeskCue never automatically resends a recovered
prompt. `promptText` is nullable, and Remote DeskCue command responses redact
it. `retryable` is true only for the safe `not_sent` case. DeskCue does not
offer a resend action for `outcome_unknown`, because it may duplicate work.

The source-backed Codex and Claude Code prompt subprocess is designed to keep
running through a graceful daemon restart. This continuation guarantee does not
extend to daemon-managed Generic CLI processes or DeskCue-owned Ollama and LM
Studio generations.

`POST /api/sessions/:sessionId/interrupt`

Interrupts the current prompt flow for taken-over Codex chats by restarting the transport.

`POST /api/sessions/:sessionId/stop`

Stops the running managed session.

`POST /api/sessions/:sessionId/preview`

Body:

```json
{
  "port": 5173
}
```

Sets or clears the live preview port for the session. Use `null` to switch preview off.

`POST /api/sessions/:sessionId/preview/artifacts`

Body:

```json
{
  "viewport": "mobile"
}
```

Stores a metadata review marker for the active preview. Current markers record
the target URL, viewport, session status and basic session counts. Screenshot
and console capture are future preview artifact work.

`POST /api/preview/tickets`

Creates a five-minute, in-memory ticket scoped to one active managed session or
DeskCue-owned Local LLM chat. The authenticated request body is:

```json
{
  "kind": "session",
  "ownerId": "session-id"
}
```

`kind` is `session` or `local-llm`. The response contains `ticket`, `expiresAt`
and a same-origin `previewUrl`. The browser must navigate the sandboxed preview
to that URL instead of connecting to the configured local port directly.
The short-lived ticket is carried in a redacted path segment of `previewUrl`,
so relative scripts, styles, module imports and WebSocket paths inherit the same
owner-scoped authority even inside an opaque-origin sandbox. Ticket values are
never written to request logs.
Preview HTTP and WebSocket traffic then stays under
`/api/preview/sessions/:sessionId/*` or `/api/preview/local-llm/:chatId/*`.
The daemon resolves only the active loopback port from stored preview state,
strips DeskCue credentials before forwarding, bounds request/response/WS data,
and rejects redirects outside that target.

`GET /api/preview/candidates?kind=session&ownerId=session-id`

Probes only a fixed set of common loopback development ports plus the already
configured port. Probes use a 600 ms deadline and concurrency of three; the
daemon port itself is excluded. The response is
`{"candidates":[{"port":5173,"configured":false}]}`. A client may
auto-select only when exactly one healthy candidate is returned; multiple
candidates require an explicit choice, and manual port entry remains an
advanced fallback.

`POST /api/sessions/:sessionId/refresh-git`

Refreshes the current git snapshot on demand.

`POST /api/manual-command` runs one bounded manual command in a registered
workspace. Runtime-specific interruption fallbacks use capability/action pairs
under `/api/sessions/:sessionId/external-*`: Claude background stop, external
process force-stop, Codex Desktop interrupt and opening the matching Codex
Desktop chat. Clients must query the corresponding `*-capability` endpoint
before offering one of these host-level actions.

### Discovered Agent Sessions

`GET /api/agents/sessions`

Returns discovered sessions across supported local runtimes.

The list uses a bounded source-agent index snapshot for count/list discovery
when live metadata is not required. A stale snapshot can be returned while the
daemon refreshes the snapshot in the background. Requests with
`includeLiveMetadata=1` still refresh the top visible sessions directly and use
the index for count metadata.

`GET /api/agents/sessions/:agentSessionId`

Returns transcript detail for a discovered session.

`GET /api/agents/sessions/:agentSessionId/transcript-view`

Returns the bounded chat/activity transcript view used by the active chat UI.
The daemon sends `ETag` when the source adapter can provide a cheap source
version, and accepts `If-None-Match` so unchanged views can return `304` before
building heavy transcript detail. Codex and Claude Code provide a
source-version path.

`GET /api/agents/sessions/:agentSessionId/activity-groups/:groupId`

Hydrates one compact activity group. The response supports `ETag` and
`If-None-Match`.

`GET /api/agents/sessions/:agentSessionId/changes/:groupId`

Hydrates changed files for one activity group. Use `entryIds` when the selected
entries fit in the query string. For large entry selections, use the matching
`POST` endpoint with a JSON body. Both forms keep heavy payloads on HTTP and
support cache validation.

`GET /api/agents/sessions/:agentSessionId/transcript-entries`

Hydrates exact transcript entries by id. Use `entryIds` for compact requests or
the matching `POST` endpoint for large selections. The daemon prefers exact
entry/range reads and only falls back to broader bounded reads when needed.

`GET /api/agents/sessions/:agentSessionId/transcript-page`

Loads an older bounded transcript page before a known entry id. It also supports
`ETag` and `If-None-Match`.

`GET /api/agents/sessions/:agentSessionId/transcript-updates` returns a bounded
delta after a source cursor. `POST /api/agents/sessions/:agentSessionId/reviewed`
stores the local review marker used by the recent-chat surface.

Heavy transcript and diff hydration endpoints are rate-limited per paired
device, or per remote IP when auth is disabled, and the bucket includes the
agent session id. A limited request returns `429` with `RateLimit-Limit`,
`RateLimit-Remaining`, `RateLimit-Reset` and `Retry-After` headers.

`POST /api/agents/sessions/:agentSessionId/attach`

Body:

```json
{
  "prompt": "Pick up from here and continue."
}
```

Creates or reuses a managed session attached to the discovered agent session when the runtime is resumable.

For Codex, a source thread that is active in another client is observation-only because Codex permits only one active writer. DeskCue rejects prompts for that state instead of queueing work that cannot be delivered. Once the source transcript is resumable, DeskCue can try a one-shot `exec resume`; if Codex Desktop still holds the writer, DeskCue keeps the shell read-only, records the prompt as not sent, and offers an explicit retry after the other writer is closed. For source workspaces that are not Git repositories, DeskCue adds Codex's `--skip-git-repo-check` option.

### Codex Compatibility Endpoints

`GET /api/codex/sessions`

Returns discovered Codex sessions.

`GET /api/codex/sessions/:sessionId`

Returns Codex transcript detail for one session.

`POST /api/codex/sessions/:sessionId/resume`

Body:

```json
{
  "prompt": "Continue."
}
```

Creates a managed session around a Codex thread using the Codex-specific resume path.

If the thread is active in another Codex client, DeskCue rejects requests that include `prompt` and creates or reuses a read-only review shell for requests without one. This prevents a prompt from remaining in `waiting` while Codex's single-writer lock makes delivery impossible.

### Runtime Discovery

`GET /api/runtimes`

Returns runtime summaries for:

- Ollama
- LM Studio
- Claude Code

`POST /api/runtimes/lm-studio/server/start`

Starts or wakes the locally installed LM Studio server through its CLI.

`GET /api/runtimes/lm-studio/models`

Returns locally installed LM Studio models.

`POST /api/runtimes/lm-studio/prepare`

Ensures the requested installed model is loaded and the local server is ready.

### DeskCue-owned Local LLM Chats

`GET /api/local-llm/chats`

Lists chats stored in the dedicated `deskcue-chats` library.

`POST /api/local-llm/chats`

Creates a DeskCue-owned Ollama or LM Studio chat. It does not inspect or import
the runtime's own conversation files.

`GET /api/local-llm/chats/:chatId`

Returns finalized history plus the in-memory partial response, when a local
generation is running.

`POST /api/local-llm/chats/:chatId/messages`

Appends a user message and starts a streamed local generation.

`POST /api/local-llm/chats/:chatId/interrupt`

Aborts a DeskCue-owned local generation. A non-empty partial response is
persisted once as an interrupted assistant message; stream deltas are never
persisted.

The local-chat API also exposes bounded history modes, model/agent-mode updates,
pending LM Studio prompt recovery, preview/artifact commands, action responses,
an explicit Git refresh and exact change-set hydration. Consumers should use
the typed protocol client rather than assuming the chat detail response contains
unbounded history.

The corresponding routes are:

- `POST /api/local-llm/chats/import/lm-studio-desktop`;
- `GET /api/local-llm/chats/:chatId/change-sets/:changeSetId`;
- `POST /api/local-llm/chats/:chatId/git/refresh`, which refreshes and returns
  the chat detail with its bounded, read-only workspace Git snapshot;
- `PATCH /api/local-llm/chats/:chatId`;
- `PATCH /api/local-llm/chats/:chatId/agent-mode`;
- `PATCH /api/local-llm/chats/:chatId/model`;
- `POST|DELETE /api/local-llm/chats/:chatId/pending-lm-studio-prompt`;
- `POST /api/local-llm/chats/:chatId/preview`;
- `POST /api/local-llm/chats/:chatId/preview/artifacts`;
- `POST /api/local-llm/chats/:chatId/actions/:actionRequestId`

JSON bodies are bounded before route handling: ordinary API requests use a
512 KiB ceiling, Local LLM requests use 1 MiB, and only the LM Studio desktop
import route accepts up to 20 MiB of encoded JSON. The import validator still
limits the actual exported conversation content to 8 MiB; the larger transport
envelope accounts for JSON escaping. Access authentication runs before these
body parsers, except for the explicitly public pairing/recovery routes.

### Notifications And Browser Push

`GET /api/notifications/settings` and `PATCH /api/notifications/settings`

Read or update event routes and the Web Push, ntfy, Gotify, Telegram and webhook
provider settings. Secret values are not returned in delivery diagnostics.

`POST /api/notifications/test`

Sends one test through the selected provider.

`POST /api/notifications/telegram/pairing/start`

`POST /api/notifications/telegram/pairing/resolve`

Start and resolve the short-lived Telegram chat pairing flow.

`GET /api/push/status`

`GET /api/push/vapid-public-key`

`GET|POST /api/push/subscriptions`

`DELETE /api/push/subscriptions/:id`

`POST /api/push/test`

Manage browser-scoped Web Push subscriptions and test browser delivery. See
[Notifications](./notifications.md) for secure-context and persistence rules.

### Storage Maintenance

`GET /api/maintenance/storage`

Returns bounded storage usage and retention information.

`POST /api/maintenance/storage/compact`

Purges terminal managed-session history and logs, then compacts storage. It is
rejected while managed sessions are running.

`POST /api/maintenance/storage/migration-backups/clear`

Deletes migration backup files after the same no-running-sessions check.

### Daemon Logs And Metrics

`GET /api/daemon/logs`

Returns recent daemon JSONL log entries.

`GET /api/daemon/request-metrics`

Returns bounded in-memory request metric aggregates by logical endpoint. The
snapshot includes request count, average/p50/p95/p99 duration, response bytes,
status counts, read modes, `304` hit rate, per-session response bytes and
WebSocket counters for connection, reconnect, replay, ack, skipped log and
dropped replay events. Metrics intentionally exclude prompt text, transcript
bodies, diff bodies and access tokens.

`GET /api/daemon/source-agent-index`

Returns bounded source-agent index snapshot diagnostics: snapshot count,
refreshing count, snapshot TTL, storage file path, hashed cache keys and
session counts. It does not return transcript bodies or diff bodies.

### Security Settings

`GET /api/security/status`

Returns a read-only summary of the daemon access state: auth on/off, bind host,
public host, allowed origins, exposure level and risk warnings.

`GET /api/security/settings`

Returns editable access settings and their current source metadata. The response
includes the effective current value and the environment value for each editable
field, so the web UI can show when a saved web override is replacing `.env`.

Editable fields:

- `authRequired`
- `publicHost`
- `allowedOrigins`
- `pairingHosts`
- `storageMaxMb`
- `agentDataRoots`
- `runtimeEndpoints`

`PATCH /api/security/settings`

Body:

```json
{
  "authRequired": true,
  "publicHost": "<your-lan-ip>",
  "allowedOrigins": ["http://<your-lan-ip>:4100"]
}
```

Saves web overrides to `service/daemon-settings.json` under `DESKCUE_DATA_DIR`. The
daemon applies these fields immediately where possible. When enabling auth from
an unauthenticated local browser, the web client first creates a local access
device token, then saves auth, so the current browser does not lock itself out.
If the daemon returns an access bootstrap token, the web client stores it for future
HTTP and WebSocket requests.

For `npm run start`, the browser-facing origin is the daemon port. Use
`http://<your-lan-ip>:4173` in `allowedOrigins` only for `npm run dev` with the
Vite dashboard.

`DELETE /api/security/settings`

Deletes `service/daemon-settings.json` and recalculates editable settings from shell or
`.env` values, then built-in defaults. This is exposed in the web UI as
`Reset to env`.

### Daemon Logs

`GET /api/daemon/logs?limit=120`

Returns the latest daemon JSONL log entries from the configured daemon log file.
This is operational daemon logging, not managed-session stdout/stderr.

Returns:

```json
{
  "entries": [
    {
      "timestamp": "2026-06-23T17:12:50.995Z",
      "level": "info",
      "message": "WebSocket client connected",
      "context": {
        "path": "/ws?token=%5Bredacted%5D"
      }
    }
  ],
  "filePath": ".deskcue-data/service/logs/daemon.jsonl",
  "truncated": false
}
```

### Local Asset Access

`POST /api/assets/ticket`

Creates a short-lived URL for an allowed workspace/artifact file after checking
its managed/source-session scope. `GET /api/assets/ticket/:ticket` revalidates
the policy before serving it. Prefer tickets for browser-rendered assets.

`GET /api/assets/file?path=ABSOLUTE_PATH`

Serves a local absolute file path. Add `download=1` to force download behavior.

`GET /api/assets/local-image?path=ABSOLUTE_PATH`

Serves only supported local image file types.

## WebSocket

Endpoint:

```text
ws://localhost:4100/ws?token=<deskcue-access-token>
```

### Client Event

DeskCue clients currently send a presence event to indicate which managed session is being viewed:

```json
{
  "type": "presence",
  "sessionId": "managed-session-id-or-null"
}
```

### Server Events

The daemon emits:

- `workspace.created`
- `agent.session.updated`
- `session.created`
- `session.updated`
- `session.git`
- `session.preview`
- `session.log`

Session-bearing events include decorated session summaries with:

- `viewerCount`
- `canSendInput`
- `inputBlockedReason`

`session.log` emits:

```json
{
  "type": "session.log",
  "payload": {
    "sessionId": "managed-session-id",
    "log": {
      "id": "log-id",
      "timestamp": "2026-06-16T00:00:00.000Z",
      "stream": "stdout",
      "text": "..."
    }
  }
}
```

## Error Behavior

Most command endpoints return `400` with:

```json
{
  "error": "Human-readable message"
}
```

`404` is used when a requested session or agent chat cannot be found.

## Current Constraints

- Native folder picking is restricted to host-local requests
- Access pairing is local/LAN device-token based; it is not hosted user identity
- Device revoke requires the current token when auth is enabled
- Preview uses the authenticated daemon-owned loopback proxy. Path-based proxy
  compatibility still depends on the preview app: root-relative runtime URLs
  are rewritten for HTML/CSS and common browser APIs, but unusual custom URL
  construction or service-worker scope may require a future isolated preview
  origin
- Attach behavior depends on the source runtime
- Codex can only have one practical writer for a thread. DeskCue can continue an active Codex thread from another device by resuming it with a prompt, but that can create a new Codex/MCP lifecycle
- WebSocket presence currently tracks managed-session viewers only
