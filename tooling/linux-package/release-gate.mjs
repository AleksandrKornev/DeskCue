#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createServer } from "node:https";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync
} from "node:fs";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { promisify } from "node:util";

import {
  breakPayloadHost,
  rebuildPayloadManifest,
  rewritePayloadVersion,
  sha256File,
  stageReleaseArtifacts,
  streamFileResponse,
  writeUpdateManifest
} from "./release-gate-artifacts.mjs";
import {
  waitForFileContents,
  waitForRollbackState,
  waitForVersion
} from "./release-gate-health.mjs";

const execFileAsync = promisify(execFile);
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

function compareStableVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }

  return 0;
}

function parseArguments(arguments_) {
  const options = {
    architecture: null,
    baselineDirectory: null,
    baselineVersion: null,
    candidateDirectory: null,
    candidateVersion: null
  };

  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];

    if (!value) throw new Error(`Missing value for ${name}.`);
    if (name === "--arch") options.architecture = value;
    else if (name === "--baseline-dir") options.baselineDirectory = resolve(value);
    else if (name === "--baseline-version") options.baselineVersion = value;
    else if (name === "--candidate-dir") options.candidateDirectory = resolve(value);
    else if (name === "--candidate-version") options.candidateVersion = value;
    else throw new Error(`Unknown argument: ${name}`);
  }

  if (!options.baselineDirectory || !options.baselineVersion ||
      !options.candidateDirectory || !options.candidateVersion) {
    throw new Error("Pass baseline and candidate directories and versions.");
  }
  if (options.architecture !== "x64" && options.architecture !== "arm64") {
    throw new Error("--arch must be x64 or arm64.");
  }
  if (!VERSION_PATTERN.test(options.baselineVersion) || !VERSION_PATTERN.test(options.candidateVersion)) {
    throw new Error("Release-gate versions must be stable SemVer values.");
  }

  if (compareStableVersions(options.candidateVersion, options.baselineVersion) <= 0) {
    throw new Error("Candidate version must be newer than the baseline.");
  }

  return options;
}

function requireCiIsolation() {
  if (process.env.CI !== "true" || process.env.DESKCUE_RELEASE_GATE !== "1") {
    throw new Error("The destructive Linux release gate runs only in an explicitly isolated CI runner.");
  }
  if (typeof process.getuid !== "function" || process.getuid() === 0) {
    throw new Error("The Linux release gate must run as a non-root user.");
  }
  if (!process.env.RUNNER_TEMP || !isAbsolute(process.env.RUNNER_TEMP)) {
    throw new Error("RUNNER_TEMP must identify the isolated CI temporary directory.");
  }
}

function assertNativeArchitecture(architecture) {
  const expected = architecture === "x64" ? "x64" : "arm64";

  if (process.arch !== expected) {
    throw new Error(`Release gate ${architecture} must run natively; current Node architecture is ${process.arch}.`);
  }
}

function artifactPaths(directory, version, architecture) {
  const debArchitecture = architecture === "x64" ? "amd64" : "arm64";

  return {
    archive: join(directory, `deskcue-${version}-linux-${architecture}.tar.gz`),
    deb: join(directory, `deskcue_${version}_${debArchitecture}.deb`)
  };
}

function assertArtifact(path) {
  if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size <= 0) {
    throw new Error(`Release-gate artifact is missing: ${path}`);
  }
}

function pathExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;

    throw error;
  }
}

async function run(file, arguments_ = [], options = {}) {
  const result = await execFileAsync(file, arguments_, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  return result;
}

function assertCleanInstallPaths(paths) {
  for (const path of [paths.programRoot, paths.cliPath, paths.unitPath, paths.dataRoot]) {
    if (pathExists(path)) {
      throw new Error(`Release gate requires a clean ephemeral runner path: ${path}`);
    }
  }
}

function assertPathWithin(parent, child) {
  const parentPath = realpathSync(parent);
  const childPath = resolve(child);

  if (childPath !== parentPath && !childPath.startsWith(`${parentPath}${sep}`)) {
    throw new Error(`Refusing to use a release-gate path outside ${parentPath}: ${childPath}`);
  }
}

async function createCertificate(root) {
  const keyPath = join(root, "release-gate.key");
  const certificatePath = join(root, "release-gate.crt");

  await run("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=127.0.0.1",
    "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost",
    "-keyout", keyPath,
    "-out", certificatePath
  ]);

  return { certificatePath, keyPath };
}

