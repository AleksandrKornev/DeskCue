import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";

import {
  copyPayloadTree,
  shouldCopyPayloadPath
} from "../windows-installer/payload-filesystem.mjs";

const UPDATE_MODE_BY_FORMAT = {
  deb: "external",
  standalone: "linux-standalone"
};
const LINUX_PACKAGE_ID = "io.deskcue.app";

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function walkFiles(directoryPath, prefix = "") {
  const files = [];

  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const entryPath = join(directoryPath, entry.name);

    if (entry.isDirectory()) files.push(...walkFiles(entryPath, relativePath));
    else if (entry.isFile()) files.push(relativePath);
    else throw new Error(`Linux payload cannot contain links or special files: ${relativePath}`);
  }

  return files;
}

function shellPreamble(updateMode) {
  return [
    "#!/bin/sh",
    "set -eu",
    'SCRIPT_PATH="$(readlink -f -- "$0")"',
    'DESKCUE_INSTALL_DIR="$(CDPATH= cd -- "$(dirname -- "$SCRIPT_PATH")/.." && pwd)"',
    "export DESKCUE_INSTALL_DIR",
    "export DESKCUE_DISTRIBUTION_MODE=installed",
    "export DESKCUE_HOST_LAUNCH_MODE=systemd-user",
    `export DESKCUE_UPDATE_APPLY_MODE=${updateMode}`,
    'export DESKCUE_HOST_ENTRY="$DESKCUE_INSTALL_DIR/app/apps/host/dist/index.js"',
    'export DESKCUE_NODE_EXECUTABLE="$DESKCUE_INSTALL_DIR/runtime/node"'
  ];
}

export function writeLinuxLaunchers(payloadRoot, format = "standalone") {
  const updateMode = UPDATE_MODE_BY_FORMAT[format];

  if (!updateMode) throw new Error(`Unsupported Linux package format: ${format}`);

  const binRoot = join(payloadRoot, "bin");

  mkdirSync(binRoot, { recursive: true });
  writeFileSync(join(binRoot, "deskcue"), [
    ...shellPreamble(updateMode),
    'exec "$DESKCUE_NODE_EXECUTABLE" "$DESKCUE_INSTALL_DIR/app/apps/cli/dist/index.js" "$@"',
    ""
  ].join("\n"), "utf8");
  writeFileSync(join(binRoot, "deskcue-host"), [
    ...shellPreamble(updateMode),
    'exec "$DESKCUE_NODE_EXECUTABLE" "$DESKCUE_HOST_ENTRY"',
    ""
  ].join("\n"), "utf8");
  chmodSync(join(binRoot, "deskcue"), 0o755);
  chmodSync(join(binRoot, "deskcue-host"), 0o755);
}

export function writeLinuxOwnershipMarker(payloadRoot, format = "standalone") {
  const updateMode = UPDATE_MODE_BY_FORMAT[format];

  if (!updateMode) throw new Error(`Unsupported Linux package format: ${format}`);

  writeFileSync(join(payloadRoot, "installation-owner.json"), `${JSON.stringify({
    packageId: LINUX_PACKAGE_ID,
    schemaVersion: 1,
    updateMode
  }, null, 2)}\n`, "utf8");
}

