#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  WINDOWS_INSTALLER_NODE_ARCHIVE,
  WINDOWS_INSTALLER_NODE_ARCHIVE_SHA256,
  WINDOWS_INSTALLER_NODE_ARCHIVE_URL,
  WINDOWS_INSTALLER_NODE_VERSION,
  copyDeskCueBuild,
  copyDotnetNotices,
  copyTrayExecutable,
  createPayloadManifest,
  createTrayBuildIdentity,
  removeSafePayloadDirectory,
  resetSafePayloadDirectory,
  runPayloadSmoke,
  validatePayloadContents,
  verifyPayloadManifest,
  writeDeskCueCommandShim
} from "./payload-lib.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = resolve(scriptDirectory, "..", "..");

function readArguments(args) {
  const options = {
    nodeArchivePath: null,
    dotnetLicensePath: null,
    dotnetNoticesPath: null,
    dotnetRuntimeVersion: null,
    windowsDesktopLicensePath: null,
    outputPath: join(scriptDirectory, "dist", "payload"),
    repositoryRoot: defaultRepositoryRoot,
    skipBuild: false,
    skipSmoke: false,
    trayExecutablePath: null
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--skip-build") {
      options.skipBuild = true;
      continue;
    }
    if (argument === "--skip-smoke") {
      options.skipSmoke = true;
      continue;
    }

    const value = args[index + 1];
    if (!value) throw new Error(`Missing value for ${argument}`);
    index += 1;

    switch (argument) {
      case "--node-archive":
        options.nodeArchivePath = resolve(value);
        break;
      case "--dotnet-license":
        options.dotnetLicensePath = resolve(value);
        break;
      case "--dotnet-notices":
        options.dotnetNoticesPath = resolve(value);
        break;
      case "--dotnet-runtime-version":
        options.dotnetRuntimeVersion = value;
        break;
      case "--output":
        options.outputPath = resolve(value);
        break;
      case "--repo-root":
        options.repositoryRoot = resolve(value);
        break;
      case "--tray-exe":
        options.trayExecutablePath = resolve(value);
        break;
      case "--windowsdesktop-license":
        options.windowsDesktopLicensePath = resolve(value);
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function readAppVersion(repositoryRoot) {
  const packageManifest = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
  if (
    typeof packageManifest.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(packageManifest.version)
  ) {
    throw new Error("Root package.json must contain a SemVer-compatible version.");
  }

  return packageManifest.version;
}

function runRepositoryBuild(repositoryRoot) {
  const npmCliCandidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
  ].filter(Boolean);
  const npmCliPath = npmCliCandidates.find((candidatePath) => existsSync(candidatePath));
  if (!npmCliPath) throw new Error("Could not locate npm-cli.js for the production build.");

  const result = spawnSync(process.execPath, [npmCliPath, "run", "build"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: "inherit",
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(`DeskCue production build failed with exit code ${result.status}.`);
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

async function acquireNodeArchive(options) {
  const archivePath = options.nodeArchivePath ?? join(
    scriptDirectory,
    "dist",
    "downloads",
    WINDOWS_INSTALLER_NODE_ARCHIVE
  );
  mkdirSync(dirname(archivePath), { recursive: true });

  if (!existsSync(archivePath)) {
    if (options.nodeArchivePath) throw new Error(`Configured Node archive does not exist: ${archivePath}`);

    const response = await fetch(WINDOWS_INSTALLER_NODE_ARCHIVE_URL, { redirect: "error" });
    if (!response.ok) throw new Error(`Node archive download failed with HTTP ${response.status}.`);

    const temporaryPath = `${archivePath}.partial`;
    writeFileSync(temporaryPath, Buffer.from(await response.arrayBuffer()));
    renameSync(temporaryPath, archivePath);
  }

  const actualSha256 = sha256(archivePath);
  if (actualSha256 !== WINDOWS_INSTALLER_NODE_ARCHIVE_SHA256) {
    throw new Error(
      `Node archive checksum mismatch: expected ${WINDOWS_INSTALLER_NODE_ARCHIVE_SHA256}, ` +
      `received ${actualSha256}`
    );
  }

  return archivePath;
}

function copyBundledNode(archivePath, payloadRoot, repositoryRoot) {
  const extractionRoot = join(dirname(payloadRoot), "node-payload-extract");
  resetSafePayloadDirectory(extractionRoot, repositoryRoot);

  const quotedArchivePath = archivePath.replaceAll("'", "''");
  const quotedExtractionRoot = extractionRoot.replaceAll("'", "''");
  const expandCommand =
    `Expand-Archive -LiteralPath '${quotedArchivePath}' ` +
    `-DestinationPath '${quotedExtractionRoot}' -Force`;
  const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", expandCommand], {
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(`Could not extract bundled Node archive:\n${result.stderr || result.stdout}`);
  }

  const nodeRoot = join(extractionRoot, WINDOWS_INSTALLER_NODE_ARCHIVE.replace(/\.zip$/u, ""));
  const runtimeRoot = join(payloadRoot, "runtime");
  mkdirSync(runtimeRoot, { recursive: true });
  copyFileSync(join(nodeRoot, "node.exe"), join(runtimeRoot, "node.exe"));
  copyFileSync(join(nodeRoot, "LICENSE"), join(runtimeRoot, "LICENSE"));
  removeSafePayloadDirectory(extractionRoot, repositoryRoot);
}

function findDefaultTrayExecutable(repositoryRoot) {
  return join(
    repositoryRoot,
    "apps",
    "tray",
    "DeskCue.Tray",
    "bin",
    "Release",
    "net10.0-windows",
    "win-x64",
    "publish",
    "DeskCue.Tray.exe"
  );
}

function printCompilerNextStep(appVersion, payloadRoot) {
  const installerScriptPath = join(scriptDirectory, "DeskCue.iss");
  const compilerScriptPath = join(scriptDirectory, "compile-installer.ps1");
  process.stdout.write([
    "Windows payload is ready.",
    `Payload: ${payloadRoot}`,
    `Version: ${appVersion}`,
    "Compile the unsigned installer with:",
    `  pwsh -File \"${compilerScriptPath}\" -Version \"${appVersion}\" -PayloadDir \"${payloadRoot}\"`,
    `Inno source: ${installerScriptPath}`,
    ""
  ].join("\n"));
}

async function main() {
  if (process.platform !== "win32") throw new Error("The Windows x64 payload must be assembled on Windows.");
  if (process.version !== `v${WINDOWS_INSTALLER_NODE_VERSION}`) {
    throw new Error(
      `Run this builder with Node ${WINDOWS_INSTALLER_NODE_VERSION}; current runtime is ${process.version}.`
    );
  }

  const options = readArguments(process.argv.slice(2));
  const appVersion = readAppVersion(options.repositoryRoot);
  const trayExecutablePath = options.trayExecutablePath ?? findDefaultTrayExecutable(options.repositoryRoot);
  const trayBuildIdentity = createTrayBuildIdentity(options.repositoryRoot, trayExecutablePath);
  if (
    !options.dotnetLicensePath ||
    !options.dotnetNoticesPath ||
    !options.dotnetRuntimeVersion ||
    !options.windowsDesktopLicensePath
  ) {
    throw new Error(
      "Pass --dotnet-license, --dotnet-notices, --windowsdesktop-license, and --dotnet-runtime-version " +
      "from the exact .NET runtime packs used to publish the tray."
    );
  }
  if (!/^\d+\.\d+\.\d+$/u.test(options.dotnetRuntimeVersion)) {
    throw new Error("--dotnet-runtime-version must be an exact three-part runtime version.");
  }

  if (!options.skipBuild) runRepositoryBuild(options.repositoryRoot);

  resetSafePayloadDirectory(options.outputPath, options.repositoryRoot);

  const nodeArchivePath = await acquireNodeArchive(options);
  copyBundledNode(nodeArchivePath, options.outputPath, options.repositoryRoot);
  copyDeskCueBuild(options.repositoryRoot, options.outputPath);
  copyTrayExecutable(trayExecutablePath, options.outputPath);
  copyDotnetNotices(
    options.dotnetLicensePath,
    options.dotnetNoticesPath,
    options.windowsDesktopLicensePath,
    options.outputPath
  );
  writeDeskCueCommandShim(options.outputPath);
  validatePayloadContents(options.outputPath);
  if (!options.skipSmoke) runPayloadSmoke(options.outputPath);
  createPayloadManifest(options.outputPath, {
    appVersion,
    dotnetRuntimeVersion: options.dotnetRuntimeVersion,
    tray: trayBuildIdentity
  });
  verifyPayloadManifest(options.outputPath, appVersion);
  printCompilerNextStep(appVersion, options.outputPath);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
