#!/usr/bin/env node

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  assertSafeReplaceDirectory,
  copyPayloadTree,
  removeSafePayloadDirectory,
  verifyPayloadManifest
} from "./payload-lib.mjs";

function readArguments(args) {
  const [action, sourcePath, snapshotPath, repositoryRoot, expectedVersion] = args;
  if (!action || !snapshotPath || !repositoryRoot) {
    throw new Error(
      "Usage: compile-snapshot.mjs <create|verify|cleanup> <source-or-dash> <snapshot> <repository-root> [version]"
    );
  }

  return {
    action,
    expectedVersion: expectedVersion || null,
    repositoryRoot: resolve(repositoryRoot),
    snapshotPath: resolve(snapshotPath),
    sourcePath: sourcePath === "-" ? null : resolve(sourcePath)
  };
}

function createSnapshot(options) {
  if (!options.sourcePath) throw new Error("Creating a compile snapshot requires a source payload path.");

  assertSafeReplaceDirectory(options.snapshotPath, options.repositoryRoot);
  if (existsSync(options.snapshotPath)) {
    throw new Error(`Compile snapshot already exists: ${options.snapshotPath}`);
  }

  copyPayloadTree(options.sourcePath, options.snapshotPath);
  const manifest = verifyPayloadManifest(options.snapshotPath, options.expectedVersion);
  process.stdout.write(`Prepared verified private compile snapshot (${manifest.files.length} files).\n`);
}

function verifySnapshot(options) {
  const manifest = verifyPayloadManifest(options.snapshotPath, options.expectedVersion);
  process.stdout.write(`Verified exact compile snapshot (${manifest.files.length} files).\n`);
}

function cleanupSnapshot(options) {
  removeSafePayloadDirectory(options.snapshotPath, options.repositoryRoot);
  process.stdout.write("Removed private compile snapshot.\n");
}

function main() {
  const options = readArguments(process.argv.slice(2));
  if (options.action === "create") return createSnapshot(options);
  if (options.action === "verify") return verifySnapshot(options);
  if (options.action === "cleanup") return cleanupSnapshot(options);

  throw new Error(`Unknown compile snapshot action: ${options.action}`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}
