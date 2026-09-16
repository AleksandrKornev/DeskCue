import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  breakPayloadHost,
  rebuildPayloadManifest,
  rewritePayloadVersion,
  sha256File,
  stageReleaseArtifacts,
  writeUpdateManifest
} from "./release-gate-artifacts.mjs";

test("stages release assets and creates a strict local update manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "deskcue-release-gate-assets-"));

  try {
    const artifactPath = join(root, "deskcue-0.2.5-linux-x64.tar.gz");

    await writeFile(artifactPath, "candidate-artifact", "utf8");
    const versionRoot = await stageReleaseArtifacts(root, "0.2.5", [artifactPath]);
    const checksums = await readFile(join(versionRoot, "SHA256SUMS"), "utf8");

    assert.equal(checksums, `${sha256File(artifactPath)}  deskcue-0.2.5-linux-x64.tar.gz\n`);

    const manifestPath = join(root, "update-manifest-v1.json");
    const manifest = writeUpdateManifest(manifestPath, {
      architecture: "x64",
      artifactPath,
      baseUrl: "https://127.0.0.1:4443",
      version: "0.2.5"
    });

    assert.equal(manifest.version, "0.2.5");
    assert.deepEqual(Object.keys(manifest).sort(), [
      "artifacts", "channel", "publishedAt", "schemaVersion", "version"
    ]);
    assert.equal(manifest.artifacts[0].sha256, sha256File(artifactPath));
    assert.equal(manifest.artifacts[0].url, "https://127.0.0.1:4443/gate/deskcue-0.2.5-linux-x64.tar.gz");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("rewrites all runtime identities and rebinds an induced failure to the payload manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "deskcue-release-gate-payload-"));

  try {
    for (const appName of ["cli", "daemon", "host"]) {
      const appRoot = join(root, "app", "apps", appName);

      await mkdir(join(appRoot, "dist"), { recursive: true });
      await writeFile(join(appRoot, "package.json"), `${JSON.stringify({ version: "0.2.5" })}\n`, "utf8");
      await writeFile(join(appRoot, "dist", "index.js"), "export {};\n", "utf8");
    }
    await writeFile(join(root, "payload-manifest.json"), `${JSON.stringify({
      node: { archive: "node.tar.xz", archiveSha256: "a".repeat(64), version: "24.14.0" }
    })}\n`, "utf8");
    const executionMarkerPath = join(root, "broken-host-started.txt");

    await rewritePayloadVersion(root, "0.2.6");
    await breakPayloadHost(root, executionMarkerPath);
    const manifest = rebuildPayloadManifest(root, "0.2.6", "x64");

    for (const appName of ["cli", "daemon", "host"]) {
      const appManifest = JSON.parse(await readFile(join(root, "app", "apps", appName, "package.json"), "utf8"));

      assert.equal(appManifest.version, "0.2.6");
    }
    const brokenHost = await readFile(join(root, "app", "apps", "host", "dist", "index.js"), "utf8");

    assert.match(brokenHost, /induced Host startup failure/u);
    assert.match(brokenHost, /broken-host-started/u);
    assert.ok(brokenHost.includes(JSON.stringify(executionMarkerPath)));
    assert.equal(manifest.appVersion, "0.2.6");
    assert.equal(manifest.architecture, "x64");
    assert.ok(manifest.files.some((entry) => entry.path === "app/apps/host/dist/index.js"));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
