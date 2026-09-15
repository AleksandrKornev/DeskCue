import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createLinuxPayloadManifest,
  validateLinuxPayload,
  verifyLinuxPayloadManifest,
  writeLinuxLaunchers,
  writeLinuxOwnershipMarker,
  writeSystemdUnit
} from "./payload-lib.mjs";

function writeFixtureFile(root, relativePath, contents = relativePath) {
  const filePath = join(root, ...relativePath.split("/"));

  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
}

function createPayloadFixture() {
  const root = mkdtempSync(join(tmpdir(), "deskcue-linux-payload-"));

  for (const relativePath of [
    "LICENSE",
    "THIRD-PARTY-NOTICES.json",
    "app/apps/cli/dist/index.js",
    "app/apps/daemon/dist/index.js",
    "app/apps/host/dist/index.js",
    "app/apps/web/dist/index.html",
    "app/node_modules/@lydell/node-pty-linux-x64/package.json",
    "app/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
    "runtime/LICENSE",
    "runtime/node"
  ]) writeFixtureFile(root, relativePath);

  writeLinuxLaunchers(root);
  writeLinuxOwnershipMarker(root);
  writeSystemdUnit(root);

  return root;
}

test("creates a standalone Linux payload with explicit lifecycle settings", () => {
  const root = createPayloadFixture();

  try {
    validateLinuxPayload(root, "x64");
    const cli = readFileSync(join(root, "bin", "deskcue"), "utf8");
    const unit = readFileSync(join(root, "systemd", "deskcue-host.service"), "utf8");

    assert.match(cli, /DESKCUE_UPDATE_APPLY_MODE=linux-standalone/u);
    assert.match(cli, /DESKCUE_HOST_LAUNCH_MODE=systemd-user/u);
    assert.match(unit, /ExecStart=%h\/\.local\/lib\/deskcue\/bin\/deskcue-host/u);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("binds every payload file to platform, architecture and version", () => {
  const root = createPayloadFixture();

  try {
    const manifest = createLinuxPayloadManifest(root, {
      appVersion: "0.3.0",
      architecture: "x64",
      nodeArchive: "node.tar.xz",
      nodeArchiveSha256: "a".repeat(64),
      nodeVersion: "24.14.0"
    });

    assert.equal(manifest.platform, "linux");
    assert.equal(manifest.packageId, "io.deskcue.app");
    assert.equal(manifest.files.some((entry) => entry.path === "bin/deskcue"), true);
    assert.deepEqual(verifyLinuxPayloadManifest(root, { appVersion: "0.3.0", architecture: "x64" }), manifest);

    writeFileSync(join(root, "bin", "deskcue"), "changed", "utf8");
    assert.throws(() => verifyLinuxPayloadManifest(root), /manifest mismatch/u);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("rejects a foreign native PTY package", () => {
  const root = createPayloadFixture();

  try {
    writeFixtureFile(root, "app/node_modules/@lydell/node-pty-win32-x64/package.json");
    assert.throws(() => validateLinuxPayload(root, "x64"), /Foreign node-pty packages/u);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
