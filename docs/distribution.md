# Distribution

DeskCue is published as a source-checkout alpha. Starting with `v0.2.0`, GitHub
Releases also provides an unsigned Windows x64 distribution with a stable
manual-update feed. This page distinguishes the supported public paths from
packaging components that remain locally verified previews.

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

The source-checkout daemon listens on LAN by default. The Connections tab shows the
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

The Windows distribution adds separate gates. A candidate must publish and test
the tray, run the installer payload contract tests, assemble the payload with
the exact bundled Node.js version, load its native SQLite and PTY modules, build
the installer, then exercise clean install, Host/CLI lifecycle, uninstall and
data preservation. Those checks are not substitutes for the repository and MCP
Chrome DevTools gates.

## Release Versioning

DeskCue uses one fixed version for the root project and every private npm
workspace. Prepare a release on a dedicated branch with:

```bash
npm version <version> --workspaces --include-workspace-root --no-git-tag-version
npm run version:check
```

Move the relevant `Unreleased` changelog entries under the new version and
date, then complete the alpha verification above. After the release PR is
merged, tag the resulting `main` commit as `v<version>` and publish the tag.
Package-specific independent versions can be introduced later if DeskCue starts
publishing npm packages separately.

For a Windows release, create the GitHub Release as a draft first. Upload the
installer, its `.sha256` file and the matching stable update manifest, then
verify their names, sizes and hashes through the GitHub API before publishing
the release. Do not publish a release while its `latest/download` feed is
incomplete. The builder-local `.build-manifest.json` contains absolute paths
and is not a public release asset.

## Docker Compose Status

Docker Compose is not the default distribution path yet. The daemon controls
local processes, reads local runtime metadata and needs access to the user's
workspace paths and agent binaries. A container can hide or distort those local
machine boundaries unless the user mounts workspaces and tool config
explicitly.

Treat Docker Compose as future packaging work, not the current recommended
alpha install path.

## Windows Distribution Alpha

The following pieces are implemented in the repository:

- a singleton per-user Host with authenticated local IPC, persistent desired
  daemon state, readiness reporting, graceful stop/restart and bounded crash
  recovery;
- a managed daemon entrypoint that shuts down when its Host disconnects;
- CLI lifecycle, status, browser-open, bounded/followed logs, read-only doctor
  and machine-readable JSON output;
- a native, self-contained Windows x64 tray application whose menu is projected
  from Host capabilities;
- an allowlisted payload builder that bundles Node.js `24.14.0`, production
  application output and only the Windows x64 native dependencies;
- an unsigned, per-user Inno Setup installer definition and SHA-256 output;
- an updater library with strict manifests, HTTPS host allowlisting, bounded
  downloads, SHA-256 and size verification, durable staging state and an
  explicit installer handoff;
- a daemon update-readiness drain that rejects new mutations, reports active
  work and creates a consistent pre-update SQLite backup;
- installed Windows Host integration for explicit update check/apply, including
  drain recovery, daemon shutdown and detached Inno installer launch;
- installed Windows Host integration for exact current-user tray autostart
  read/enable/disable through the CLI.

The Windows x64 implementation passed 14/14 isolated installer scenarios,
55/55 recorded observations and three independent static/operational reviews.
Coverage includes clean install, CLI lifecycle, direct-overinstall rejection,
pre/post-copy rollback, partial recovery, same-version update, PATH/autostart
ownership and fail-closed retry behavior, and uninstall. The final `v0.2.0`
artifact was also installed over the previous candidate, matched all 4,003
payload entries by size and SHA-256, preserved the existing chat store, and
passed installed Host, daemon, CLI and doctor checks. Payload and tray
provenance are bound to the exact artifact, but that binding is not a
reproducible-build proof.

The smoke used explicit isolated paths on the build workstation rather than a
separate clean Windows VM, and the native installer's interactive visual and
accessibility behavior remains unreviewed. The stable `v0.2.0` manifest and its
matching installer are published together; the beta feed has no public
artifact yet.

There is no background update timer or automatic install. In installed Windows
mode, `deskcue update --check` only checks; `deskcue update` explicitly requests
check, download and apply. The tray asks for confirmation before apply. Source
mode intentionally reports update and autostart capabilities as unavailable.

The default stable feed is `update-manifest-v1.json`, and beta uses
`update-manifest-v1-beta.json`, both under the GitHub Release `latest/download`
path. The stable feed is available starting with `v0.2.0`; the beta endpoint is
currently unavailable. GitHub excludes prereleases from `releases/latest`, so
a beta publication mechanism must be defined before publishing that channel.

The installer is intentionally unsigned and x64-only. Signing is deferred. The
Host updater accepts installed Windows x64 and arm64 targets, but no arm64
payload or installer is built in this scope. There is no WinGet
package, `npx` bootstrap or `install.sh`; packaged Linux/macOS builds, other
package-manager channels and container distribution are outside this scope.

Private, uniquely owned compile and updater snapshots narrow pathname races,
but Node/CreateProcess cannot launch a Windows executable from an already
verified handle. A malicious process running as the same Windows user could
still race replacement of a verified path before launch. The updater therefore
does not claim to be a security boundary against a compromised same-user
account.

The installer contract is:

```text
Artifact:      DeskCueSetup-<version>-win-x64.exe
Install root:  %LOCALAPPDATA%\Programs\DeskCue
Data root:     %LOCALAPPDATA%\DeskCue\data
CLI PATH:      %LOCALAPPDATA%\Programs\DeskCue\bin
Autostart:     HKCU\Software\Microsoft\Windows\CurrentVersion\Run\DeskCue
```

Program replacement and data lifetime are separate. Uninstall removes the
installed application, its exact owned autostart value and an installer-owned
PATH segment, but preserves both a pre-existing matching PATH segment and
`%LOCALAPPDATA%\DeskCue`. If registry cleanup cannot be confirmed, uninstall
retains the program and ownership marker for retry. Source-checkout development
continues to use the repository-local `.deskcue-data/` directory unless
`DESKCUE_DATA_DIR` is set.

See [Installation](./installation.md) for the exact build commands and current
limitations, and [Recovery Notes](./recovery.md) for data recovery.
