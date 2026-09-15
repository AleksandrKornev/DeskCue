#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY = "AleksandrKornev/DeskCue";
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const UPDATE_ARTIFACT_PATTERNS = [
  {
    architecture: "x64",
    fileName: (version) => `DeskCueSetup-${version}-win-x64.exe`,
    platform: "win32"
  },
  {
    architecture: "x64",
    fileName: (version) => `deskcue-${version}-linux-x64.tar.gz`,
    platform: "linux"
  },
  {
    architecture: "arm64",
    fileName: (version) => `deskcue-${version}-linux-arm64.tar.gz`,
    platform: "linux"
  }
];

function parseArguments(args) {
  const options = { channel: "stable", directory: null, publishedAt: null, version: null };

  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];

    if (!value) throw new Error(`Missing value for ${name}.`);
    if (name === "--channel") options.channel = value;
    else if (name === "--directory") options.directory = resolve(value);
    else if (name === "--published-at") options.publishedAt = value;
    else if (name === "--version") options.version = value;
    else throw new Error(`Unknown argument: ${name}`);
  }

  if (!options.directory || !options.version) throw new Error("Pass --directory and --version.");
  if (!VERSION_PATTERN.test(options.version)) throw new Error("Version must be SemVer-compatible.");
  if (options.channel !== "stable" && options.channel !== "beta") throw new Error("Invalid release channel.");
  if (options.channel === "stable" && options.version.includes("-")) {
    throw new Error("Stable release metadata cannot target a prerelease version.");
  }

  const publishedAt = options.publishedAt ?? new Date().toISOString();

  if (new Date(publishedAt).toISOString() !== publishedAt) throw new Error("Invalid publication timestamp.");

  return { ...options, publishedAt };
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function createUpdateManifest(options) {
  const artifacts = UPDATE_ARTIFACT_PATTERNS.map((target) => {
    const fileName = target.fileName(options.version);
    const filePath = join(options.directory, fileName);
    const fileStats = statSync(filePath);

    if (!fileStats.isFile() || fileStats.size <= 0) throw new Error(`Invalid release artifact: ${fileName}`);

    return {
      architecture: target.architecture,
      platform: target.platform,
      sha256: sha256(filePath),
      sizeBytes: fileStats.size,
      url: `https://github.com/${REPOSITORY}/releases/download/v${options.version}/${fileName}`
    };
  });

  return {
    artifacts,
    channel: options.channel,
    publishedAt: options.publishedAt,
    schemaVersion: 1,
    version: options.version
  };
}

function writeChecksums(directory) {
  const excluded = new Set(["SHA256SUMS"]);
  const lines = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !excluded.has(entry.name) && !entry.name.endsWith(".sha256"))
    .map((entry) => ({ name: entry.name, sha256: sha256(join(directory, entry.name)) }))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => `${entry.sha256}  ${entry.name}`);

  writeFileSync(join(directory, "SHA256SUMS"), `${lines.join("\n")}\n`, "utf8");
}

export function createReleaseMetadata(options) {
  const manifest = createUpdateManifest(options);
  const manifestName = options.channel === "stable"
    ? "update-manifest-v1.json"
    : "update-manifest-v1-beta.json";

  writeFileSync(join(options.directory, manifestName), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  writeFileSync(join(options.directory, "release-version.txt"), `${options.version}\n`, "utf8");
  writeChecksums(options.directory);

  return { manifest, manifestName };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createReleaseMetadata(parseArguments(process.argv.slice(2)));
}