async function startReleaseServer(root, certificatePath, keyPath) {
  const server = createServer({
    cert: readFileSync(certificatePath),
    key: readFileSync(keyPath)
  }, (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "https://127.0.0.1").pathname);
      const filePath = resolve(root, `.${pathname}`);

      if (!filePath.startsWith(`${resolve(root)}${sep}`) || !existsSync(filePath) || !statSync(filePath).isFile()) {
        response.writeHead(404).end();
        return;
      }

      streamFileResponse(response, filePath);
    } catch {
      response.writeHead(400).end();
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();

  if (!address || typeof address === "string") throw new Error("Release-gate HTTPS server has no TCP address.");

  return {
    baseUrl: `https://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose());
    })
  };
}

async function createBrokenArchive(
  candidateArchive,
  outputPath,
  scratchRoot,
  executionMarkerPath,
  version,
  architecture
) {
  const extractionRoot = join(scratchRoot, "broken-payload");

  await mkdir(extractionRoot, { recursive: true });
  await run("tar", ["-xzf", candidateArchive, "--directory", extractionRoot, "--strip-components=1"]);
  await rewritePayloadVersion(extractionRoot, version);
  await breakPayloadHost(extractionRoot, executionMarkerPath);
  rebuildPayloadManifest(extractionRoot, version, architecture);
  await run("tar", ["-czf", outputPath, "--directory", dirname(extractionRoot), basename(extractionRoot)]);
}

async function importServiceEnvironment(values) {
  for (const [name, value] of Object.entries(values)) process.env[name] = value;

  await run("systemctl", ["--user", "import-environment", ...Object.keys(values)]);
}

async function verifyAutostart(cliPath) {
  await run(cliPath, ["autostart", "status", "--json"]);
  await run(cliPath, ["autostart", "disable", "--json"]);
  const disabled = await run(cliPath, ["autostart", "status", "--json"]);

  if (JSON.parse(disabled.stdout).data?.autostart?.enabled !== false) {
    throw new Error("DeskCue autostart did not report disabled after the release-gate transition.");
  }

  await run(cliPath, ["autostart", "enable", "--json"]);
  const enabled = await run(cliPath, ["autostart", "status", "--json"]);

  if (JSON.parse(enabled.stdout).data?.autostart?.enabled !== true) {
    throw new Error("DeskCue autostart did not report enabled after the release-gate transition.");
  }
}

async function removeStandalone(paths) {
  await run("systemctl", ["--user", "disable", "--now", "deskcue-host.service"]);
  await rm(paths.cliPath, { force: true });
  await rm(paths.unitPath, { force: true });
  await rm(paths.programRoot, { force: true, recursive: true });
  await run("systemctl", ["--user", "daemon-reload"]);
}

async function printFailureDiagnostics(dataRoot) {
  await execFileAsync("systemctl", ["--user", "status", "deskcue-host.service", "--no-pager"], {
    encoding: "utf8"
  }).then(({ stdout, stderr }) => process.stderr.write(`${stdout}${stderr}`)).catch(() => undefined);
  await execFileAsync("journalctl", ["--user", "-u", "deskcue-host.service", "-n", "100", "--no-pager"], {
    encoding: "utf8"
  }).then(({ stdout, stderr }) => process.stderr.write(`${stdout}${stderr}`)).catch(() => undefined);

  const updateStatePath = join(dataRoot, "service", "update-state.json");

  if (existsSync(updateStatePath)) process.stderr.write(await readFile(updateStatePath, "utf8"));
}

async function main() {
  requireCiIsolation();
  const options = parseArguments(process.argv.slice(2));

  assertNativeArchitecture(options.architecture);
  const baselineArtifacts = artifactPaths(
    options.baselineDirectory,
    options.baselineVersion,
    options.architecture
  );
  const candidateArtifacts = artifactPaths(
    options.candidateDirectory,
    options.candidateVersion,
    options.architecture
  );

  for (const path of Object.values({ ...baselineArtifacts, ...candidateArtifacts })) assertArtifact(path);

  const home = homedir();
  const paths = {
    cliPath: join(home, ".local", "bin", "deskcue"),
    dataRoot: join(home, ".local", "share", "deskcue", "data"),
    programRoot: join(home, ".local", "lib", "deskcue"),
    unitPath: join(home, ".config", "systemd", "user", "deskcue-host.service")
  };

  assertCleanInstallPaths(paths);
  await run("dpkg-query", ["-W", "-f=${Status}", "deskcue"]).then(() => {
    throw new Error("Release gate requires DeskCue to be absent from dpkg.");
  }).catch((error) => {
    if (error.message === "Release gate requires DeskCue to be absent from dpkg.") throw error;
  });

  assertPathWithin(home, paths.programRoot);
  assertPathWithin(home, paths.dataRoot);
  const temporaryRoot = await mkdtemp(join(realpathSync(process.env.RUNNER_TEMP), "deskcue-release-gate-"));
  const releaseRoot = join(temporaryRoot, "server");
  const gateRoot = join(releaseRoot, "gate");
  const brokenVersionParts = options.candidateVersion.split(".").map(Number);
  const brokenVersion = `${brokenVersionParts[0]}.${brokenVersionParts[1]}.${brokenVersionParts[2] + 1}`;
  const brokenArchive = join(gateRoot, `deskcue-${brokenVersion}-linux-${options.architecture}.tar.gz`);
  const brokenHostMarkerPath = join(temporaryRoot, "broken-host-started.txt");
  const manifestPath = join(gateRoot, "update-manifest-v1.json");
  const markerPath = join(paths.dataRoot, "service", "release-gate-marker.txt");
  let server = null;

  try {
    await mkdir(gateRoot, { recursive: true });
    await stageReleaseArtifacts(releaseRoot, options.baselineVersion, Object.values(baselineArtifacts));
    await stageReleaseArtifacts(releaseRoot, options.candidateVersion, Object.values(candidateArtifacts));
    await copyFile(candidateArtifacts.archive, join(gateRoot, basename(candidateArtifacts.archive)));
    await createBrokenArchive(
      candidateArtifacts.archive,
      brokenArchive,
      temporaryRoot,
      brokenHostMarkerPath,
      brokenVersion,
      options.architecture
    );
    const certificate = await createCertificate(temporaryRoot);

    server = await startReleaseServer(releaseRoot, certificate.certificatePath, certificate.keyPath);
    writeUpdateManifest(manifestPath, {
      architecture: options.architecture,
      artifactPath: candidateArtifacts.archive,
      baseUrl: server.baseUrl,
      version: options.candidateVersion
    });
    await importServiceEnvironment({
      DESKCUE_DAEMON_PORT: "45180",
      DESKCUE_PREVIEW_PROXY_PORT: "45181",
      DESKCUE_UPDATE_ALLOWED_HOSTS: "127.0.0.1",
      DESKCUE_UPDATE_MANIFEST_URL: `${server.baseUrl}/gate/update-manifest-v1.json`,
      NODE_EXTRA_CA_CERTS: certificate.certificatePath
    });

    const installerEnvironment = {
      ...process.env,
      CURL_CA_BUNDLE: certificate.certificatePath,
      DESKCUE_INSTALLER_RELEASE_BASE: `${server.baseUrl}/releases/download/v${options.baselineVersion}`
    };

    await run("sh", [resolve("install.sh"), "--version", options.baselineVersion], {
      env: installerEnvironment
    });
    await waitForVersion(paths.cliPath, options.baselineVersion);
    await verifyAutostart(paths.cliPath);
    await mkdir(paths.dataRoot, { recursive: true });
    await writeFile(markerPath, "preserve-through-release-gate\n", "utf8");

    await run(paths.cliPath, ["update", "--json"]);
    await waitForVersion(paths.cliPath, options.candidateVersion);
    if (await readFile(markerPath, "utf8") !== "preserve-through-release-gate\n") {
      throw new Error("Standalone update did not preserve the release-gate data marker.");
    }

    writeUpdateManifest(manifestPath, {
      architecture: options.architecture,
      artifactPath: brokenArchive,
      baseUrl: server.baseUrl,
      version: brokenVersion
    });
    await run(paths.cliPath, ["update", "--json"]);
    await waitForFileContents(
      brokenHostMarkerPath,
      "broken-host-started\n",
      `execution of the induced broken Host ${brokenVersion}`
    );
    await waitForRollbackState(
      join(paths.dataRoot, "service", "update-state.json"),
      options.candidateVersion,
      brokenVersion
    );
    await waitForVersion(paths.cliPath, options.candidateVersion);

    await removeStandalone(paths);
    const debEnvironment = {
      ...process.env,
      CURL_CA_BUNDLE: certificate.certificatePath,
      DESKCUE_INSTALLER_RELEASE_BASE: `${server.baseUrl}/releases/download/v${options.candidateVersion}`
    };

    await run("sh", [resolve("install.sh"), "--method", "deb", "--version", options.candidateVersion], {
      env: debEnvironment
    });
    await waitForVersion("/usr/bin/deskcue", options.candidateVersion);
    await run("systemctl", ["--user", "restart", "deskcue-host.service"]);
    await waitForVersion("/usr/bin/deskcue", options.candidateVersion);
    await verifyAutostart("/usr/bin/deskcue");
    await waitForVersion("/usr/bin/deskcue", options.candidateVersion);
    if (await readFile(markerPath, "utf8") !== "preserve-through-release-gate\n") {
      throw new Error("Debian installation did not preserve the release-gate data marker.");
    }

    await run("sudo", ["dpkg", "--remove", "deskcue"]);
    process.stdout.write([
      "DeskCue native Linux release gate passed",
      `  Architecture: ${options.architecture}`,
      `  Baseline: ${options.baselineVersion}`,
      `  Candidate: ${options.candidateVersion}`,
      `  Candidate SHA-256: ${sha256File(candidateArtifacts.archive)}`,
      `  Rollback target rejected: ${brokenVersion}`,
      "  Standalone clean install/update/rollback: passed",
      "  Debian package install/lifecycle/data preservation: passed",
      ""
    ].join("\n"));
  } catch (error) {
    await printFailureDiagnostics(paths.dataRoot);
    throw error;
  } finally {
    await execFileAsync("systemctl", ["--user", "disable", "--now", "deskcue-host.service"], {
      encoding: "utf8"
    }).catch(() => undefined);
    await execFileAsync("sudo", ["dpkg", "--remove", "deskcue"], { encoding: "utf8" }).catch(() => undefined);
    await rm(paths.cliPath, { force: true }).catch(() => undefined);
    await rm(paths.unitPath, { force: true }).catch(() => undefined);
    await rm(paths.programRoot, { force: true, recursive: true }).catch(() => undefined);
    await rm(paths.dataRoot, { force: true, recursive: true }).catch(() => undefined);
    await execFileAsync("systemctl", ["--user", "unset-environment",
      "DESKCUE_DAEMON_PORT", "DESKCUE_PREVIEW_PROXY_PORT", "DESKCUE_UPDATE_ALLOWED_HOSTS",
      "DESKCUE_UPDATE_MANIFEST_URL", "NODE_EXTRA_CA_CERTS"
    ], { encoding: "utf8" }).catch(() => undefined);
    if (server) await server.close().catch(() => undefined);
    await rm(temporaryRoot, { force: true, recursive: true }).catch(() => undefined);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
