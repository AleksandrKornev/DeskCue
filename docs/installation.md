# Installation

DeskCue is currently distributed as a source-checkout alpha. Packaged installers
and container images are not available yet.

## Requirements

- Node.js `22.22` or newer within `22.x`, or Node.js `24.x`
- npm `10+`
- Git in `PATH` for clone, branch, and diff features

DeskCue installs prebuilt native binaries for PTY and SQLite on the supported
Node.js versions for Windows, glibc Linux, and macOS (x64 and arm64). A C/C++
toolchain and Python are not required for the normal source-checkout setup on
this supported matrix.

Other platforms, including Alpine Linux and other musl-based distributions, are
not currently supported. The PTY dependency does not provide a
source-compilation fallback when a compatible prebuilt binary is unavailable.

Clean install and production-start smoke checks currently pass on Windows and
Ubuntu Linux. The dependency set includes macOS x64 and arm64 binaries, but a
real macOS runtime smoke check is still required before macOS can be listed as
a tested platform for the public alpha.

## Source checkout

Clone the repository, open its checkout, and run:

```bash
npm install
npm run start
```

Open `http://localhost:4100`.

`npm run start` builds every workspace and serves the built dashboard from the
daemon. Contributors can run the daemon plus the Vite dashboard with:

```bash
npm run dev
```

- daemon: `http://localhost:4100`
- Vite dashboard: `http://localhost:4173`

If Git is unavailable, DeskCue can run from an extracted source archive, but
branch and Git diff features are disabled.

## Local data

The default source-checkout data directory is `.deskcue-data/` in the repository
root. To store runtime data elsewhere, set:

```bash
DESKCUE_DATA_DIR=/path/to/deskcue-data
```

Use `.env.local` for persistent local configuration. Never commit that file.
See [Environment Configuration](./environment.md).

## Access from another device

Authentication is enabled by default. Open Settings > Connections on the host and
create a one-time pairing link for the target browser or phone. Each browser
receives a separate revocable device credential; the daemon stores only its
hash.

The daemon listens on the trusted LAN by default. Set `DESKCUE_PUBLIC_HOST` when
automatic address detection is not appropriate. When using the Vite dashboard,
also add its exact origin to `DESKCUE_ALLOWED_ORIGINS`.

Use `DESKCUE_BIND_HOST=127.0.0.1` for loopback-only operation. Set
`DESKCUE_AUTH_REQUIRED=false` only in an isolated development environment. Do
not expose the source-checkout daemon directly to the public internet.

## Diagnostics

```bash
npm run doctor
```

The doctor command is read-only. It reports configured storage, recent daemon
diagnostics, and migration recovery information without printing credentials.

## Removing local data

Stop DeskCue, then remove `.deskcue-data/` or the configured
`DESKCUE_DATA_DIR`. This deletes DeskCue history, settings, access-device hashes,
logs, and local chat data.
