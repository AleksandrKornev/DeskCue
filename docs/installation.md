# Installation

The public alpha can be installed from a source checkout. Starting with
`v0.2.0`, GitHub Releases also provides an unsigned Windows x64 installer and a
stable feed for explicit update checks and installs. The tagged `v0.2.5` build
includes glibc Linux x64/arm64 standalone archives and Debian packages. The
artifacts passed native install, lifecycle, update and rollback smoke gates.

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

These requirements apply to the source checkout. A Windows packaged build
includes its own Node.js runtime and does not require Node.js, npm, a C/C++
toolchain, Python, or the .NET runtime on the destination machine. Git remains
optional there: DeskCue starts without it, while branch and diff features are
disabled.

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

## Windows x64 Installer

The checked-in packaging path currently targets Windows 10 or newer on x64. It
contains:

- a Node.js Host that owns daemon start, stop, restart, readiness and bounded
  crash recovery;
- the `deskcue` command-line client;
- a self-contained .NET 10 WinForms tray application with no window or webview;
- an allowlisted payload builder with native SQLite and PTY smoke probes;
- an unsigned Inno Setup 7.1.0 installer definition.

Building it requires Windows x64, Node.js `24.14.0`, npm 10 or newer, the .NET
10 SDK, and Inno Setup 7.1.0. From a clean source checkout:

```powershell
npm install
dotnet publish apps/tray/DeskCue.Tray/DeskCue.Tray.csproj -c Release -r win-x64 --self-contained true
node --test tooling/windows-installer/payload-lib.test.mjs
node tooling/windows-installer/build-payload.mjs `
  --dotnet-runtime-version 10.0.12 `
  --dotnet-license "<Microsoft.NETCore.App.Runtime.win-x64>\LICENSE.TXT" `
  --dotnet-notices "<Microsoft.NETCore.App.Runtime.win-x64>\THIRD-PARTY-NOTICES.TXT" `
  --windowsdesktop-license "<Microsoft.WindowsDesktop.App.Runtime.win-x64>\LICENSE"
node tooling/windows-installer/verify-payload.mjs
pwsh -File tooling/windows-installer/compile-installer.ps1
```

The payload builder downloads the official Windows x64 Node.js `24.14.0`
archive when needed and verifies its pinned SHA-256 before extracting it. It
copies compiled output and the production dependency closure through an
explicit allowlist; repository `.env` files, local data, databases, logs,
credentials, tests and foreign native architectures are rejected.

The expected local outputs are:

```text
tooling/windows-installer/dist/installer/DeskCueSetup-<version>-win-x64.exe
tooling/windows-installer/dist/installer/DeskCueSetup-<version>-win-x64.exe.sha256
```

The `v0.2.0` Windows release uses the following unsigned artifact:

```text
File:            tooling/windows-installer/dist/installer/DeskCueSetup-0.2.0-win-x64.exe
Size:            75,308,275 bytes
SHA-256:         e04d4aef89e4b249ad6db82ec464079ceb27dcfc5d6d62d8ae662195378b707a
File version:    0.2.0.0
Product version: 0.2.0
```

The local build manifest SHA-256 is
`86b475b3da087de717f094fd369d97e9aaa9319cd6a38ec3ba4198c263df6115`.
It contains builder-local absolute paths and is retained as local provenance
evidence rather than published as a release asset. The 758,565-byte, 4,003-file
payload manifest SHA-256 is
`98bd72e41099482dc2a40af47a9dd63db8f1eefa27e451ce875c525cc3782944`.

The exact artifact passed payload verification and a real per-user update over
the previous `0.2.0` candidate. All 4,003 installed payload entries matched by
size and SHA-256, the existing non-empty chat store remained available, and a
cold Host/daemon restart finished healthy with CLI status and doctor checks
passing.

The earlier 14-scenario isolated installer smoke suite has not been rerun
against this exact dependency-only rebuild. The check did not use a separate
clean Windows VM or visually and interactively review the native wizard and its
accessibility. These statements describe the `v0.2.0` artifact. The exact
`v0.2.5` installer subsequently passed silent clean-install and data-preserving
uninstall on a fresh Windows Server 2022 runner; the interactive wizard,
SmartScreen and consumer Windows desktop remain untested.

### Installer Behavior

The installer is per-user and does not request administrator rights. It uses:

```text
Program files: %LOCALAPPDATA%\Programs\DeskCue
DeskCue data:  %LOCALAPPDATA%\DeskCue\data
CLI PATH:      %LOCALAPPDATA%\Programs\DeskCue\bin
```

It creates a DeskCue Start-menu shortcut and initializes one current-user
startup entry for `DeskCue.Tray.exe` on a fresh install. An update preserves a
user-disabled startup preference. Setup discloses that it adds the CLI directory
to the user PATH and that a new terminal is required. Uninstall removes program
files, shortcuts, the exact owned startup value and only a PATH segment that the
installer recorded as its own; a matching pre-existing PATH segment is
preserved.

