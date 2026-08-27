# Security Notes

DeskCue is local-first developer infrastructure. It can start local processes,
read workspace data, and expose the dashboard over localhost or LAN. That makes
its access settings important: treat the daemon like any other local developer
tool that can act on your machine.

## Recommended Defaults

- Keep authentication enabled unless you are in an isolated development setup
- Use `DESKCUE_BIND_HOST=127.0.0.1` when you only need access from the host
  machine
- Pair browsers and phones with the one-time pairing flow instead of copying
  access tokens by hand
- Do not expose the daemon directly to the public internet
- Keep `DESKCUE_ALLOWED_ORIGINS` narrow when binding beyond loopback
- Do not commit `.deskcue-data`, logs, device token hashes, or database backups

Source checkout defaults to `DESKCUE_AUTH_REQUIRED=true`, including LAN use.
Set it to `false` only when the network and machine are fully trusted.

## Access Protection

DeskCue requires authentication by default. The source-checkout daemon still
binds on LAN so another device can reach it, while pairing and per-device tokens
protect the control API.

When authentication is enabled:

- HTTP API requests must send `Authorization: Bearer <access-token>`
- WebSocket clients must include the token in the connection query
- the exact DeskCue UI opened through loopback can use protected HTTP and
  WebSocket APIs without pairing, including in an incognito window
- other browsers and devices should use the one-time pairing flow

The loopback exception is deliberately narrow. A request must come from the same
loopback host and port as DeskCue, or carry the browser-controlled same-origin
fetch signal. A page on another localhost port and a direct request without
browser context still need a device token. This prevents an unrelated local web
app from inheriting DeskCue access just because it also runs on localhost.

If authentication is disabled and the daemon is reachable from another machine,
anyone who can reach it can control DeskCue sessions. That includes starting or
stopping commands, sending prompts, reading exposed session data, and using
Preview or runtime endpoints.

CORS is not an access-control boundary. It restricts browser pages, but it does
not stop `curl`, scripts, or other direct HTTP clients on the same network.

DeskCue also does not try to protect against a native process already running as
the same operating-system user. Such a process can imitate browser headers and
usually has access to the same local files anyway.

The Settings page (`/settings`) shows the current security state:

- access protection on/off
- bind host
- public host
- allowed origins
- exposure level
- risk level and warnings

The page can also save local access settings. It does not edit `.env` files.
Saved values go to `service/daemon-settings.json` under `DESKCUE_DATA_DIR` and
override matching `DESKCUE_*` environment defaults until changed again. The UI
shows both the effective value and the environment value. `Reset to env` removes
the web override file and returns those fields to shell or `.env` values.

When auth is enabled from the web UI, the browser obtains and stores a local
device token before saving `authRequired=true`. Pair new browsers or devices
from the host machine with a one-time device link. The link uses the configured
public host when present, otherwise DeskCue tries a detected LAN IPv4 address.
The UI warns when the daemon is still bound to loopback because another device
cannot reach the host's `127.0.0.1`.

The Connections tab separates actions for the current browser from actions for other
devices:

- `Forget this browser` revokes the current browser token on the daemon and
  removes its local copy
- `Revoke other devices` revokes every other active device token while keeping
  the current browser paired

Each paired browser or device gets its own token. The daemon stores only token
hashes in SQLite, never plaintext device tokens.

The host-local recovery-code endpoint is for lockout recovery. A recovery code
is single-use and short-lived, so treat it like a temporary credential and do
not paste it into logs or issue trackers.

Browser push subscriptions are also scoped to a browser/device. Removing a push
session stops DeskCue delivery to that endpoint, but it does not change the
browser's OS-level notification permission. Push subscription keys and provider
credentials are sensitive local configuration.

See [Threat Model](./threat-model.md) for the exact auth exceptions and residual
risks. See [Secure LAN Setup Checklist](./secure-lan-setup.md) for the recommended
phone/browser setup.

## What DeskCue Does Not Do

- It does not sandbox commands or agent runtimes
- It does not manage LLM accounts, API keys, or model credentials
- It does not provide hosted identity, SSO, or RBAC
- The optional Cloud connector only relays the Preview target configured in
  DeskCue. In `deskcue-host` mode it can also follow application-requested
  HTTP(S) destinations through the host under SSRF and pinned-DNS policy. It is
  not a general-purpose proxy and cannot choose arbitrary local services

## Cloud Data Handling

Local DeskCue must keep working without Cloud. When Cloud is enabled, source
code, transcripts, diffs, and artifacts should be treated as sensitive project
data.

The current rules are:

- start with metadata, source versions, and event cursors before transferring
  heavier content
- use an outbound daemon-to-Cloud connection; Cloud does not require inbound
  access to the user's machine
- relay transcript chunks and diffs only after the user enables `deskcue.read`
  for that machine
- relay follow-up prompts and managed interrupts only after the user separately
  enables `deskcue.control`; arbitrary paths and host-process fallbacks stay out
  of that command surface
- give every remote mutation a stable command id and keep a daemon-side receipt
  with only its input digest and sanitized result, never prompt plaintext
- never blindly repeat a command whose post-crash outcome is ambiguous
- use `deskcue.realtime` only for the existing small WebSocket protocol; large
  hydration stays on typed HTTP reads
- treat both `deskcue.read` asset tickets and `deskcue.files` workspace browsing
  as access to sensitive local files. Enable either only for a Cloud deployment
  you trust
- keep Cloud Preview behind its own local grant and restrict it to the stored
  target plus policy-checked HTTP(S) egress in explicit `deskcue-host` mode
- move Preview content to a separate registrable domain when practical. The
  current public alpha uses wildcard origins under `deskcue.io`, which gives a
  weaker same-site boundary
- strip DeskCue/Cloud service cookies and relay credentials before target
  requests. Application cookies, authorization, and custom headers only pass
  through the Preview header policy
- apply backpressure, admission/body/message limits, idle timeouts, and a hard
  lease expiry to active Preview HTTP/SSE and WebSocket traffic
- fail in-flight Preview work on disconnect instead of replaying it
- keep remote paths and operations on an allowlist with request, response,
  concurrency, and deadline limits
- require scoped auth for Cloud/device actions that name a workspace, session,
  or artifact
- run redaction hooks before payloads leave the daemon
- keep the local capability grant authoritative; disconnect or re-enroll without
  a grant to return to metadata-only sync
- do not describe TLS/WSS as end-to-end encryption. DeskCue Cloud is not
  designed to inspect or store relayed content, but the current relay handles
  plaintext transiently in memory while forwarding it
- never include prompt text, access tokens, transcript bodies, or diff bodies in
  request metrics
- rate-limit heavy hydration and artifact requests by device/session/workspace
- record audit events for remote actions that can affect a local agent or local
  process

## Data Stored Locally

Source-checkout data lives under:

```text
.deskcue-data/
```

Current paths include:

- `service/deskcue.sqlite`: workspaces, sessions, access records, notification
  settings/outbox, logs, and preview state
- `service/logs/daemon.jsonl`: operational daemon logs
- `service/deskcue.sqlite.backup-*`: migration backups
- `deskcue-chats/`: DeskCue-owned Ollama and LM Studio conversations

Provider tokens, Web Push subscription keys, transcripts, and local LLM chat
history should have the same filesystem protection as source code.

## Reporting Security Issues

See [Security Policy](../SECURITY.md).
