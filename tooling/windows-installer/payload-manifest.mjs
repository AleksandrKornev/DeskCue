import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import {
  WINDOWS_INSTALLER_ARCH,
  WINDOWS_INSTALLER_NODE_ARCHIVE,
  WINDOWS_INSTALLER_NODE_ARCHIVE_SHA256,
  WINDOWS_INSTALLER_NODE_VERSION
} from "./payload-constants.mjs";
import { readJson, shouldCopyPayloadPath } from "./payload-filesystem.mjs";

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function walkFiles(directoryPath, prefix = "") {
  const files = [];

  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const entryPath = join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else if (lstatSync(entryPath).isSymbolicLink()) {
      throw new Error(`Payload must not contain symbolic links: ${relativePath}`);
    }
  }

  return files;
}

export function createPayloadManifest(payloadRoot, buildIdentity) {
  const manifestPath = join(payloadRoot, "payload-manifest.json");
  const files = walkFiles(payloadRoot)
    .filter((relativePath) => relativePath !== "payload-manifest.json")
    .sort()
    .map((relativePath) => {
      const filePath = join(payloadRoot, ...relativePath.split("/"));

      return {
        path: relativePath,
        sha256: sha256File(filePath),
        size: statSync(filePath).size
      };
    });
  const manifest = {
    schemaVersion: 1,
    appVersion: buildIdentity.appVersion,
    architecture: WINDOWS_INSTALLER_ARCH,
    dotnet: {
      runtimeVersion: buildIdentity.dotnetRuntimeVersion,
      runtimePacks: [
        "Microsoft.NETCore.App.Runtime.win-x64",
        "Microsoft.WindowsDesktop.App.Runtime.win-x64"
      ]
    },
    node: {
      archive: WINDOWS_INSTALLER_NODE_ARCHIVE,
      archiveSha256: WINDOWS_INSTALLER_NODE_ARCHIVE_SHA256,
      version: WINDOWS_INSTALLER_NODE_VERSION
    },
    tray: buildIdentity.tray,
    files
  };

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return manifest;
}

export function verifyPayloadManifest(payloadRoot, expectedAppVersion = null) {
  const manifestPath = join(payloadRoot, "payload-manifest.json");
  const manifest = readJson(manifestPath);

  if (manifest.schemaVersion !== 1) throw new Error("Unsupported Windows payload manifest schema.");
  if (manifest.architecture !== WINDOWS_INSTALLER_ARCH) throw new Error("Windows payload architecture mismatch.");
  if (manifest.node?.version !== WINDOWS_INSTALLER_NODE_VERSION) throw new Error("Bundled Node version mismatch.");
  if (manifest.node?.archiveSha256 !== WINDOWS_INSTALLER_NODE_ARCHIVE_SHA256) {
    throw new Error("Bundled Node archive identity mismatch.");
  }
  if (!/^\d+\.\d+\.\d+$/u.test(manifest.dotnet?.runtimeVersion ?? "")) {
    throw new Error("Bundled .NET runtime identity is missing or invalid.");
  }
  if (
    !/^[a-f0-9]{64}$/u.test(manifest.tray?.executableSha256 ?? "") ||
    !Number.isSafeInteger(manifest.tray?.executableSize) ||
    !Number.isSafeInteger(manifest.tray?.executableModifiedTimeMs) ||
    !Number.isSafeInteger(manifest.tray?.latestSourceModifiedTimeMs) ||
    manifest.tray.executableModifiedTimeMs < manifest.tray.latestSourceModifiedTimeMs ||
    !Array.isArray(manifest.tray?.sourceFiles) ||
    manifest.tray.sourceFiles.length === 0 ||
    manifest.tray.sourceFiles.some((file) => (
      typeof file.path !== "string" ||
      !file.path.startsWith("apps/tray/DeskCue.Tray/") ||
      !/^[a-f0-9]{64}$/u.test(file.sha256 ?? "") ||
      !Number.isSafeInteger(file.size) ||
      !Number.isSafeInteger(file.modifiedTimeMs)
    ))
  ) {
    throw new Error("Bundled tray source/build identity is missing or invalid.");
  }
  if (expectedAppVersion !== null && manifest.appVersion !== expectedAppVersion) {
    throw new Error(
      `Windows payload app version mismatch: expected ${expectedAppVersion}, received ${manifest.appVersion}`
    );
  }

  const actualPaths = walkFiles(payloadRoot)
    .filter((relativePath) => relativePath !== "payload-manifest.json")
    .sort();
  const recordedPaths = manifest.files.map((file) => file.path);

  if (new Set(recordedPaths).size !== recordedPaths.length) {
    throw new Error("Windows payload manifest contains duplicate paths.");
  }
  if (JSON.stringify(recordedPaths) !== JSON.stringify(actualPaths)) {
    throw new Error("Windows payload files differ from its manifest.");
  }

  for (const file of manifest.files) {
    const filePath = join(payloadRoot, ...file.path.split("/"));

    if (statSync(filePath).size !== file.size || sha256File(filePath) !== file.sha256) {
      throw new Error(`Windows payload file failed integrity verification: ${file.path}`);
    }
  }

  const trayExecutablePath = join(payloadRoot, "DeskCue.Tray.exe");
  if (
    statSync(trayExecutablePath).size !== manifest.tray.executableSize ||
    sha256File(trayExecutablePath) !== manifest.tray.executableSha256
  ) {
    throw new Error("Bundled tray executable differs from its source/build identity.");
  }

  return manifest;
}

