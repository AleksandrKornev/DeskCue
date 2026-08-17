# Security Policy

DeskCue is a local-first tool that can start and control processes on the
machine where the daemon runs. Treat it like local developer infrastructure, not
as a public internet service.

## Supported Versions

DeskCue is currently a public-alpha source-checkout project. Security fixes are
made on the main development line until a formal release policy exists.

## Reporting a Vulnerability

Report vulnerabilities privately through GitHub's private vulnerability
reporting when it is enabled for the repository, or email
<security@deskcue.io>.

Include the affected version or commit, expected impact, reproduction steps and
any suggested mitigation when available. Do not include credentials, access
tokens, private source code or other unrelated sensitive data in the report.
Please do not publish exploit details before maintainers have had a reasonable
opportunity to investigate and respond.

## Local Access Model

- The daemon binds to `0.0.0.0` by default so the dashboard can be reached over a trusted LAN
- Authentication is required by default; LAN access uses one-time pairing and a per-device token
- Set `DESKCUE_BIND_HOST=127.0.0.1` when only loopback access is needed
- Set `DESKCUE_AUTH_REQUIRED=false` only in an isolated trusted development environment
- Do not expose the daemon directly to the public internet
- `DESKCUE_ALLOWED_ORIGINS` should be kept narrow when binding beyond loopback
- Remote dashboard WebSocket connections require the paired-device credential
  during setup. The exact DeskCue-owned loopback browser origin uses the same
  host and origin checks as local HTTP access

## Process Execution Model

DeskCue runs commands chosen by the local user inside registered workspaces. It
does not sandbox those commands.

Only run commands and agents that you trust. Agent credentials, model accounts,
API keys and local tool configuration remain owned by the user and their local
runtime.

## Preview Model

DeskCue relays selected local preview ports through the daemon. The relay uses
short-lived capabilities, request bounds, and host-side network controls, but
it is not a general-purpose security sandbox or public hosting layer.

Only preview applications and external destinations that you intentionally
started and trust. Keep the daemon behind a trusted LAN, VPN, or properly
configured reverse proxy.

## Data Locations

Source-checkout daemon data is stored under:

```text
.deskcue-data/
```

This includes the SQLite database, daemon logs, local chat data, paired-device
credential hashes, and migration backups. Do not commit this directory.
