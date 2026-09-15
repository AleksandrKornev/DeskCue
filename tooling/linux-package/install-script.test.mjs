import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const installScriptPath = resolve(scriptDirectory, "..", "..", "install.sh");

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function writeExecutable(filePath, contents) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
  chmodSync(filePath, 0o755);
}

function writeRelease(root, version, healthy, reportedVersion = version) {
  const architecture = process.arch === "arm64" ? "arm64" : "x64";
  const releaseRoot = join(root, "release");
  const payloadParent = join(root, `payload-${version}`);
  const payloadRoot = join(payloadParent, `deskcue-${version}`);
  const artifactName = `deskcue-${version}-linux-${architecture}.tar.gz`;
  const artifactPath = join(releaseRoot, artifactName);
  const debName = `deskcue_${version}_${architecture === "x64" ? "amd64" : "arm64"}.deb`;
  const debPath = join(releaseRoot, debName);

  rmSync(payloadParent, { force: true, recursive: true });
  mkdirSync(join(payloadRoot, "runtime"), { recursive: true });
  mkdirSync(releaseRoot, { recursive: true });
  copyFileSync(process.execPath, join(payloadRoot, "runtime", "node"));
  chmodSync(join(payloadRoot, "runtime", "node"), 0o755);
  writeExecutable(join(payloadRoot, "bin", "deskcue"), healthy
    ? `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({
        data: {
          status: {
            daemon: { version: reportedVersion },
            host: { version: reportedVersion }
          }
        }
      })}'\n`
    : "#!/bin/sh\nexit 1\n");
  writeFileSync(join(payloadRoot, "installation-owner.json"), `${JSON.stringify({
    packageId: "io.deskcue.app",
    schemaVersion: 1,
    updateMode: "linux-standalone"
  }, null, 2)}\n`, "utf8");
  const files = ["bin/deskcue", "installation-owner.json", "systemd/deskcue-host.service"];
  mkdirSync(join(payloadRoot, "systemd"), { recursive: true });
  writeFileSync(
    join(payloadRoot, "systemd", "deskcue-host.service"),
    `[Unit]\nDescription=DeskCue ${version}\n[Service]\nExecStart=true\n`,
    "utf8"
  );
  writeFileSync(join(payloadRoot, "payload-manifest.json"), `${JSON.stringify({
    appVersion: version,
    architecture,
    files: files.map((path) => ({ path })),
    packageId: "io.deskcue.app",
    platform: "linux",
    schemaVersion: 1
  })}\n`, "utf8");

  const archive = spawnSync("tar", ["-czf", artifactPath, "-C", payloadParent, `deskcue-${version}`], {
    encoding: "utf8"
  });

  assert.equal(archive.status, 0, archive.stderr);
  writeFileSync(debPath, "test deb", "utf8");
  writeFileSync(join(releaseRoot, "SHA256SUMS"), [
    `${sha256(artifactPath)}  ${artifactName}`,
    `${sha256(debPath)}  ${debName}`,
    ""
  ].join("\n"), "utf8");

  return releaseRoot;
}

function runInstaller(root, homeRoot, releaseRoot, version, serviceState = {}) {
  const fakeBin = join(root, "fake-bin");

  writeExecutable(join(fakeBin, "systemctl"), [
    "#!/bin/sh",
    "set -eu",
    "printf '%s\\n' \"$*\" >> \"$SYSTEMCTL_LOG\"",
    "case \" $* \" in",
    "  *\" is-enabled \"*) if [ \"${FAKE_SERVICE_ENABLED:-true}\" = true ]; then exit 0; else exit 1; fi ;;",
    "  *\" is-active \"*) if [ \"${FAKE_SERVICE_ACTIVE:-true}\" = true ]; then exit 0; else exit 1; fi ;;",
    "esac",
    "case \" $* \" in",
    "  *\" enable \"*)",
    "    mkdir -p \"$XDG_CONFIG_HOME/systemd/user/default.target.wants\"",
    "    ln -sfn ../deskcue-host.service \"$XDG_CONFIG_HOME/systemd/user/default.target.wants/deskcue-host.service\"",
    "    ;;",
    "  *\" disable \"*)",
    "    rm -f \"$XDG_CONFIG_HOME/systemd/user/default.target.wants/deskcue-host.service\"",
    "    ;;",
    "esac",
    ""
  ].join("\n"));
  writeExecutable(join(fakeBin, "systemd-run"), "#!/bin/sh\nexit 0\n");
  writeExecutable(join(fakeBin, "sleep"), "#!/bin/sh\nexit 0\n");
  writeExecutable(join(fakeBin, "dpkg"), "#!/bin/sh\nexit 0\n");
  writeExecutable(join(fakeBin, "sudo"), "#!/bin/sh\nexit 0\n");
  writeExecutable(join(fakeBin, "dpkg-query"), [
    "#!/bin/sh",
    "if [ \"${FAKE_DEB_INSTALLED:-false}\" = true ]; then",
    "  printf '%s\\n' 'install ok installed'",
    "  exit 0",
    "fi",
    "exit 1",
    ""
  ].join("\n"));

  const args = [installScriptPath, "--version", version];

  if (serviceState.method) args.push("--method", serviceState.method);

  return spawnSync("sh", args, {
    encoding: "utf8",
    env: {
      ...process.env,
      DESKCUE_INSTALLER_RELEASE_BASE: pathToFileURL(releaseRoot).href,
      FAKE_SERVICE_ACTIVE: String(serviceState.active ?? true),
      FAKE_SERVICE_ENABLED: String(serviceState.enabled ?? true),
      FAKE_DEB_INSTALLED: String(serviceState.debInstalled ?? false),
      HOME: homeRoot,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      SYSTEMCTL_LOG: join(root, "systemctl.log"),
      XDG_CONFIG_HOME: join(homeRoot, ".config")
    }
  });
}