export function writeSystemdUnit(payloadRoot, executablePath = "%h/.local/lib/deskcue/bin/deskcue-host") {
  const unitRoot = join(payloadRoot, "systemd");

  mkdirSync(unitRoot, { recursive: true });
  writeFileSync(join(unitRoot, "deskcue-host.service"), [
    "[Unit]",
    "Description=DeskCue local Host",
    "After=network.target",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${executablePath}`,
    "Restart=on-failure",
    "RestartSec=2",
    "TimeoutStopSec=15",
    "",
    "[Install]",
    "WantedBy=default.target",
    ""
  ].join("\n"), "utf8");
}

export function createLinuxPayloadManifest(payloadRoot, identity) {
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
    appVersion: identity.appVersion,
    architecture: identity.architecture,
    files,
    node: {
      archive: identity.nodeArchive,
      archiveSha256: identity.nodeArchiveSha256,
      version: identity.nodeVersion
    },
    packageId: LINUX_PACKAGE_ID,
    platform: "linux",
    schemaVersion: 1
  };

  writeFileSync(join(payloadRoot, "payload-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return manifest;
}

export function validateLinuxPayload(payloadRoot, architecture, format = "standalone") {
  const requiredPaths = [
    "LICENSE",
    "THIRD-PARTY-NOTICES.json",
    "app/apps/cli/dist/index.js",
    "app/apps/daemon/dist/index.js",
    "app/apps/host/dist/index.js",
    "app/apps/web/dist/index.html",
    `app/node_modules/@lydell/node-pty-linux-${architecture}/package.json`,
    "app/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
    "bin/deskcue",
    "bin/deskcue-host",
    "installation-owner.json",
    "runtime/LICENSE",
    "runtime/node",
    "systemd/deskcue-host.service"
  ];
  const missing = requiredPaths.filter((relativePath) => !existsSync(join(payloadRoot, ...relativePath.split("/"))));

  if (missing.length > 0) throw new Error(`Linux payload is incomplete:\n${missing.join("\n")}`);

  const forbidden = walkFiles(payloadRoot).filter((relativePath) => !shouldCopyPayloadPath(relativePath));

  if (forbidden.length > 0) throw new Error(`Forbidden files entered the Linux payload:\n${forbidden.join("\n")}`);

  const foreignPtyPackages = readdirSync(join(payloadRoot, "app", "node_modules", "@lydell"))
    .filter((name) => name.startsWith("node-pty-") && name !== `node-pty-linux-${architecture}`);

  if (foreignPtyPackages.length > 0) {
    throw new Error(`Foreign node-pty packages entered the Linux payload:\n${foreignPtyPackages.join("\n")}`);
  }

  const expectedUpdateMode = UPDATE_MODE_BY_FORMAT[format];
  const cliShim = readFileSync(join(payloadRoot, "bin", "deskcue"), "utf8");

  for (const requiredSetting of [
    "DESKCUE_DISTRIBUTION_MODE=installed",
    "DESKCUE_HOST_LAUNCH_MODE=systemd-user",
    `DESKCUE_UPDATE_APPLY_MODE=${expectedUpdateMode}`,
    'DESKCUE_NODE_EXECUTABLE="$DESKCUE_INSTALL_DIR/runtime/node"'
  ]) {
    if (!cliShim.includes(requiredSetting)) throw new Error(`Linux CLI shim is missing ${requiredSetting}.`);
  }
}

export function verifyLinuxPayloadManifest(payloadRoot, expected = {}) {
  const manifestPath = join(payloadRoot, "payload-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  if (
    manifest.schemaVersion !== 1 ||
    manifest.packageId !== LINUX_PACKAGE_ID ||
    manifest.platform !== "linux"
  ) throw new Error("Invalid Linux payload manifest.");
  if (expected.appVersion && manifest.appVersion !== expected.appVersion) throw new Error("Payload version mismatch.");
  if (expected.architecture && manifest.architecture !== expected.architecture) {
    throw new Error("Payload architecture mismatch.");
  }

  const expectedFiles = walkFiles(payloadRoot)
    .filter((relativePath) => relativePath !== "payload-manifest.json")
    .sort();

  if (manifest.files.length !== expectedFiles.length) throw new Error("Payload manifest file count mismatch.");

  for (let index = 0; index < expectedFiles.length; index += 1) {
    const relativePath = expectedFiles[index];
    const entry = manifest.files[index];
    const filePath = join(payloadRoot, ...relativePath.split("/"));

    if (entry.path !== relativePath || entry.size !== statSync(filePath).size || entry.sha256 !== sha256File(filePath)) {
      throw new Error(`Payload manifest mismatch: ${relativePath}`);
    }
  }

  return manifest;
}

export function copyPayloadForDeb(sourceRoot, debRoot) {
  copyPayloadTree(sourceRoot, join(debRoot, "usr", "lib", "deskcue"));
}
