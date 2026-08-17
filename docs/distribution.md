# Distribution

DeskCue is currently distributed as a source-checkout alpha. This page describes
the supported path for early users and the constraints that must be solved
before packaged releases.

## Source-Checkout Alpha

Requirements:

- Node.js 22.22 or newer within the 22.x release line, or Node.js 24.x
- npm 10+
- Git in `PATH` for `git clone` and diff features

The prebuilt native dependency matrix covers Windows, glibc Linux, and macOS
on x64 and arm64. Alpine Linux and other musl-based distributions are not
currently supported because the PTY dependency has no source-build fallback.

Setup:

Clone the repository, open its checkout, and run:

```bash
npm install
npm run start
```

Users without Git can use a source archive or future packaged build. DeskCue
still starts without Git, but workspace branch, changed-file and git diff
features are disabled.

Default endpoint:

- dashboard and daemon: `http://localhost:4100`

`npm run start` is the supported source-checkout alpha runtime command. It
builds and serves the dashboard from the daemon. `npm run dev` is still
available for contributors who want Vite hot reload on
`http://localhost:4173`.

The source-checkout daemon listens on LAN by default. The Access page shows the
current exposure level and highlights when access protection is off. For another
browser or phone on the same LAN, request a pairing link from the host machine:

```bash
curl http://127.0.0.1:4100/api/access/link
```

Open the returned `webUrl` from the target browser.

## Alpha Verification

Before tagging or announcing a source-checkout alpha, run:

```bash
npm run verify
npm run doctor
npm run smoke:daemon
npm run smoke:web
```

`smoke:web` uses port `45173` by default so it can run while a normal dev server
is already using `4173`.

Complete one manual browser pass through workspace registration, agent launch,
Chat, Changes, Files, Preview, follow-up input and interrupt. When a release
changes the SQLite schema, also follow the
[Release and Migration Playbook](./release-migrations.md).

## Docker Compose Status

Docker Compose is not the default distribution path yet. The daemon controls
local processes, reads local runtime metadata and needs access to the user's
workspace paths and agent binaries. A container can hide or distort those local
machine boundaries unless the user mounts workspaces and tool config
explicitly.

Treat Docker Compose as future packaging work, not the current recommended
alpha install path.

## Packaged Installer Status

A packaged desktop installer is future work. Before shipping one, DeskCue needs:

- a clean daemon start/stop lifecycle;
- upgrade testing around SQLite migrations;
- a user-facing recovery path for failed migrations;
- platform-specific signing and update decisions

Installer and portable builds should set a stable data directory with one
environment variable:

```bash
DESKCUE_DATA_DIR=/path/to/deskcue-data
```

Unless more specific variables are set, the daemon stores `deskcue.sqlite`,
legacy `state.json` import data and `logs/daemon.jsonl` under that directory.
Paired device token hashes are stored in SQLite. Source-checkout development
still defaults to `.deskcue-data/` in the DeskCue repository root.
