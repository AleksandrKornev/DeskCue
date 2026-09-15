import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  WINDOWS_INSTALLER_NODE_ARCHIVE_SHA256,
  WINDOWS_INSTALLER_NODE_VERSION,
  assertSafeReplaceDirectory,
  copyPayloadTree,
  createTrayBuildIdentity,
  copyDotnetNotices,
  createPayloadManifest,
  removeSafePayloadDirectory,
  shouldCopyPayloadPath,
  verifyPayloadManifest,
  writeDeskCueCommandShim
} from "./payload-lib.mjs";

test("pins an exact Node release and archive digest", () => {
  assert.equal(WINDOWS_INSTALLER_NODE_VERSION, "24.14.0");
  assert.match(WINDOWS_INSTALLER_NODE_ARCHIVE_SHA256, /^[a-f0-9]{64}$/u);
});

test("payload filter rejects local state, secrets, logs and pnpm stores", () => {
  for (const filePath of [
    ".deskcue-data/service/deskcue.sqlite",
    "apps/web/node_modules/.pnpm/package/index.js",
    "app/.env",
    "app/.env.production",
    "app/node_modules/package/.npmrc",
    "service/daemon.log",
    "service/deskcue.sqlite-wal",
    "service/backup.sqlite.bak",
    "service/private.key",
    "credentials-local.json",
    "my-credentials.json",
    "tokens.json"
  ]) {
    assert.equal(shouldCopyPayloadPath(filePath), false, filePath);
  }

  assert.equal(shouldCopyPayloadPath("app/apps/web/dist/index.html"), true);
  assert.equal(shouldCopyPayloadPath("app/node_modules/dotenv/lib/main.js"), true);
});

