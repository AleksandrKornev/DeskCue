# Changelog

Notable changes to DeskCue will be documented in this file.

DeskCue follows [Semantic Versioning](https://semver.org/) for published
releases.

## Unreleased

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
