# Threat Model

DeskCue runs on a developer machine and can start processes, send input to
agents, read workspace metadata, show logs, and serve selected local artifacts.
This document spells out what DeskCue protects, where those trust boundaries
stop, and which risks remain intentionally outside the product.

## Assets

- Local agent sessions and their prompt/input channels
- Workspace paths, file names, diffs, logs, and selected artifacts
- Device access tokens, token hashes and one-time pairing codes
- Push subscription records and notification delivery metadata
- DeskCue Cloud machine credentials, durable relay cursors and metadata-only
  outbox records

## Trust Boundaries

- The DeskCue-owned loopback browser origin is trusted for stateless local UI
  access. Other loopback browser origins are not trusted
- LAN access is convenient but not inherently trusted
- Reverse proxy headers are not a trust boundary by themselves
- Browser CORS is not a security boundary for direct HTTP clients
- DeskCue does not provide hosted identity, user accounts, SSO, RBAC, or command
  sandboxing
- The optional Cloud boundary is an outbound connection to a user-selected
  HTTPS origin. HTTP is accepted only for loopback development

## Intended Protections

- With `DESKCUE_AUTH_REQUIRED=true`, protected HTTP API routes require a Bearer
  token or `x-deskcue-token`, except for the exact DeskCue-owned loopback UI
- WebSocket `/ws` applies the same token and exact loopback-origin policy
- One-time pairing links are created only from the host computer
- Pairing links use short-lived codes, active-code limits, and attempt limits
- Pairing creates one device token per browser or device. The daemon stores only
  token hashes in SQLite
- Revoke current device invalidates the current browser token on the daemon and
  removes the local browser copy
- Revoke other devices invalidates other active device tokens while keeping the
  current browser paired
- Local asset routes are limited to registered workspaces and still go through
  access middleware when auth is enabled
- Forwarded loopback addresses are ignored unless the direct socket hop is
  loopback, which prevents a LAN client from spoofing host-local bootstrap
  access with `X-Forwarded-For: 127.0.0.1`
- The token-free local UI exception requires a loopback socket and loopback
  `Host`, plus either an exact same-host `Origin` (including the port) or the
  browser-controlled `Sec-Fetch-Site: same-origin` signal. A different
  localhost port and a raw request without browser context do not qualify
- Cloud machine credentials are stored outside SQLite in an AES-GCM envelope;
  the dedicated master key and envelope use owner-only file modes where the OS
  supports them. Relay connection tokens are short-lived and memory-only
- The Cloud relay URL must use WSS (WS only for loopback development), match the
  enrolled Cloud origin, contain the expected machine path, and carry its token
  only in the `Authorization` header
- Cloud v1 durably projects only opaque session id, runtime, lifecycle status,
  reply state and update time. Optional `deskcue.read` is advertised only after
  explicit local consent and carries size-bounded transcript/diff responses
  transiently. The same grant may relay a short-lived asset ticket and bounded
  bytes directly from any file accepted by the local asset policy, including
  registered workspace files and trusted runtime temporary directories. Those
  files may contain credentials; Cloud does not create a durable copy. A
  separate `deskcue.control` grant permits only source attach, managed input and
  managed interrupt. Durable local command receipts contain an input digest and
  sanitized result, not prompt plaintext; ambiguous crash outcomes are not
  repeated automatically. `deskcue.realtime` carries only the bounded live
  protocol while both endpoints are connected. Cloud does not persist or log
  these bodies. TLS/WSS is not end-to-end encryption: DeskCue Cloud is not
  designed to inspect relayed content, but plaintext exists transiently in
  service memory while requests and responses are forwarded. Session and
  control operations do not automatically include provider credentials
- The separately granted `deskcue.files` capability mirrors the trusted local
  Files UI by adding directory browsing and direct reads for registered
  workspaces. It and the asset-ticket path above are separate operation
  surfaces, not separate confidentiality levels. Grant either capability only
  to a trusted Cloud deployment and revoke it when remote file access is not
  needed

## Intentional Exceptions

These exact routes do not require a Bearer token:

- `GET /api/health`, which exposes only daemon liveness
- `GET /api/access/link`, which remains host-local
- `GET /api/access/link/:pairCode/status`, where the unexpired pairing code is
  the capability and the response exposes only its current state
- `POST /api/access/pair`, which exchanges a short-lived, single-use pairing
  code and is protected by attempt limits
- `POST /api/access/recover`, which exchanges a single-use recovery code and is
  protected by attempt limits
- `GET /api/assets/ticket/:ticket`, where the short-lived, owner-scoped ticket
  is the capability and its file policy is revalidated before every response

Preview resource paths under `/api/preview/sessions/:id` and
`/api/preview/local-llm/:id` also bypass the device Bearer token because they
authenticate with a short-lived, owner-scoped Preview ticket. Ticket issuance
still requires the normal device access check. The remaining protocol-level
exceptions are `OPTIONS` preflight requests and protected HTTP or WebSocket
requests made by the exact DeskCue-owned loopback browser origin described
above.

## Residual Risks

- If auth is disabled and the daemon is reachable on LAN, anyone on that network
  can control local DeskCue sessions
- A reverse proxy in front of the daemon needs a reviewed trusted-proxy model.
  Do not expose DeskCue through a public proxy without HTTPS and additional
  access controls at the proxy
- Bearer tokens are long-lived until device revoke. Keep paired browsers and
  devices under the same trust assumptions as local developer tooling
- DeskCue runs user-provided local commands; it is not a sandbox
- A native process running as the same operating-system user can imitate HTTP
  browser headers and access the user's local DeskCue data. DeskCue's local auth
  boundary protects LAN clients and unrelated browser origins; it is not a
  sandbox against a compromised host account
- The encrypted Cloud envelope protects database copies and accidental
  disclosure, but it is not a boundary against malware running as the same OS
  user because that process can also read the local master key