export function validatePayloadContents(payloadRoot) {
  const forbiddenPaths = walkFiles(payloadRoot).filter((relativePath) => !shouldCopyPayloadPath(relativePath));

  if (forbiddenPaths.length > 0) {
    throw new Error(`Forbidden files entered the Windows payload:\n${forbiddenPaths.join("\n")}`);
  }

  const requiredPaths = [
    "DeskCue.Tray.exe",
    "LICENSE",
    "THIRD-PARTY-NOTICES.json",
    "app/apps/cli/dist/index.js",
    "app/apps/daemon/dist/index.js",
    "app/apps/host/dist/index.js",
    "app/apps/web/dist/index.html",
    "app/node_modules/@lydell/node-pty-win32-x64/package.json",
    "app/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
    "bin/deskcue.cmd",
    "licenses/dotnet/NETCore-LICENSE.txt",
    "licenses/dotnet/NETCore-ThirdPartyNotices.txt",
    "licenses/dotnet/WindowsDesktop-LICENSE.txt",
    "runtime/LICENSE",
    "runtime/node.exe"
  ];
  const missingPaths = requiredPaths.filter(
    (relativePath) => !existsSync(join(payloadRoot, ...relativePath.split("/")))
  );

  if (missingPaths.length > 0) {
    throw new Error(`Windows payload is incomplete:\n${missingPaths.join("\n")}`);
  }

  const commandShim = readFileSync(join(payloadRoot, "bin", "deskcue.cmd"), "utf8");

  for (const requiredSetting of [
    "DESKCUE_DISTRIBUTION_MODE=installed",
    "if not defined DESKCUE_DATA_DIR set \"DESKCUE_DATA_DIR=%LOCALAPPDATA%\\DeskCue\\data\"",
    "DESKCUE_HOST_ENTRY=%~dp0..\\app\\apps\\host\\dist\\index.js",
    "DESKCUE_NODE_EXECUTABLE=%~dp0..\\runtime\\node.exe"
  ]) {
    if (!commandShim.includes(requiredSetting)) {
      throw new Error(`Packaged CLI shim is missing required setting: ${requiredSetting}`);
    }
  }

  const foreignPtyPackages = walkFiles(join(payloadRoot, "app", "node_modules", "@lydell"))
    .filter((relativePath) => relativePath.startsWith("node-pty-") && !relativePath.startsWith("node-pty-win32-x64/"));

  if (foreignPtyPackages.length > 0) {
    throw new Error(`Foreign node-pty architecture entered the Windows x64 payload:\n${foreignPtyPackages.join("\n")}`);
  }
}
