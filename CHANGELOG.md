# Changelog

Notable changes to DeskCue will be documented in this file.

DeskCue follows [Semantic Versioning](https://semver.org/) for published
releases.

## Unreleased

### Added

- Added self-contained Linux x64 and arm64 release builders for standalone
  archives and Debian packages
- Added per-user Linux installation, systemd Host lifecycle, autostart and
  verified standalone update handoff with rollback
- Added a native Windows/Linux release matrix that creates one strict update
  manifest, complete SHA-256 checksums and a draft GitHub Release

### Changed

- Extended installed data paths, Host startup and update artifact selection
  across Windows and glibc Linux
- Added Ubuntu 22.04 to the canonical repository CI matrix

## 0.2.0 - 2026-09-15

### Added

- Added an unsigned per-user Windows x64 installer with a supervising Host,
  native tray, bundled runtime, CLI shim, autostart support and preserved user
  data
- Added Host-managed lifecycle, diagnostics and manual update flows through
  `deskcue start`, `stop`, `restart`, `status`, `logs`, `doctor`, `update` and
  `autostart`
- Added bounded, verified update downloads with stable and beta manifest
  channels, update-readiness draining, database backup, rollback and recovery
- Added in-chat subagent discovery and navigation without placing subagent
  sessions in the main recent-chat list

### Changed

- Made session status, waiting, interruption and completion states more
  truthful across Codex, Claude Code and local runtimes
- Improved the mobile control room, session navigation, file and diff review,
  attachment previews, modal focus order and narrow-screen accessibility
- Made tray phone pairing open the browser pairing dialog and clarified local
  access, Cloud connection and runtime diagnostics
- Expanded CLI status with live Host, daemon, runtime and chat information and
  made logs bounded by default with explicit follow and full-export modes

### Fixed

- Hardened prompt ownership, resume, reconnect, interrupt and recovery paths so
  stale source state cannot replace or misreport an active turn
- Hardened transcript parsing, asset access, Preview proxying, Git operations,
  process ownership and update handoff boundaries
- Updated audited dependencies so both production and full dependency audits
  report no known vulnerabilities at release time

## 0.1.1 - 2026-08-20

### Fixed

- Preserved Vite module loading and HMR through authenticated proxied Preview
- Prevented prompt replacement decisions from using stale source-session state
- Released the current Codex source process before starting a follow-up resume

## 0.1.0 - 2026-08-17

### Added

- Source-checkout local dashboard for reviewing and controlling AI agents from
  a desktop or phone
- Codex and Claude Code session discovery, bounded transcript reading, and
  supported resume flows
- DeskCue-owned local chats through Ollama and LM Studio
- Generic CLI sessions with streamed output and input
- Chat, Changes, Files, and Preview views for reviewing agent work
- Authenticated LAN access with one-time pairing and revocable device
  credentials
- Optional notifications through Web Push, ntfy, Gotify, Telegram, and
  webhooks
- Optional public-alpha DeskCue Cloud connector for remote review and control

### Known limitations

- DeskCue is installed from source; packaged installers and container images
  are not available yet
- Windows and Ubuntu are tested. macOS runtime support still needs a complete
  real-device smoke pass
- Runtime capabilities differ, so attach, resume, interrupt, and compaction are
  not available for every session
- Preview does not universally support service workers, WebTransport, or every
  strict origin-sensitive application

See the [README](./README.md#known-limitations) for the current detailed list.
