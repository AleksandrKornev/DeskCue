import { readFileSync } from "node:fs";

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const PACKAGE_MANIFEST_URL = new URL("../../package.json", import.meta.url);

function readDeskCueVersion() {
  const manifest = JSON.parse(readFileSync(PACKAGE_MANIFEST_URL, "utf8")) as {
    version?: unknown;
  };
  if (typeof manifest.version !== "string" || !SEMVER_PATTERN.test(manifest.version)) {
    throw new Error("DeskCue daemon package version is invalid.");
  }
  return manifest.version;
}

export const DESKCUE_VERSION = readDeskCueVersion();
