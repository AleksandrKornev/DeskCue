# DeskCue Architecture

## Overview

DeskCue has one simple ownership rule: the daemon on the user's machine is in charge of execution and local data. The React dashboard talks to that daemon over HTTP and WebSocket. Shared packages keep the wire contracts and runtime metadata in one place.

```text
Browser / PWA
    | HTTP + WebSocket
Local DeskCue daemon
    |-- workspaces and process trees
    |-- Codex and Claude Code source sessions
    |-- Ollama and LM Studio local chats
    |-- SQLite, notifications, files, changes, preview relay
    `-- optional outbound DeskCue Cloud connector
```

## Daemon

`apps/daemon` owns:

- registered workspaces and filesystem reads
- managed process start, input, interruption, and shutdown
- source-agent discovery and indexed transcript hydration
- DeskCue-owned Local LLM chats
- Git and workspace change evidence
- preview port discovery and relay
- notifications and durable retries
- SQLite persistence, recovery, retention, and diagnostics
- HTTP and WebSocket servers

Long-running resources belong to application services. HTTP routes validate and delegate requests; they do not start detached lifecycle work themselves.

## Web dashboard

`apps/web` owns access, selection, rendering, and user interaction. Large data such as transcripts, files, and diffs is loaded over HTTP. WebSocket is kept for small events and invalidations.

Connection, selection, and operation epochs stop a late response from an old daemon, socket, or session from updating the current UI.

## Protocol and adapters

`@deskcue/protocol` owns the public wire DTOs and parsers. It is a dependency leaf with explicit exports.

`@deskcue/adapters` describes runtime kinds and capabilities. Runtime-specific discovery, transcript parsing, resume, interruption, and compatibility stay at adapter boundaries.

## Session model

### Managed sessions

Managed sessions are process-backed and owned by DeskCue. A process is recorded as terminal only after its exit is confirmed. If shutdown cannot confirm that exit, DeskCue keeps the session in a recovery-required/read-only state rather than pretending it stopped cleanly.

### Source-agent sessions

Codex and Claude Code conversations are discovered from their native local stores. DeskCue reads limited transcript windows and only offers a writable resume path when the runtime and current ownership state make that safe.

### Local LLM chats

Ollama and LM Studio chats created in DeskCue are DeskCue-owned. They use the runtime's local HTTP API, persisted history, generation limits, tool policy, and explicit interruption. Native compaction is shown only when the runtime reports it.

## Persistence and recovery

SQLite at `.deskcue-data/service/deskcue.sqlite` is the authoritative service store. During the public alpha, the consolidated version `1` schema also holds the durable prompt recovery state machine. Known alpha schema shapes are normalized through a data-preserving compatibility path; version `1` becomes immutable after the first stable release.

Prompt delivery state is written before transport starts. A delivery left in `prepared` is known not to have reached the runtime. Once dispatch starts, its outcome stays unknown until the source transcript proves that the prompt was accepted. DeskCue never resends an ambiguous prompt automatically.

The source-backed Codex and Claude Code prompt subprocess is designed to keep running across a graceful daemon restart. After startup, only a delivery with durable identity for an observed native prompt is shown as `checking`; the source-detail sync then waits for that same turn's terminal entry. Missing identity or a missing terminal outcome becomes `outcome_unknown`. A `not_sent` prompt can be retried safely. DeskCue does not offer a resend action for an unknown outcome because it may duplicate work.

Generic CLI processes and DeskCue-owned Ollama or LM Studio generations remain daemon-managed and are not promised to survive a daemon restart.

Corrupt rows are validated and quarantined instead of silently becoming empty state. Maintenance applies retention and quotas without blocking active work.

DeskCue-owned local chat history stays under `.deskcue-data/deskcue-chats/`. Source-agent transcripts remain owned by their source runtime.

## Realtime and hydration

- WebSocket messages have a small maximum payload and protocol validation
- Replay is limited by count and bytes
- Transcript, details, tools, files, and changes use paged or exact HTTP reads
- ETag/304, in-flight deduplication, response limits, and rate limits reduce repeated work
- There is no public `fullTranscript` option that can create an unbounded memory path

## Preview

Local Preview and Cloud Preview use the same daemon engine for target resolution, request policy, rewriting, cookie isolation, HTTP transport, and WebSocket transport. Short-lived owner-scoped capabilities select the target without exposing raw relay credentials in JSON, logs, or diagnostics.

External requests have two modes:

- `device-direct`: the browser reaches external destinations itself
- `deskcue-host`: the host relays HTTP(S), SSE, streaming, and WebSocket traffic so requests use the host's DNS and VPN access

Host mode applies SSRF controls, pinned DNS resolution, isolated cookie jars, admission limits, deadlines, and payload limits.

The shared engine forwards approved application headers, including cookies and authorization, and handles redirects, response cookies, HTTP streaming/SSE, Range responses, and WebSocket traffic. Cloud gives Preview content a short-lived hostname separate from the authenticated Cloud application origin.

The current public-alpha deployment still uses wildcard Preview origins under the same registrable `deskcue.io` site. That is a weaker same-site boundary than a dedicated content domain, so moving Preview to a separate registrable domain remains planned hardening.

Browser viewer identity is only a namespace for daemon-side cookie and admission isolation; it is not a daemon credential. Cloud service cookies are stripped at the boundary, while application cookies stay scoped to the Preview hostname and daemon jar.

The path relay handles generic URLs and runtime traffic, but it cannot make every origin-sensitive app transparent. Framework-specific handling may still be needed when a framework embeds root-relative URLs in executable code. Service workers, WebTransport, and every strict origin-sensitive application are not universally supported.

## Access control

- Authentication is enabled by default
- One-time pairing creates a separate revocable credential per browser/device
- SQLite stores credential hashes, not plaintext credentials
- Only the exact DeskCue loopback origin receives the documented local bootstrap behavior; unrelated localhost applications are not trusted
- Disabling authentication is an explicit trusted-development override
- Direct public-internet exposure is unsupported

## Notifications

Web Push, ntfy, Gotify, Telegram, and webhook delivery share admission limits, deadlines, cancellation, diagnostics, and retention. Retry count is fixed and the durable outbox has TTL and total-count limits. Sensitive configuration and message bodies are not logged.

## Optional cloud boundary

DeskCue Cloud is optional. The daemon connects outbound and remains in charge of processes, local permissions, files, runtime credentials, VPN/DNS access, and Preview networking.

The normal enrollment flow is browser-confirmed. The daemon creates a short-lived attempt, opens a Cloud URL containing only its public identifier, and keeps the independent attempt secret in authenticated local secret storage. After same-origin login, registration, and email verification, the user reviews the machine metadata and approves it. The daemon polls for completion. Public scheduling state is durable in SQLite, while secret material stays in the encrypted envelope. Startup resumes an unexpired attempt. Cloud keeps the completed credential result in an encrypted attempt-scoped envelope until it expires, so losing the first response does not force a blind re-enrollment. The copy/paste one-time ticket flow remains a manual fallback rather than the main UX.

Cloud v1 keeps a stable installation identity, negotiates protocol and capabilities, tracks acknowledgements and replay cursors, deduplicates events, and uses a small durable outbox. The default projection contains only opaque session id, runtime, lifecycle status, reply state, and update time. Source, titles, paths, transcripts, diffs, prompts, and provider secrets are not part of that payload.

`deskcue.read` is disabled by default. When the user enables it for a machine, Cloud can request the same overview, session, transcript, and changes data used by the local UI. It can also request short-lived asset tickets for files already accepted by the local asset policy, including registered workspace files and session-owned runtime locations.

`deskcue.files` adds directory browsing and direct file reads for registered workspaces. `deskcue.read` asset tickets and `deskcue.files` are different API surfaces over the same trusted local file boundary; either can transfer sensitive workspace content. Their bodies are streamed on demand and are not added to the durable outbox or to local/Cloud logs.

TLS/WSS protects transport, but the current relay is not end-to-end encrypted. DeskCue Cloud is not designed to inspect or store relayed content; it handles plaintext transiently in memory while forwarding requests and responses.

`deskcue.control` enables only source-session attach, managed-session input, and managed-session interrupt. Every mutation has a client command id. The daemon stores a limited durable receipt with the operation, an input digest, and a sanitized outcome, never the prompt body. A retry with the same operation and input returns the recorded outcome. Reusing an id for different input is rejected, and a receipt left pending by a crash stays ambiguous instead of causing the prompt to be repeated. Host-specific force-stop and external process fallbacks are not part of the Cloud allowlist.

`deskcue.realtime` carries the existing small DeskCue WebSocket protocol over the authenticated outbound machine connection. It is an online-only channel with connection and message limits; large transcript/file hydration still uses the typed HTTP read facade.

`deskcue.preview` uses a separate data connection and short-lived browser lease. It does not turn the control connection into a general HTTP proxy. HTTP request and response bodies are credit-driven streams. Active SSE and other streaming responses use activity-based idle deadlines, while WebSockets keep message and buffer limits. If the browser, Cloud service, or daemon connection drops, in-flight requests and sockets fail instead of being replayed. The daemon reconnects outbound with limited backoff, and the browser gets a new lease before retrying navigation. Reconnect never widens the stored Preview target or local capability grant.

Preview transport is runtime-neutral. Showing DeskCue-owned Ollama or LM Studio chat routes in the embedded Cloud UI is a separate product integration.

SQLite v1 reserves the Cloud foundation before the first release: installation and connection metadata, negotiated capabilities, sync cursors, inbound receipts, and a 64 KiB metadata-only outbox. Large transfers store only consent and logical resource references; bodies are streamed when requested. SQLite stores an opaque encrypted-envelope reference and public identity material, never raw Cloud credentials or connection tokens. The envelope uses a dedicated local master key outside SQLite and authenticated encryption.