test("safe replacement guard rejects the repository root", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "deskcue-safe-replace-"));
  const repositoryRoot = join(temporaryRoot, "repository");
  mkdirSync(join(repositoryRoot, "dist"), { recursive: true });
  try {
    assert.throws(() => assertSafeReplaceDirectory(repositoryRoot, repositoryRoot));
    assert.throws(() => assertSafeReplaceDirectory(join(repositoryRoot, "apps"), repositoryRoot));
    assert.throws(() => assertSafeReplaceDirectory(join(temporaryRoot, "archive-payload"), repositoryRoot));
    assert.doesNotThrow(() => assertSafeReplaceDirectory(join(repositoryRoot, "dist", "payload"), repositoryRoot));
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test("safe replacement guard accepts a canonical alias above the repository root", (context) => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "deskcue-safe-alias-"));
  const physicalParent = join(temporaryRoot, "physical-parent");
  const aliasParent = join(temporaryRoot, "alias-parent");
  const physicalRepositoryRoot = join(physicalParent, "repository");
  const repositoryRoot = join(aliasParent, "repository");
  const payloadPath = join(repositoryRoot, "dist", "payload");
  mkdirSync(join(physicalRepositoryRoot, "dist"), { recursive: true });
  try {
    try {
      symlinkSync(physicalParent, aliasParent, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (error?.code === "EPERM") {
        context.skip("Platform policy does not allow creating a test directory alias.");
        return;
      }
      throw error;
    }

    assert.equal(assertSafeReplaceDirectory(payloadPath, repositoryRoot), payloadPath);
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test("safe replacement guard rejects a junction that escapes a custom repository root", (context) => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "deskcue-safe-junction-"));
  const repositoryRoot = join(temporaryRoot, "repository");
  const externalRoot = join(temporaryRoot, "external");
  const linkedParent = join(repositoryRoot, "linked-parent");
  mkdirSync(repositoryRoot, { recursive: true });
  mkdirSync(externalRoot, { recursive: true });
  writeFileSync(join(externalRoot, "sentinel.txt"), "preserved");
  try {
    try {
      symlinkSync(externalRoot, linkedParent, "junction");
    } catch (error) {
      if (error?.code === "EPERM") {
        context.skip("Windows policy does not allow creating a test junction.");
        return;
      }
      throw error;
    }

    assert.throws(
      () => removeSafePayloadDirectory(join(linkedParent, "payload"), repositoryRoot),
      /symbolic link|junction|reparse/u
    );
    assert.equal(readFileSync(join(externalRoot, "sentinel.txt"), "utf8"), "preserved");
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test("payload copy rejects a filename-safe symbolic link to an external file", (context) => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "deskcue-copy-link-"));
  const sourceRoot = join(temporaryRoot, "source");
  const destinationRoot = join(temporaryRoot, "destination");
  const externalSecret = join(temporaryRoot, "external-secret.txt");
  mkdirSync(sourceRoot, { recursive: true });
  writeFileSync(externalSecret, "must not be copied");
  try {
    try {
      symlinkSync(externalSecret, join(sourceRoot, "README.txt"), "file");
    } catch (error) {
      if (error?.code === "EPERM") {
        context.skip("Windows policy does not allow creating a test symbolic link.");
        return;
      }
      throw error;
    }

    assert.throws(() => copyPayloadTree(sourceRoot, destinationRoot), /symbolic links|junctions/u);
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test("custom repository roots also bound the temporary Node extraction directory", () => {
  const builder = readFileSync(new URL("./build-payload.mjs", import.meta.url), "utf8");
  assert.match(builder, /function copyBundledNode\(archivePath, payloadRoot, repositoryRoot\)/u);
  assert.match(builder, /resetSafePayloadDirectory\(extractionRoot, repositoryRoot\)/u);
  assert.match(builder, /removeSafePayloadDirectory\(extractionRoot, repositoryRoot\)/u);
  assert.match(builder, /copyBundledNode\(nodeArchivePath, options\.outputPath, options\.repositoryRoot\)/u);
  assert.doesNotMatch(builder, /SafePayloadDirectory\(extractionRoot, defaultRepositoryRoot\)/u);
});

test("installer compilation verifies the private snapshot consumed by Inno Setup", () => {
  const compiler = readFileSync(new URL("./compile-installer.ps1", import.meta.url), "utf8");
  const snapshotIndex = compiler.indexOf("compile-snapshot.mjs");
  const verificationIndex = compiler.indexOf("$resolvedSnapshotDir");
  const compilerIndex = compiler.indexOf("& $IsccPath @arguments");

  assert.notEqual(snapshotIndex, -1);
  assert.notEqual(verificationIndex, -1);
  assert.notEqual(compilerIndex, -1);
  assert.ok(verificationIndex < compilerIndex);
  assert.match(compiler, /PayloadDir=\$resolvedSnapshotDir/u);
  assert.match(compiler, /post-compile/u);
  assert.doesNotMatch(compiler, /\/DPayloadDir=\$resolvedPayloadDir/u);
  assert.match(compiler, /Set-PrivateSnapshotAccess/u);
  assert.match(compiler, /\$grantRules = @\("\*\$currentSid`:\$permission"\)/u);
  assert.match(compiler, /if \(\$currentSid -ne 'S-1-5-18'\)/u);
  assert.match(compiler, /\$grantRules \+= '\*S-1-5-18:F'/u);
  assert.match(compiler, /'\/grant:r' @grantRules/u);
  assert.match(compiler, /'\/T' '\/C' '\/Q'/u);
  assert.match(compiler, /Assert-PrivateSnapshotAccess/u);
  assert.match(compiler, /session-\$buildId/u);
  assert.match(compiler, /Assert-PrivateSnapshotChildDeletionDenied/u);
  assert.match(compiler, /protectedChildDeletionProbed = \$true/u);
  assert.doesNotMatch(compiler, /Directory\]::Move/u);
  assert.match(compiler, /File\]::Delete\(\$ProtectedFile\)/u);
  assert.match(compiler, /snapshotInstallerScript/u);
  assert.match(compiler, /snapshotInstallerIcon/u);
  assert.match(compiler, /DeskCueIconFile=\$snapshotInstallerIcon/u);
  assert.match(compiler, /Assert-FileBinding -Path \$IsccPath/u);
  assert.match(compiler, /\.build-manifest\.json/u);
  assert.doesNotMatch(compiler, /\$installerScriptSource\s*\)/u);
});