The uninstall confirmation and finish message both disclose that
`%LOCALAPPDATA%\DeskCue` is deliberately preserved. Delete that directory
manually only when you also intend to remove all DeskCue data. If exact PATH or
startup-value cleanup cannot be confirmed, uninstall keeps the installation for
retry instead of removing program files and losing its ownership record.

After installation, open a new terminal before using the updated user PATH.
The implemented lifecycle and diagnostic commands are:

```text
deskcue start
deskcue stop
deskcue restart
deskcue status
deskcue open
deskcue logs
deskcue doctor
deskcue version
```

Use `--json` for machine-readable output, `deskcue logs --follow` to follow the
daemon log, and `deskcue logs --all --raw > deskcue-daemon.jsonl` only when an
exact unredacted export is needed. Raw output may contain secrets or private
data. Use `deskcue open --print` to print the dashboard URL without opening a
browser. `deskcue status` reports Host and daemon versions, Host start
time, the current update phase, autostart state and any active recovery or busy
reason. It exits with `1` for a degraded runtime or failed update operation and
with `3` when the Host or daemon is inactive. The Host persists whether the
daemon was requested to run; `deskcue stop` stops the daemon, not the tray or
Host.

The tray provides Open, Start, Stop, Restart, Pair a phone, Open
logs, startup preference and Exit tray. Exiting the tray does not stop the
Host. Update actions are capability-gated; installed Windows and standalone
Linux Hosts support them, while Debian packages and source checkouts leave
program replacement external.

Installed Windows and standalone Linux builds also support:

```text
deskcue update --check
deskcue update
deskcue update --channel beta
deskcue autostart status
deskcue autostart enable
deskcue autostart disable
```

`deskcue update --check` is read-only. `deskcue update` is an explicit request
to check, download, verify and install an available update; the tray asks for
confirmation before sending the equivalent install request. Neither surface
checks nor installs updates in the background. Source-checkout mode reports both
update and autostart capabilities as unavailable.

The installed Host reads `update-manifest-v1.json` for stable and
`update-manifest-v1-beta.json` for beta from the DeskCue GitHub Release
`latest/download` assets. `DESKCUE_UPDATE_MANIFEST_URL` can override the
manifest URL for controlled deployments and accepts `{channel}` as a
placeholder. The stable feed is published with `v0.2.0`; the beta feed remains
unavailable because GitHub excludes prereleases from `releases/latest`. A
separate beta publication mechanism must be defined before that channel is
published.

Do not invoke the installer's private `/UPDATE` mode directly. The supported
path begins with `deskcue update` or the tray so the Host can reject active
work, create a consistent database backup and verify the installer before
handoff.

For unattended testing, a fresh install accepts:

```text
DeskCueSetup-<version>-win-x64.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /TASKS=autostart
```

Pass `/TASKS=""` on a fresh silent install to leave autostart disabled. Update
mode ignores this fresh-install task and preserves the current preference.

Silent uninstall uses:

```text
%LOCALAPPDATA%\Programs\DeskCue\unins000.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
```

The installer never uses `taskkill` against arbitrary `node.exe` processes. It
asks the tray and authenticated Host to shut down and refuses to replace an
existing installation through the ordinary fresh-install path.

For a manual replacement when no published Host-coordinated update is
available, uninstall DeskCue and then run the new installer. The uninstaller
keeps `%LOCALAPPDATA%\DeskCue`, so the reinstall reuses the retained data unless
you explicitly delete that directory.

## Linux Packaged Build

The Linux distribution targets glibc-based x64 and arm64 systems. Ubuntu 22.04+
and Debian 12+ are the initial support baseline. Alpine and other musl-based
distributions remain outside the supported matrix.

The installer requires `curl`, `sha256sum`, `tar` and a working per-user systemd
session. The Debian method additionally requires `sudo` and `dpkg`. Packaged
builds include Node.js; a system Node.js installation is not required.

Each architecture produces:

```text
deskcue-<version>-linux-<x64|arm64>.tar.gz
deskcue_<version>_<amd64|arm64>.deb
```

The standalone archive is the primary local-first installation. It installs
without root under:

```text
Program files: ~/.local/lib/deskcue
CLI link:      ~/.local/bin/deskcue
User service:  ~/.config/systemd/user/deskcue-host.service
Data:          ${XDG_DATA_HOME:-~/.local/share}/deskcue/data
```

Install `v0.2.5` or a newer release with:

```bash
curl -fsSL https://raw.githubusercontent.com/AleksandrKornev/DeskCue/main/install.sh | sh
```

The script detects x64/arm64, downloads a versioned artifact and the release
checksum set, verifies SHA-256, validates the payload target, atomically
replaces a recognized previous installation, and enables the Host through
`systemd --user`. An update preserves a disabled or stopped service preference.
The installer requires an exact DeskCue ownership marker and refuses to replace
an unrecognized program directory, CLI link or user-service file. It also
refuses to mix standalone and Debian installations; remove the existing method
before switching package ownership.

