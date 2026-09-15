import assert from "node:assert/strict";
import test from "node:test";

import {
  compareUpdateVersions,
  parseUpdateManifest,
  selectUpdateArtifact,
  UpdateError
} from "../dist/index.js";

function validManifest(overrides = {}) {
  return {
    schemaVersion: 1,
    channel: "stable",
    version: "0.2.0",
    publishedAt: "2026-09-13T10:00:00.000Z",
    artifacts: [{
      platform: "win32",
      architecture: "x64",
      url: "https://github.com/AleksandrKornev/DeskCue/releases/download/v0.2.0/DeskCueSetup.exe",
      sizeBytes: 4,
      sha256: "a".repeat(64)
    }],
    ...overrides
  };
}

test("parses a strict manifest and selects the requested architecture", () => {
  const manifest = parseUpdateManifest(validManifest());

  assert.equal(manifest.version, "0.2.0");
  assert.equal(selectUpdateArtifact(manifest, "win32", "x64").architecture, "x64");
  assert.throws(
    () => selectUpdateArtifact(manifest, "win32", "arm64"),
    (error) => error instanceof UpdateError && error.code === "invalid_manifest"
  );
});

test("selects distinct Windows and Linux artifacts", () => {
  const manifest = parseUpdateManifest(validManifest({
    artifacts: [
      validManifest().artifacts[0],
      {
        platform: "linux",
        architecture: "x64",
        url: "https://github.com/AleksandrKornev/DeskCue/releases/download/v0.2.0/deskcue-linux.tar.gz",
        sizeBytes: 5,
        sha256: "b".repeat(64)
      }
    ]
  }));

  assert.equal(selectUpdateArtifact(manifest, "win32", "x64").sha256, "a".repeat(64));
  assert.equal(selectUpdateArtifact(manifest, "linux", "x64").sha256, "b".repeat(64));
});

test("rejects missing, unknown and malformed manifest fields", () => {
  const withUnknown = validManifest({ unexpected: true });
  const withoutVersion = validManifest();
  delete withoutVersion.version;

  assert.throws(() => parseUpdateManifest(withUnknown), /missing or unsupported fields/);
  assert.throws(() => parseUpdateManifest(withoutVersion), /missing or unsupported fields/);
  assert.throws(() => parseUpdateManifest(validManifest({ version: "01.2.3" })), /Invalid update version/);
  assert.throws(
    () => parseUpdateManifest(validManifest({ publishedAt: "2026-09-13" })),
    /must be an ISO date-time/
  );
  assert.throws(
    () => parseUpdateManifest(validManifest({ version: "0.2.0-beta.1" })),
    /Stable update manifests cannot contain prerelease/
  );
});

test("rejects duplicate targets and invalid artifact metadata", () => {
  const duplicate = validManifest();
  duplicate.artifacts.push({ ...duplicate.artifacts[0] });
  const badHash = validManifest();
  badHash.artifacts[0].sha256 = "ABC";

  assert.throws(() => parseUpdateManifest(duplicate), /repeats artifact target/);
  assert.throws(() => parseUpdateManifest(badHash), /lowercase hexadecimal/);
});

test("compares semantic versions without treating build metadata as precedence", () => {
  assert.equal(compareUpdateVersions("1.2.3", "1.2.3+build.2"), 0);
  assert.equal(compareUpdateVersions("1.2.3", "1.2.3-beta.2"), 1);
  assert.equal(compareUpdateVersions("1.2.3-beta.11", "1.2.3-beta.2"), 1);
  assert.equal(compareUpdateVersions("2.0.0", "10.0.0"), -1);
});
