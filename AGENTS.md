# DeskCue Agent Guide

You are working inside **DeskCue**.

DeskCue is an open-source, local-first dashboard for watching, reviewing, and redirecting CLI AI agents running on the user's machine.

This file is intentionally self-contained. Do not assume access to parent-level planning or product documents when working in this repository.

## Mission

DeskCue exists so a user does not need to babysit a terminal while an AI agent is running.

The user should be able to:

- run Codex or Claude Code sessions, or start another tool through Generic CLI;
- inspect session status from desktop or phone;
- review logs, changed files, git diff, and live preview;
- notice when the agent finishes, gets stuck, or needs input;
- send a new instruction back to the running process from the dashboard.

DeskCue is not an LLM provider, does not own the user's agent credentials, and
is not a mobile IDE. The open-source local application can optionally connect
to DeskCue Cloud, but the local product must remain fully usable without it.

## Product Principles

- Local-first.
- Self-hostable.
- Bring your own agents.
- Bring your own models.
- Artifact-first, not chat-first.
- Mobile-friendly, not desktop-clone mobile UI.
- Human-in-the-loop by design.
- Cloud integration is optional and must not weaken the local-first path.
- Keep the MVP narrow, practical, and end-to-end usable.

## Current MVP Loop

The first working loop matters more than advanced features:

1. Add a local workspace.
2. Start a generic CLI agent command.
3. Stream stdout and stderr.
4. Show session status.
5. Show changed files and git diff.
6. Open a live preview for a local port.
7. Use the dashboard from desktop or phone.
8. Send input back to the running agent.

This loop remains the primary product path and must work reliably without a
Cloud account or hosted service.

## Optional Cloud Boundary

The daemon may establish an outbound-only connection to DeskCue Cloud. Cloud
access is capability-based and locally consented; do not infer one capability
from another:

- `session.summary` publishes only the bounded metadata projection needed for
  the Cloud machine/session list.
- `deskcue.read` enables bounded, typed, transient Remote DeskCue reads.
- `deskcue.control` enables only `source.attach`, `managed.input`, and
  `managed.interrupt`, with durable command-id deduplication.
- `deskcue.realtime` enables the bounded transient browser WebSocket bridge.

Do not replace these operations with an arbitrary HTTP or WebSocket proxy.
Prompts used by control requests, transcripts, diffs, paths, pair codes,
device or machine credentials, and provider credentials must not be persisted
by Cloud. Disabling Cloud or losing Cloud connectivity must not disable local
DeskCue.

## Repository Shape

```text
DeskCue/
  apps/
    web/
    daemon/
    cli/
  packages/
    protocol/
    adapters/
  docs/
  examples/
```

Main areas:

- `apps/web`: React dashboard UI.
- `apps/daemon`: local API, process runner, git visibility, runtime discovery, and session persistence.
- `apps/cli`: lightweight CLI entrypoint.
- `packages/protocol`: shared TypeScript contracts.
- `packages/adapters`: shared adapter metadata, capabilities, launch normalization,
  and resume-command helpers used by the current runtime integrations.

## Working Rules

- Prefer simple working code over premature abstraction.
- Declare module-scope runtime constants, helpers, and classes before their
  first use. Keep files readable top-to-bottom without relying on hoisting;
  explicit recursion is the only local exception.
- Preserve the local-first architecture.
- Do not introduce billing, teams, SSO, or managed-model assumptions into the local MVP path.
- Do not assume DeskCue owns the user's accounts, keys, or model access.
- Keep adapter-facing logic modular so future agent-specific integrations remain possible.
- Treat mobile usability as a core product requirement, not a polish item.
- Avoid destructive actions unless explicitly requested.

## Implementation Guidance

- Read `README.md` before making broad changes.
- Keep changes aligned with the existing TypeScript monorepo layout.
- Reuse shared contracts in `packages/protocol` instead of duplicating shapes in app code.
- Keep the web dashboard focused on review, status, transcript, diff, and preview workflows.
- Keep the daemon focused on local process control, streaming, git visibility, and preview access.
- Keep Cloud-specific behavior behind the optional outbound connector and
  explicit read/control/realtime capability boundaries.
- When adding features, prefer improving the main loop over side systems.

## Validation

Before wrapping up, run the narrowest relevant checks when possible:

- `npm run typecheck`
- `npm run build`
- `npm run lint`

If you only changed one package, prefer the workspace-specific command instead of the full repo command.