Install the Debian package explicitly with:

```bash
curl -fsSL https://raw.githubusercontent.com/AleksandrKornev/DeskCue/main/install.sh | \
  sh -s -- --method deb
```

The Debian package is owned by `dpkg`, so DeskCue does not overwrite it through
its self-updater. Rerun the command above to download and install a newer release
asset, or download that `.deb` and run `sudo dpkg -i <file>`. No APT repository
is provided yet. Debian updates preserve disabled/stopped user-service
preferences. The standalone package supports explicit `deskcue update`; its
update worker rechecks the downloaded archive, waits for the Host to exit, swaps
the program directory and owned user-service file, restarts systemd, verifies
the expected Host and daemon version across consecutive health probes, and
restores both the previous directory and unit if the new Host does not remain
ready.
The worker runs as a separate transient user unit, so Host shutdown does not
terminate it. Diagnose a failed handoff with
`journalctl --user -u 'deskcue-update-*' -n 100 --no-pager`; if both the update
and restored version fail their health checks, the journal names the retained
failed-payload directory.

The Linux package has no tray yet. The Host service, CLI and browser dashboard
are complete without one; a Linux tray remains a separate optional desktop
integration because server, SSH and some desktop environments do not expose a
system tray.

Build both package formats on a native matching Linux runner with Node.js
`24.14.0`, npm 10+, `tar` and `dpkg-deb`:

```bash
npm ci
npm run test:distribution
npm run build:linux-package -- --arch x64
```

Use `--arch arm64` on an arm64 runner. Cross-architecture assembly is rejected
because bundled Node, SQLite and PTY binaries must match the runner target.

### Remove a Linux package

For a standalone installation, disable the service and remove only the owned
program, CLI link and unit:

```bash
systemctl --user disable --now deskcue-host.service
rm ~/.local/bin/deskcue
rm "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/deskcue-host.service"
rm -rf ~/.local/lib/deskcue
systemctl --user daemon-reload
```

For a Debian installation, disable the current user's service before removing
the package:

```bash
systemctl --user disable --now deskcue-host.service
sudo dpkg --remove deskcue
systemctl --user daemon-reload
```

Both paths preserve `${XDG_DATA_HOME:-~/.local/share}/deskcue/data`. Remove that
directory separately only when you intend to delete chats, settings, logs and
paired-device state.

## Local data

The default source-checkout data directory is `.deskcue-data/` in the repository
root. To store runtime data elsewhere, set:

```bash
DESKCUE_DATA_DIR=/path/to/deskcue-data
```

Use `.env.local` for persistent local configuration. Never commit that file.
See [Environment Configuration](./environment.md).

Installed mode does not load `.env.local` or `.env` from the install directory
or current working directory. Windows uses `%LOCALAPPDATA%\DeskCue\data`; Linux
uses `${XDG_DATA_HOME:-~/.local/share}/deskcue/data`. An explicit
`DESKCUE_DATA_DIR` still takes precedence for controlled testing and advanced
deployments.

## Access from another device

Authentication is enabled by default. Open Settings > Connections on the host and
create a one-time pairing link for the target browser or phone. Each browser
receives a separate revocable device credential; the daemon stores only its
hash.

Windows may show a Firewall prompt when the daemon first listens for LAN access.
DeskCue setup does not add, accept or remove firewall rules. Grant
private-network access only if you want to reach DeskCue from another device;
the final installer smoke did not display or interact with that prompt.

The daemon listens on the trusted LAN by default. Set `DESKCUE_PUBLIC_HOST` when
automatic address detection is not appropriate. When using the Vite dashboard,
also add its exact origin to `DESKCUE_ALLOWED_ORIGINS`.

Use `DESKCUE_BIND_HOST=127.0.0.1` for loopback-only operation. Set
`DESKCUE_AUTH_REQUIRED=false` only in an isolated development environment. Do
not expose the source-checkout daemon directly to the public internet.

## Diagnostics

From a source checkout:

```bash
npm run doctor
```

From an installed Windows or Linux build:

```powershell
deskcue doctor
```

The doctor command is read-only. It reports configured storage, recent daemon
diagnostics, installation mode, component version alignment, update health and
migration recovery information without printing credentials. Exit code `0`
means no failed checks were found, `1` means an issue requires attention, and
`3` means the Host or daemon is inactive. Warnings and individual checks are
available under `data.health` with `--json`; the compact component snapshot is
under `data.runtime`.

## Removing local data

Stop DeskCue, then remove `.deskcue-data/`, `%LOCALAPPDATA%\DeskCue`, or the
configured `DESKCUE_DATA_DIR` as appropriate. This is separate from uninstall
and deletes DeskCue history, settings, access-device hashes, logs, backups,
updater state and local chat data.
