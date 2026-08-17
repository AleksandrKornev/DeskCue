# Roadmap

DeskCue is currently focused on making the local review-and-control loop solid
for one developer running agents on their own machine.

## Current Alpha Scope

- Discover and resume supported Codex and Claude Code sessions
- Run DeskCue-owned Ollama and LM Studio chats and generic CLI commands
- Show live status, transcripts, tool activity, files, diffs, and logs
- Relay a selected local preview port through the daemon
- Open a paired dashboard from desktop or phone on the same LAN
- Send follow-up prompts and supported interrupt requests
- Persist local history, prompt delivery state, and notification delivery in
  SQLite
- Deliver optional Web Push, ntfy, Gotify, Telegram, and webhook notifications
- Connect outbound to optional DeskCue Cloud for metadata sync and the remote
  read, control, realtime, file, and Preview permissions the user enables

## Next Product Steps

- Make capabilities more consistent across Codex, Claude Code, Ollama, and LM
  Studio
- Make recovery from ambiguous prompt outcomes easier to understand and act on
- Add packaged distribution and broader cross-platform install validation
- Improve LAN onboarding and troubleshooting
- Push Preview further with screenshots, console capture, before/after state,
  and stronger isolation for origin-sensitive apps

## Optional Cloud Direction

DeskCue Cloud stays optional. The local daemon remains in charge of processes,
files, runtime credentials, network access, and Preview policy. Cloud only gets
the permissions the user enables for that machine, and local DeskCue keeps
working without a Cloud account or connection.

## Deliberately Later

- Accounts, teams, SSO, RBAC, or billing
- Universal Preview compatibility for service workers, WebTransport, and every
  strict origin-sensitive web platform feature
- Multi-user collaboration
- Full mobile IDE features
- LLM inference or model hosting

Cloud features should stay optional and should never become a requirement for
local use.
