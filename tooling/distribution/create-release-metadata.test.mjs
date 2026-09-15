import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createReleaseMetadata } from "./create-release-metadata.mjs";

test("creates one strict multi-platform update manifest and complete checksums", () => {
  const directory = mkdtempSync(join(tmpdir(), "deskcue-release-metadata-"));
  const version = "0.3.0";

  try {
    for (const name of [
      `DeskCueSetup-${version}-win-x64.exe`,
      `deskcue-${version}-linux-x64.tar.gz`,
      `deskcue-${version}-linux-arm64.tar.gz`,
      `deskcue_${version}_amd64.deb`,
      `deskcue_${version}_arm64.deb`
    ]) writeFileSync(join(directory, name), name, "utf8");

    const result = createReleaseMetadata({
      channel: "stable",
      directory,
      publishedAt: "2026-09-15T12:00:00.000Z",
      version
    });
    const checksums = readFileSync(join(directory, "SHA256SUMS"), "utf8");

    assert.equal(result.manifest.artifacts.length, 3);
    assert.deepEqual(
      result.manifest.artifacts.map((artifact) => `${artifact.platform}-${artifact.architecture}`),
      ["win32-x64", "linux-x64", "linux-arm64"]
    );
    assert.match(checksums, /update-manifest-v1\.json/u);
    assert.match(checksums, /deskcue_0\.3\.0_arm64\.deb/u);
    assert.equal(checksums.includes("SHA256SUMS"), false);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