test("command shim always launches the bundled runtime and preserves arguments", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "deskcue-payload-shim-"));
  try {
    writeDeskCueCommandShim(temporaryRoot);
    const commandShim = readFileSync(join(temporaryRoot, "bin", "deskcue.cmd"), "utf8");
    assert.match(commandShim, /%~dp0\.\.\\runtime\\node\.exe/u);
    assert.match(commandShim, /apps\\cli\\dist\\index\.js/u);
    assert.match(commandShim, /DESKCUE_DISTRIBUTION_MODE=installed/u);
    assert.match(
      commandShim,
      /if not defined DESKCUE_DATA_DIR set "DESKCUE_DATA_DIR=%LOCALAPPDATA%\\DeskCue\\data"/u
    );
    assert.doesNotMatch(commandShim, /^set "DESKCUE_DATA_DIR=/mu);
    assert.match(commandShim, /DESKCUE_HOST_ENTRY=%~dp0\.\.\\app\\apps\\host\\dist\\index\.js/u);
    assert.match(commandShim, /DESKCUE_NODE_EXECUTABLE=%~dp0\.\.\\runtime\\node\.exe/u);
    assert.match(commandShim, /%\*/u);
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test("self-contained tray notices are mandatory and copied to a stable location", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "deskcue-dotnet-notices-"));
  try {
    const licensePath = join(temporaryRoot, "source-LICENSE.txt");
    const noticesPath = join(temporaryRoot, "source-ThirdPartyNotices.txt");
    const windowsDesktopLicensePath = join(temporaryRoot, "source-WindowsDesktop-LICENSE.txt");
    const payloadRoot = join(temporaryRoot, "payload");
    writeFileSync(licensePath, "runtime license");
    writeFileSync(noticesPath, "runtime notices");
    writeFileSync(windowsDesktopLicensePath, "windows desktop runtime license");

    copyDotnetNotices(licensePath, noticesPath, windowsDesktopLicensePath, payloadRoot);
    assert.equal(
      readFileSync(join(payloadRoot, "licenses", "dotnet", "NETCore-LICENSE.txt"), "utf8"),
      "runtime license"
    );
    assert.equal(
      readFileSync(join(payloadRoot, "licenses", "dotnet", "NETCore-ThirdPartyNotices.txt"), "utf8"),
      "runtime notices"
    );
    assert.equal(
      readFileSync(join(payloadRoot, "licenses", "dotnet", "WindowsDesktop-LICENSE.txt"), "utf8"),
      "windows desktop runtime license"
    );
    assert.throws(
      () => copyDotnetNotices("missing", noticesPath, windowsDesktopLicensePath, payloadRoot),
      /version-matched/u
    );
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test("tray build identity binds C#, project and case-preserved Assets inputs and rejects a stale EXE", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "deskcue-tray-identity-"));
  try {
    const projectRoot = join(temporaryRoot, "apps", "tray", "DeskCue.Tray");
    const assetRoot = join(projectRoot, "Assets");
    const executablePath = join(temporaryRoot, "DeskCue.Tray.exe");
    mkdirSync(assetRoot, { recursive: true });
    writeFileSync(join(projectRoot, "DeskCue.Tray.csproj"), "<Project />");
    writeFileSync(join(projectRoot, "Program.cs"), "class Program {}");
    writeFileSync(join(assetRoot, "deskcue.ico"), "icon");
    writeFileSync(executablePath, "exe");

    const identity = createTrayBuildIdentity(temporaryRoot, executablePath);
    assert.deepEqual(identity.sourceFiles.map((file) => file.path), [
      "apps/tray/DeskCue.Tray/Assets/deskcue.ico",
      "apps/tray/DeskCue.Tray/DeskCue.Tray.csproj",
      "apps/tray/DeskCue.Tray/Program.cs"
    ]);

    const future = new Date(Date.now() + 10_000);
    utimesSync(join(projectRoot, "Program.cs"), future, future);
    assert.throws(() => createTrayBuildIdentity(temporaryRoot, executablePath), /older than its bound sources/u);
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test("payload manifest is stable, sorted and excludes itself", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "deskcue-payload-manifest-"));
  try {
    mkdirSync(join(temporaryRoot, "z"), { recursive: true });
    writeFileSync(join(temporaryRoot, "z", "last.txt"), "last");
    writeFileSync(join(temporaryRoot, "first.txt"), "first");
    writeFileSync(join(temporaryRoot, "DeskCue.Tray.exe"), "tray");
    const traySha256 = createHash("sha256").update("tray").digest("hex");

    const manifest = createPayloadManifest(temporaryRoot, {
      appVersion: "1.2.3",
      dotnetRuntimeVersion: "10.0.12",
      tray: {
        executableModifiedTimeMs: 1,
        executableSha256: traySha256,
        executableSize: 4,
        latestSourceModifiedTimeMs: 1,
        sourceFiles: [{
          modifiedTimeMs: 1,
          path: "apps/tray/DeskCue.Tray/Program.cs",
          sha256: "a".repeat(64),
          size: 1
        }]
      }
    });
    assert.deepEqual(manifest.files.map((file) => file.path), ["DeskCue.Tray.exe", "first.txt", "z/last.txt"]);
    assert.equal(manifest.appVersion, "1.2.3");
    assert.equal(manifest.node.version, "24.14.0");
    assert.equal(manifest.dotnet.runtimeVersion, "10.0.12");
    assert.equal(manifest.files.every((file) => /^[a-f0-9]{64}$/u.test(file.sha256)), true);
    assert.equal(JSON.parse(readFileSync(join(temporaryRoot, "payload-manifest.json"), "utf8")).schemaVersion, 1);
    assert.equal(verifyPayloadManifest(temporaryRoot, "1.2.3").appVersion, "1.2.3");

    writeFileSync(join(temporaryRoot, "first.txt"), "tampered");
    assert.throws(() => verifyPayloadManifest(temporaryRoot, "1.2.3"), /integrity verification/u);
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test("Inno contract is per-user, preserves data and has one tray autostart value", () => {
  const script = readFileSync(new URL("./DeskCue.iss", import.meta.url), "utf8");
  assert.match(script, /DefaultDirName=\{localappdata\}\\Programs\\DeskCue/u);
  assert.match(script, /PrivilegesRequired=lowest/u);
  assert.match(script, /VersionInfoVersion=\{#AppVersion\}\.0/u);
  assert.match(
    script,
    /\[Tasks\][\s\S]*Name: "autostart"; Description: "Start DeskCue when I sign in";[\s\S]*Flags: checkedonce/u
  );
  assert.match(script, /ValueName: "DeskCue"; ValueData: """\{app\}\\DeskCue\.Tray\.exe"" --autostart"/u);
  assert.match(script, /Tasks: autostart; Check: ShouldInitializeAutostart/u);
  assert.doesNotMatch(script, /uninsdeletevalue/u);
  assert.match(
    script,
    /function ShouldInitializeAutostart:[\s\S]*Result := not HadPreviousInstall;[\s\S]*end;/u
  );
  assert.equal(
    (script.match(/ValueName: "DeskCue"; ValueData: """\{app\}\\DeskCue\.Tray\.exe"" --autostart"/g) ?? [])
      .length,
    1
  );
  assert.doesNotMatch(script, /\{localappdata\}\\DeskCue\\data/u);
  assert.doesNotMatch(script, /\[UninstallDelete\]/u);
  assert.doesNotMatch(script, /\[InstallDelete\]/u);
  assert.match(script, /PayloadBackupDirectoryName = '\.deskcue-update-backup'/u);
  assert.match(script, /PayloadDiscardDirectoryName = '\.deskcue-update-discard'/u);
  assert.match(script, /PayloadCommitMarkerName = '\.deskcue-update-committed'/u);
  assert.match(script, /function BackupManagedPayload/u);
  assert.match(script, /function RestoreManagedPayload/u);
  assert.match(script, /procedure DeinitializeSetup/u);
  assert.match(
    script,
    /payload-manifest\.json"; DestDir: "\{app\}";[\s\S]*DestName: "\.deskcue-update-committed";[\s\S]*Check: ShouldWritePayloadCommitMarker/u
  );
  assert.match(script, /ValueName: "PayloadCommitted"; ValueData: "1"; Check: ShouldWritePayloadCommitMarker/u);
  assert.match(script, /HasCommittedPayload := FileExists\(PayloadCommitMarker\) and IsPayloadCommitRegistered/u);
  assert.match(script, /if HasCommittedPayload then[\s\S]*DelTree\(PayloadBackupRoot/u);
  assert.match(script, /Result := ExpandConstant\('\{app\}\\'\) \+ PayloadCommitMarkerName/u);
  assert.match(script, /DelTree\(PayloadBackupRoot[\s\S]*DirExists\(PayloadBackupRoot\)[\s\S]*ClearPayloadCommitAuthority/u);
  assert.match(
    script,
    /function ClearPayloadCommitAuthority: Boolean[\s\S]*RegValueExists\(HKCU, DeskCueInstallerStateKey[\s\S]*FileExists\(PayloadCommitMarker\)[\s\S]*TESTFAILCOMMITCLEAR/u
  );
  assert.match(script, /procedure FinalizePayloadBackup[\s\S]*if DelTree\(PayloadBackupRoot/u);
  assert.doesNotMatch(script, /RenameFile\(PayloadBackupRoot, PayloadDiscardRoot\)/u);
  assert.match(script, /ValueName: "Path";[\s\S]*ValueData: "\{code:UpdatedUserPath\}"/u);
  assert.match(script, /DestName: "\.deskcue-path-owned";[\s\S]*Check: ShouldAddDeskCueToUserPath/u);
  assert.match(
    script,
    /procedure DeinitializeSetup[\s\S]*if PathNeedsInstall then[\s\S]*RemoveDeskCueFromUserPath[\s\S]*DeleteFile\(PathOwnershipMarker\)[\s\S]*RestoreManagedPayload/u
  );
  assert.doesNotMatch(script, /SetSetupExitCode/u);
  assert.match(script, /Root: HKLM; Subkey: "Software\\DeskCueInstallerFailureProbe"[\s\S]*ShouldInjectPostCopyFailure/u);
  assert.doesNotMatch(script, /schtasks|taskkill|Windows Service/iu);
  assert.match(script, /--shutdown-for-update/u);
  assert.match(script, /host shutdown --wait --timeout 15000/u);
  assert.match(script, /function RemoveOwnedDeskCueAutostart: Boolean/u);
  assert.match(
    script,
    /ReadUserRegistryStringValue\([\s\S]*DeskCueAutostartKey[\s\S]*RegistryStatus = RegistryValueMissing[\s\S]*RegistryStatus <> RegistryValueStringPresent[\s\S]*Result := False[\s\S]*CompareText\(CurrentValue, ExpectedValue\) <> 0[\s\S]*TESTFAILREGISTRYCLEANUP[\s\S]*RegDeleteValue\(HKCU, DeskCueAutostartKey/u
  );
  assert.match(
    script,
    /function RemoveDeskCueFromUserPath: Boolean[\s\S]*ReadUserRegistryStringValue\([\s\S]*UserEnvironmentKey[\s\S]*RegistryStatus = RegistryValueMissing[\s\S]*RegistryStatus <> RegistryValueStringPresent[\s\S]*Result := False[\s\S]*PathContainsEntry\(ExistingPath, DeskCueBinPath\)[\s\S]*TESTFAILREGISTRYCLEANUP/u
  );
  assert.match(script, /if not RemoveOwnedDeskCueAutostart then[\s\S]*not RemoveDeskCueFromUserPath then/u);
  assert.match(script, /PathOwnershipMarkerName = '\.deskcue-path-owned'/u);
  assert.match(
    script,
    /if FileExists\(PathOwnershipMarker\) then[\s\S]*not RemoveDeskCueFromUserPath then[\s\S]*DeleteFile\(PathOwnershipMarker\)/u
  );
  assert.match(script, /TESTFAILREGISTRYCLEANUP/u);
  assert.match(
    script,
    /function InitializeSetup: Boolean[\s\S]*ReadUserRegistryStringValue\([\s\S]*UserEnvironmentKey[\s\S]*RegistryValueReadError[\s\S]*RegistryValueWrongType[\s\S]*RaiseException\('DeskCue could not read the existing user PATH safely/u
  );
  assert.match(script, /RegOpenKeyExW@advapi32\.dll stdcall/u);
  assert.match(script, /RegQueryValueExW@advapi32\.dll stdcall/u);
  assert.match(script, /RegCloseKey@advapi32\.dll stdcall/u);
  assert.match(script, /ErrorFileNotFound = 2/u);
  assert.match(script, /ErrorAccessDenied = 5/u);
  assert.match(script, /RegistryValueMissing = 0/u);
  assert.match(script, /RegistryValueWrongType = 2/u);
  assert.match(script, /RegistryValueReadError = 3/u);
  assert.match(
    script,
    /OpenStatus := RegOpenKeyExW[\s\S]*OpenStatus = ErrorFileNotFound[\s\S]*OpenStatus <> ErrorSuccess[\s\S]*TESTFAILREGISTRYACCESSDENIED[\s\S]*QueryStatus := RegQueryValueExW[\s\S]*QueryStatus = ErrorFileNotFound[\s\S]*QueryStatus <> ErrorSuccess/u
  );
  assert.match(script, /VersionInfoVersion=\{#AppVersion\}\.0/u);
  assert.doesNotMatch(
    script,
    /procedure CurUninstallStepChanged[\s\S]*ReadCommandLineFlag\('\/TESTFAILREGISTRYCLEANUP'\)[\s\S]*RaiseException\('Injected registry cleanup failure\.'/u
  );
  assert.match(script, /ConfirmUninstall=.*PATH entry, shortcuts, and autostart entry.*data will be kept/u);
  assert.match(script, /UninstalledAll=.*data remains at \{localappdata\}\\DeskCue/u);
  assert.match(script, /DeskCue adds .*\{app\}\\bin.*user PATH/u);
  assert.match(script, /Open a new terminal after setup/u);
  assert.match(script, /SetupIconFile=\{#DeskCueIconFile\}/u);
  assert.match(script, /CliShimPath := ExpandConstant\('\{app\}\\bin\\deskcue\.cmd'\)/u);
  assert.match(script, /ExpandConstant\('\{cmd\}'\)/u);
  assert.match(script, /Automatic updates are not configured for this preview/u);
  assert.match(script, /uninstall it, then run[\s\S]*installer again/u);
});
