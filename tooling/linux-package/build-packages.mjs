#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  copyDeskCueBuild,
  copyPayloadTree,
  resetSafePayloadDirectory
} from "../windows-installer/payload-lib.mjs";
import { LINUX_NODE_ARCHIVES, LINUX_NODE_VERSION, nodeArchiveUrl } from "./payload-constants.mjs";
import { runLinuxPayloadSmoke } from "./payload-smoke.mjs";
import {
  copyPayloadForDeb,
  createLinuxPayloadManifest,
  validateLinuxPayload,
  verifyLinuxPayloadManifest,
  writeLinuxLaunchers,
  writeLinuxOwnershipMarker,
  writeSystemdUnit
} from "./payload-lib.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..", "..");

function parseArguments(args) {
  const defaultArchitecture = process.arch === "arm64" ? "arm64" : "x64";
  const options = { architecture: defaultArchitecture, nodeArchivePath: null, skipBuild: false };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--skip-build") {
      options.skipBuild = true;
      continue;
    }

    const value = args[index + 1];

    if (!value) throw new Error(`Missing value for ${argument}.`);
    index += 1;

    if (argument === "--arch") options.architecture = value;
    else if (argument === "--node-archive") options.nodeArchivePath = resolve(value);
    else throw new Error(`Unknown argument: ${argument}`);
  }

  if (options.architecture !== "x64" && options.architecture !== "arm64") {
    throw new Error("--arch must be x64 or arm64.");
  }

  return options;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "inherit", ...options });

  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}.`);
}

function runRepositoryBuild() {
  const npmCliPath = process.env.npm_execpath;

  if (!npmCliPath) throw new Error("Run the Linux package builder through npm run build:linux-package.");

  run(process.execPath, [npmCliPath, "run", "build"], { cwd: repositoryRoot });
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

async function acquireNodeArchive(architecture, configuredPath) {
  const identity = LINUX_NODE_ARCHIVES[architecture];
  const archivePath = configuredPath ?? join(scriptDirectory, "dist", "downloads", identity.name);

  mkdirSync(dirname(archivePath), { recursive: true });
  if (!existsSync(archivePath)) {
    if (configuredPath) throw new Error(`Configured Node archive is missing: ${archivePath}`);

    const response = await fetch(nodeArchiveUrl(architecture), { redirect: "error" });

    if (!response.ok) throw new Error(`Node archive download failed with HTTP ${response.status}.`);

    const partialPath = `${archivePath}.partial`;

    writeFileSync(partialPath, Buffer.from(await response.arrayBuffer()));
    renameSync(partialPath, archivePath);
  }
  if (sha256(archivePath) !== identity.sha256) throw new Error("Node archive checksum mismatch.");

  return archivePath;
}

function copyBundledNode(archivePath, payloadRoot, architecture) {
  const extractionRoot = join(scriptDirectory, "dist", `node-payload-extract-${architecture}`);

  resetSafePayloadDirectory(extractionRoot, repositoryRoot);
  run("tar", ["-xJf", archivePath, "--directory", extractionRoot]);

  const nodeRoot = join(extractionRoot, LINUX_NODE_ARCHIVES[architecture].name.replace(/\.tar\.xz$/u, ""));
  const runtimeRoot = join(payloadRoot, "runtime");

  mkdirSync(runtimeRoot, { recursive: true });
  copyFileSync(join(nodeRoot, "bin", "node"), join(runtimeRoot, "node"));
  copyFileSync(join(nodeRoot, "LICENSE"), join(runtimeRoot, "LICENSE"));
  chmodSync(join(runtimeRoot, "node"), 0o755);
}

function readVersion() {
  return JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8")).version;
}

function writeDebControl(debRoot, version, architecture) {
  const debianRoot = join(debRoot, "DEBIAN");
  const debArchitecture = architecture === "x64" ? "amd64" : "arm64";

  mkdirSync(debianRoot, { recursive: true });
  writeFileSync(join(debianRoot, "control"), [
    "Package: deskcue",
    `Version: ${version}`,
    `Architecture: ${debArchitecture}`,
    "Maintainer: DeskCue contributors <support@deskcue.io>",
    "Depends: libc6 (>= 2.35), libgcc-s1, libstdc++6, systemd",
    "Section: utils",
    "Priority: optional",
    "Homepage: https://deskcue.io",
    "Description: Local-first control panel for CLI AI agents",
    " DeskCue monitors and controls local AI-agent sessions from a browser or phone.",
    ""
  ].join("\n"), "utf8");
}

function buildDeb(payloadRoot, version, architecture, outputRoot) {
  const debRoot = join(scriptDirectory, "dist", `deb-payload-${architecture}`);
  const debArchitecture = architecture === "x64" ? "amd64" : "arm64";
  const debPath = join(outputRoot, `deskcue_${version}_${debArchitecture}.deb`);

  resetSafePayloadDirectory(debRoot, repositoryRoot);
  copyPayloadForDeb(payloadRoot, debRoot);
  const installedPayloadRoot = join(debRoot, "usr", "lib", "deskcue");

  writeLinuxLaunchers(installedPayloadRoot, "deb");
  writeLinuxOwnershipMarker(installedPayloadRoot, "deb");
  writeSystemdUnit(installedPayloadRoot, "/usr/lib/deskcue/bin/deskcue-host");
  validateLinuxPayload(installedPayloadRoot, architecture, "deb");
  createLinuxPayloadManifest(installedPayloadRoot, {
    appVersion: version,
    architecture,
    nodeArchive: LINUX_NODE_ARCHIVES[architecture].name,
    nodeArchiveSha256: LINUX_NODE_ARCHIVES[architecture].sha256,
    nodeVersion: LINUX_NODE_VERSION
  });
  verifyLinuxPayloadManifest(installedPayloadRoot, { appVersion: version, architecture });
  mkdirSync(join(debRoot, "usr", "bin"), { recursive: true });
  writeFileSync(join(debRoot, "usr", "bin", "deskcue"), [
    "#!/bin/sh",
    'exec /usr/lib/deskcue/bin/deskcue "$@"',
    ""
  ].join("\n"), "utf8");
  chmodSync(join(debRoot, "usr", "bin", "deskcue"), 0o755);
  mkdirSync(join(debRoot, "usr", "lib", "systemd", "user"), { recursive: true });
  copyPayloadTree(
    join(debRoot, "usr", "lib", "deskcue", "systemd", "deskcue-host.service"),
    join(debRoot, "usr", "lib", "systemd", "user", "deskcue-host.service")
  );
  writeDebControl(debRoot, version, architecture);
  run("dpkg-deb", ["--root-owner-group", "--build", debRoot, debPath]);

  return debPath;
}

function writeChecksum(filePath) {
  writeFileSync(`${filePath}.sha256`, `${sha256(filePath)}  ${basename(filePath)}\n`, "utf8");
}

async function main() {
  if (process.platform !== "linux") throw new Error("Linux packages must be assembled on Linux.");

  const options = parseArguments(process.argv.slice(2));

  if (process.arch !== options.architecture) throw new Error("Build Linux packages on a native matching architecture.");
  if (process.version !== `v${LINUX_NODE_VERSION}`) {
    throw new Error(`Run the builder with Node ${LINUX_NODE_VERSION}; current runtime is ${process.version}.`);
  }
  if (!options.skipBuild) runRepositoryBuild();

  const version = readVersion();
  const payloadRoot = join(scriptDirectory, "dist", `payload-linux-${options.architecture}`);
  const outputRoot = join(scriptDirectory, "dist", "packages");
  const archivePath = join(outputRoot, `deskcue-${version}-linux-${options.architecture}.tar.gz`);
  const nodeArchivePath = await acquireNodeArchive(options.architecture, options.nodeArchivePath);

  resetSafePayloadDirectory(payloadRoot, repositoryRoot);
  copyBundledNode(nodeArchivePath, payloadRoot, options.architecture);
  copyDeskCueBuild(repositoryRoot, payloadRoot);
  writeLinuxLaunchers(payloadRoot);
  writeLinuxOwnershipMarker(payloadRoot);
  writeSystemdUnit(payloadRoot);
  validateLinuxPayload(payloadRoot, options.architecture);
  createLinuxPayloadManifest(payloadRoot, {
    appVersion: version,
    architecture: options.architecture,
    nodeArchive: LINUX_NODE_ARCHIVES[options.architecture].name,
    nodeArchiveSha256: LINUX_NODE_ARCHIVES[options.architecture].sha256,
    nodeVersion: LINUX_NODE_VERSION
  });
  verifyLinuxPayloadManifest(payloadRoot, { appVersion: version, architecture: options.architecture });
  runLinuxPayloadSmoke(payloadRoot, options.architecture);

  mkdirSync(outputRoot, { recursive: true });
  run("tar", ["-czf", archivePath, "--directory", dirname(payloadRoot), basename(payloadRoot)]);
  const debPath = buildDeb(payloadRoot, version, options.architecture, outputRoot);

  writeChecksum(archivePath);
  writeChecksum(debPath);
  process.stdout.write(`Linux packages ready:\n${archivePath}\n${debPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
