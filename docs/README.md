# DeskCue Docs

These docs cover setup, architecture, security, and the implementation details
that matter when working on DeskCue.

If you only want to run DeskCue, start with [Installation](./installation.md).
If you are changing the code, [Development Notes](./development.md) and
[Architecture](./architecture.md) are the best entry points.

## Getting started

- [Installation](./installation.md)
  Install from source, pair another device, run diagnostics, and remove local
  data

- [Environment Configuration](./environment.md)
  `.env` loading, variable precedence, and common daemon/runtime settings

- [Secure LAN Setup Checklist](./secure-lan-setup.md)
  Set up protected access from a phone or another browser on your network

- [Notifications](./notifications.md)
  Configure Web Push, ntfy, Gotify, Telegram, and webhooks

- [Examples](./examples.md)
  Generic CLI smoke commands and runtime-specific notes

## How DeskCue works

- [Architecture](./architecture.md)
  System structure, data flow, persistence, sessions, Preview, and the optional
  Cloud boundary

- [Agent Adapters](./adapters.md)
  Runtime support levels, adapter boundaries, and how to add another runtime

- [Frontend Architecture](./frontend-architecture.md)
  Web source layout, route and feature colocation, reserved file names, and
  visual inspection paths

- [Daemon API](./daemon-api.md)
  HTTP endpoints, WebSocket events, payload shapes, and integration behavior

- [Security Notes](./security.md)
  Local access, process execution, LAN guidance, and Cloud data handling

- [Threat Model](./threat-model.md)
  Assets, trust boundaries, intentional auth exceptions, and residual risks

## Development and releases

- [Development Notes](./development.md)
  Repository commands, package responsibilities, local data, and implementation
  constraints

- [Distribution](./distribution.md)
  The current source-checkout alpha path, smoke checks, and packaging limits

- [Roadmap](./roadmap.md)
  What is in the alpha, what comes next, and what is deliberately later

- [Recovery Notes](./recovery.md)
  Recover from failed SQLite migrations and unsupported future schemas

- [Release and Migration Playbook](./release-migrations.md)
  Add, verify, release, and support SQLite schema migrations

## Scope

Everything in this directory is public repository documentation. It should be
self-contained and should not depend on private planning notes outside the
repository.
