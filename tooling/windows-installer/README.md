# Windows installer tooling

This directory assembles the unsigned, per-user Windows x64 DeskCue installer.
It deliberately does not publish releases, register WinGet, provide an npm
bootstrap, or build other operating-system packages.

## Contract

- Program files: `%LOCALAPPDATA%\Programs\DeskCue`
- Mutable root: `%LOCALAPPDATA%\DeskCue`
- Daemon data: `%LOCALAPPDATA%\DeskCue\data`, supplied by the Host through
  `DESKCUE_DATA_DIR`
- CLI PATH entry: `%LOCALAPPDATA%\Programs\DeskCue\bin`
- Autostart: the single `DeskCue` value under
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, targeting
  `"%LOCALAPPDATA%\Programs\DeskCue\DeskCue.Tray.exe" --autostart`
- Runtime: official Windows x64 Node.js 24.14.0 archive, pinned by SHA-256
- Installer: unsigned Inno Setup 7.1.0 executable with a stable AppId

The interactive installer shows a `Start DeskCue when I sign in` checkbox before
installing. It is selected by default on a fresh install and can be cleared. An
update preserves the existing autostart choice instead of re-enabling it. The
Ready page also discloses that setup adds the CLI bin directory to the user PATH
and that a new terminal is required before `deskcue` is available. The
uninstaller confirms that it removes program files, its owned PATH segment,
shortcuts and the exact owned autostart value. It never removes
`%LOCALAPPDATA%\DeskCue`, so an update,
uninstall/reinstall cycle, or failed application start does not erase user data.
The finish message repeats the exact retained path and tells users to delete that
directory manually only when they also want to remove all DeskCue data.

## Build

First publish the self-contained tray executable to its canonical output path,
install the root dependency tree with npm, and run the payload builder using the
exact Node release that is bundled:

```powershell
node --test tooling/windows-installer/payload-lib.test.mjs
$netCorePack = 'C:\path\to\microsoft.netcore.app.runtime.win-x64\10.0.12'
$windowsDesktopPack = 'C:\path\to\microsoft.windowsdesktop.app.runtime.win-x64\10.0.12'
node tooling/windows-installer/build-payload.mjs `
  --dotnet-runtime-version 10.0.12 `
  --dotnet-license "$netCorePack\LICENSE.TXT" `
  --dotnet-notices "$netCorePack\THIRD-PARTY-NOTICES.TXT" `
  --windowsdesktop-license "$windowsDesktopPack\LICENSE"
node tooling/windows-installer/verify-payload.mjs
pwsh -File tooling/windows-installer/compile-installer.ps1
```

The builder runs the DeskCue production build, computes the daemon/CLI/Host npm
production closure, and copies only compiled application/package output. It
does not copy workspace directories wholesale. In particular, ignored nested
`node_modules/.pnpm`, `.env*`, `.deskcue-data`, databases, logs and credentials
cannot enter the payload. It then loads `better-sqlite3` and
`@lydell/node-pty` using the bundled Node executable before emitting a complete
per-file manifest.

Payload assembly rejects symbolic links, junctions and other escaping reparse
paths instead of dereferencing them. Destructive replacement is limited to a
canonically contained payload directory whose existing parent chain contains no
reparse point. The manifest records every C#, project and `Assets/` source hash
beside the exact tray executable and refuses a published executable older than
those inputs. This is a bounded freshness/provenance check, not proof that the
executable was produced from those sources: the canonical tray publish must
still be performed and reviewed as a separate release step.

The canonical tray input is:

```text
apps/tray/DeskCue.Tray/bin/Release/net10.0-windows/win-x64/publish/DeskCue.Tray.exe
```

Because the tray is a self-contained .NET application, the release build must
record the exact resolved runtime pack and pass its matching notices explicitly
with `--dotnet-license`, `--dotnet-notices`, `--windowsdesktop-license`, and the
exact `--dotnet-runtime-version`. The builder fails rather than
silently substituting notices from a different installed .NET runtime.

Use `--tray-exe`, `--node-archive`, `--output`, `--repo-root`, `--skip-build` or
`--skip-smoke` only for isolated build/test scenarios. A supplied Node archive
still has to match the pinned digest.

If `ISCC.exe` is not installed, `compile-installer.ps1` fails without modifying
the machine and prints the complete deterministic compiler invocation. The
expected outputs are:

```text
DeskCueSetup-<version>-win-x64.exe
DeskCueSetup-<version>-win-x64.exe.sha256
DeskCueSetup-<version>-win-x64.exe.build-manifest.json
```

The build manifest is local provenance evidence and records absolute builder
paths. Do not attach it unchanged to a public release. Public release assets are
the installer, its `.sha256` file and the channel-specific update manifest.

Compilation copies the payload, installer script and icon below one unique
private session directory, recursively removes inherited write access, probes
directory/file writes and protected-child deletion, and verifies the exact
inputs immediately before and after ISCC.
The build manifest binds those consumed snapshots, the payload manifest and the
exact ISCC binary/version to the resulting Setup hash. The staged installer is
published only after the post-compile checks. This bounds accidental or
concurrent mutation of the ordinary source/payload directories; it is not a
security boundary against the same Windows account deliberately taking
ownership and rewriting its own build files while compilation is in progress.

## Silent operations and updates

Fresh silent install (autostart enabled):

```text
DeskCueSetup-<version>-win-x64.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /TASKS=autostart
```

Pass `/TASKS=""` on a fresh silent install to leave autostart disabled. The
`/UPDATE` flow ignores this fresh-install task and preserves the current Run
value.

Host-coordinated update after the Host has denied new work, drained the daemon
and exited:

```text
DeskCueSetup-<version>-win-x64.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /UPDATE /STARTTRAY=1
```

Silent uninstall:

```text
%LOCALAPPDATA%\Programs\DeskCue\unins000.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
```

If exact PATH or Run-value cleanup cannot be confirmed, uninstall stops before
program files and the PATH ownership marker are removed. Fix the registry access
problem and rerun the uninstaller. User data is still retained separately at
`%LOCALAPPDATA%\DeskCue`.

The installer intentionally does not kill arbitrary `node.exe` processes. On
update and uninstall it first asks the running tray to exit and uses the private
authenticated Host IPC through the packaged CLI to shut down the Host. A normal
update must still arrive through the updater, which checks active-work policy
before passing `/UPDATE`. A normal installer-over-install is refused. Until a
locally built candidate is available through a configured release feed, its
supported manual replacement path is to close DeskCue, uninstall it, and run
the new installer; the separate `%LOCALAPPDATA%\DeskCue` data directory remains
intact. `/UPDATE` is a trusted integration switch for an already-authorized
updater handoff, not an authorization boundary by itself.
