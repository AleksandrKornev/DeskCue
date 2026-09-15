import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createInitialUpdateState,
  FileUpdateStateStore,
  launchLinuxArchiveApplyHandoff,
  UpdateManager
} from "../dist/index.js";

const RELEASE_HOST = "releases.example.test";

async function fixture() {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-linux-update-manager-"));
  const stateStore = new FileUpdateStateStore(
    join(tempDir, "state.json"),
    createInitialUpdateState({ architecture: "x64", channel: "stable", currentVersion: "0.1.1" })
  );

  return { stateStore, tempDir };
}

function linuxArtifact(version, bytes) {
  return {
    architecture: "x64",
    platform: "linux",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.byteLength,
    url: `https://${RELEASE_HOST}/deskcue-${version}-linux-x64.tar.gz`
  };
}

test("selects and stages a Linux archive without Windows installer arguments", async () => {
  const { stateStore, tempDir } = await fixture();
  const bytes = new TextEncoder().encode("linux archive");
  const releaseManifest = {
    artifacts: [linuxArtifact("0.2.0", bytes)],
    channel: "stable",
    publishedAt: "2026-09-13T10:00:00.000Z",
    schemaVersion: 1,
    version: "0.2.0"
  };
  const manager = new UpdateManager({
    allowedHosts: [RELEASE_HOST],
    architecture: "x64",
    channel: "stable",
    currentVersion: "0.1.1",
    fetch: async (url) => String(url).endsWith("stable.json")
      ? Response.json(releaseManifest)
      : new Response(bytes, { headers: { "content-length": String(bytes.byteLength) }, status: 200 }),
    manifestUrl: `https://${RELEASE_HOST}/stable.json`,
    platform: "linux",
    requestTimeoutMs: 1_000,
    stageDirectory: join(tempDir, "staged"),
    stateStore
  });

  try {
    await manager.checkForUpdate();
    const staged = await manager.downloadAvailableUpdate();
    const handoff = await manager.prepareApply();

    assert.match(staged.stagedPath, /deskcue-0\.2\.0-linux-x64\.tar\.gz$/u);
    assert.deepEqual(handoff.arguments, []);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("launches the Linux apply worker with a verified archive and bounded arguments", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-linux-apply-launch-"));
  const installRootPath = join(tempDir, "deskcue");
  const artifactPath = join(tempDir, "deskcue-0.2.0-linux-x64.tar.gz");
  const bytes = Buffer.from("linux archive");
  let invocation;

  await mkdir(installRootPath);
  await writeFile(join(installRootPath, "payload-manifest.json"), "{}\n");
  await writeFile(artifactPath, bytes);

  try {
    const result = await launchLinuxArchiveApplyHandoff({
      arguments: [],
      artifact: linuxArtifact("0.2.0", bytes),
      currentVersion: "0.1.1",
      installerPath: artifactPath,
      targetVersion: "0.2.0"
    }, {
      installRootPath,
      platform: "linux",
      runTransientUnit: async (unitName, file, args) => {
        invocation = { args, file, unitName };
      },
      unitPath: join(tempDir, "systemd", "user", "deskcue-host.service")
    });

    assert.equal(result.pid, null);
    assert.equal(invocation.file, process.execPath);
    assert.match(invocation.unitName, /^deskcue-update-[0-9a-f-]+\.service$/u);
    assert.equal(invocation.args.includes("--target-version"), true);
    assert.equal(invocation.args.includes("0.2.0"), true);
    assert.equal(invocation.args.includes("--unit-path"), true);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("rejects a relative Linux install root before launching a worker", async () => {
  const bytes = Buffer.from("linux archive");

  await assert.rejects(
    launchLinuxArchiveApplyHandoff({
      arguments: [],
      artifact: linuxArtifact("0.2.0", bytes),
      currentVersion: "0.1.1",
      installerPath: "unused.tar.gz",
      targetVersion: "0.2.0"
    }, {
      installRootPath: "deskcue",
      platform: "linux"
    }),
    /program directory must be absolute/u
  );
});