const linuxTest = process.platform === "linux" ? test : test.skip;

linuxTest("installs safely and restores the prior standalone version after failed health", () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-linux-install-script-"));
  const homeRoot = join(root, "home");
  const programRoot = join(homeRoot, ".local", "lib", "deskcue");
  const cliLink = join(homeRoot, ".local", "bin", "deskcue");

  try {
    const firstRelease = writeRelease(root, "0.3.0", true);
    const firstInstall = runInstaller(root, homeRoot, firstRelease, "0.3.0");

    assert.equal(firstInstall.status, 0, firstInstall.stderr);
    assert.equal(existsSync(join(programRoot, "payload-manifest.json")), true);
    assert.equal(readlinkSync(cliLink), join(programRoot, "bin", "deskcue"));

    const unhealthyRelease = writeRelease(root, "0.3.1", false);
    const failedUpdate = runInstaller(root, homeRoot, unhealthyRelease, "0.3.1");

    assert.equal(failedUpdate.status, 1);
    assert.match(failedUpdate.stderr, /previous version was restored/u);
    assert.equal(JSON.parse(readFileSync(join(programRoot, "payload-manifest.json"), "utf8")).appVersion, "0.3.0");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

linuxTest("refuses to overwrite an unrecognized per-user CLI path", () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-linux-install-ownership-"));
  const homeRoot = join(root, "home");
  const cliPath = join(homeRoot, ".local", "bin", "deskcue");

  try {
    const releaseRoot = writeRelease(root, "0.3.0", true);

    mkdirSync(dirname(cliPath), { recursive: true });
    writeFileSync(cliPath, "user-owned", "utf8");

    const installation = runInstaller(root, homeRoot, releaseRoot, "0.3.0");

    assert.equal(installation.status, 1);
    assert.match(installation.stderr, /unrecognized CLI path/u);
    assert.equal(readFileSync(cliPath, "utf8"), "user-owned");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

linuxTest("refuses a foreign program directory that only imitates the payload manifest", () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-linux-install-foreign-root-"));
  const homeRoot = join(root, "home");
  const programRoot = join(homeRoot, ".local", "lib", "deskcue");

  try {
    const releaseRoot = writeRelease(root, "0.3.0", true);

    mkdirSync(programRoot, { recursive: true });
    writeFileSync(join(programRoot, "payload-manifest.json"), "{}\n", "utf8");
    writeFileSync(join(programRoot, "user-file.txt"), "keep me", "utf8");

    const installation = runInstaller(root, homeRoot, releaseRoot, "0.3.0");

    assert.equal(installation.status, 1);
    assert.match(installation.stderr, /unrecognized directory/u);
    assert.equal(readFileSync(join(programRoot, "user-file.txt"), "utf8"), "keep me");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

linuxTest("refuses a user service symlink that points outside the DeskCue install", () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-linux-install-foreign-unit-"));
  const homeRoot = join(root, "home");
  const unitPath = join(homeRoot, ".config", "systemd", "user", "deskcue-host.service");
  const foreignUnitPath = join(homeRoot, "dotfiles", "deskcue-host.service");

  try {
    const releaseRoot = writeRelease(root, "0.3.0", true);
    const firstInstall = runInstaller(root, homeRoot, releaseRoot, "0.3.0");

    assert.equal(firstInstall.status, 0, firstInstall.stderr);
    mkdirSync(dirname(foreignUnitPath), { recursive: true });
    copyFileSync(unitPath, foreignUnitPath);
    rmSync(unitPath);
    symlinkSync(foreignUnitPath, unitPath);

    const installation = runInstaller(root, homeRoot, releaseRoot, "0.3.0");

    assert.equal(installation.status, 1);
    assert.match(installation.stderr, /unrecognized user service/u);
    assert.equal(readlinkSync(unitPath), foreignUnitPath);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

linuxTest("atomically replaces a matching hardlinked user service without modifying the other link", () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-linux-install-hardlinked-unit-"));
  const homeRoot = join(root, "home");
  const unitPath = join(homeRoot, ".config", "systemd", "user", "deskcue-host.service");
  const foreignUnitPath = join(homeRoot, "dotfiles", "deskcue-host.service");

  try {
    const firstRelease = writeRelease(root, "0.3.0", true);
    const firstInstall = runInstaller(root, homeRoot, firstRelease, "0.3.0");

    assert.equal(firstInstall.status, 0, firstInstall.stderr);
    mkdirSync(dirname(foreignUnitPath), { recursive: true });
    linkSync(unitPath, foreignUnitPath);
    const originalUnit = readFileSync(foreignUnitPath, "utf8");
    const originalInode = statSync(foreignUnitPath).ino;

    const nextRelease = writeRelease(root, "0.3.1", true);
    const update = runInstaller(root, homeRoot, nextRelease, "0.3.1");

    assert.equal(update.status, 0, update.stderr);
    assert.equal(readFileSync(foreignUnitPath, "utf8"), originalUnit);
    assert.match(readFileSync(unitPath, "utf8"), /DeskCue 0\.3\.1/u);
    assert.notEqual(statSync(unitPath).ino, originalInode);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

linuxTest("removes autostart ownership after an unhealthy first install", () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-linux-install-first-failure-"));
  const homeRoot = join(root, "home");
  const autostartLink = join(
    homeRoot,
    ".config",
    "systemd",
    "user",
    "default.target.wants",
    "deskcue-host.service"
  );

  try {
    const releaseRoot = writeRelease(root, "0.3.0", false);
    const installation = runInstaller(root, homeRoot, releaseRoot, "0.3.0");

    assert.equal(installation.status, 1);
    assert.match(installation.stderr, /incomplete installation was removed/u);
    assert.equal(existsSync(autostartLink), false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

linuxTest("preserves disabled and inactive service preferences across a standalone update", () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-linux-install-preferences-"));
  const homeRoot = join(root, "home");

  try {
    const firstRelease = writeRelease(root, "0.3.0", true);
    const firstInstall = runInstaller(root, homeRoot, firstRelease, "0.3.0");

    assert.equal(firstInstall.status, 0, firstInstall.stderr);
    writeFileSync(join(root, "systemctl.log"), "", "utf8");

    const secondRelease = writeRelease(root, "0.3.1", true);
    const update = runInstaller(root, homeRoot, secondRelease, "0.3.1", {
      active: false,
      enabled: false
    });
    const calls = readFileSync(join(root, "systemctl.log"), "utf8");

    assert.equal(update.status, 0, update.stderr);
    assert.match(calls, /--user disable deskcue-host\.service/u);
    assert.match(calls, /--user start deskcue-host\.service/u);
    assert.match(calls, /--user stop deskcue-host\.service/u);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

linuxTest("rejects a healthy response from a different DeskCue version", () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-linux-install-version-health-"));
  const homeRoot = join(root, "home");

  try {
    const releaseRoot = writeRelease(root, "0.3.0", true, "0.2.9");
    const installation = runInstaller(root, homeRoot, releaseRoot, "0.3.0");

    assert.equal(installation.status, 1);
    assert.match(installation.stderr, /incomplete installation was removed/u);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

linuxTest("refuses a standalone install while the Debian package is installed", () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-linux-install-deb-conflict-"));
  const homeRoot = join(root, "home");

  try {
    const releaseRoot = writeRelease(root, "0.3.0", true);
    const installation = runInstaller(root, homeRoot, releaseRoot, "0.3.0", { debInstalled: true });

    assert.equal(installation.status, 1);
    assert.match(installation.stderr, /Remove the Debian DeskCue package/u);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

linuxTest("refuses a Debian install while standalone user paths are present", () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-linux-install-standalone-conflict-"));
  const homeRoot = join(root, "home");

  try {
    const releaseRoot = writeRelease(root, "0.3.0", true);
    const standalone = runInstaller(root, homeRoot, releaseRoot, "0.3.0");

    assert.equal(standalone.status, 0, standalone.stderr);

    const installation = runInstaller(root, homeRoot, releaseRoot, "0.3.0", { method: "deb" });

    assert.equal(installation.status, 1);
    assert.match(installation.stderr, /Remove the standalone DeskCue installation/u);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

linuxTest("preserves disabled and inactive service preferences during a Debian update", () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-linux-install-deb-preferences-"));
  const homeRoot = join(root, "home");

  try {
    const releaseRoot = writeRelease(root, "0.3.0", true);
    const installation = runInstaller(root, homeRoot, releaseRoot, "0.3.0", {
      active: false,
      debInstalled: true,
      enabled: false,
      method: "deb"
    });
    const calls = readFileSync(join(root, "systemctl.log"), "utf8");

    assert.equal(installation.status, 1);
    assert.match(installation.stderr, /did not become healthy/u);
    assert.match(calls, /--user is-enabled --quiet deskcue-host\.service/u);
    assert.match(calls, /--user is-active --quiet deskcue-host\.service/u);
    assert.match(calls, /--user disable deskcue-host\.service/u);
    assert.match(calls, /--user start deskcue-host\.service/u);
    assert.match(calls, /--user stop deskcue-host\.service/u);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
