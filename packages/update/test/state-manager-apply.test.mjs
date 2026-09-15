import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createInitialUpdateState,
  FileUpdateStateStore,
  launchInstallerApplyHandoff,
  prepareInstallerApplyHandoff,
  UpdateError,
  UpdateManager
} from "../dist/index.js";

const RELEASE_HOST = "releases.example.test";

function manifest(version, bytes, overrides = {}) {
  return {
    schemaVersion: 1,
    channel: "stable",
    version,
    publishedAt: "2026-09-13T10:00:00.000Z",
    artifacts: [{
      platform: "win32",
      architecture: "x64",
      url: `https://${RELEASE_HOST}/DeskCueSetup-${version}.exe`,
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex")
    }],
    ...overrides
  };
}

async function fixture() {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-update-manager-"));
  const initial = createInitialUpdateState({
    architecture: "x64",
    channel: "stable",
    currentVersion: "0.1.1"
  });
  const stateStore = new FileUpdateStateStore(join(tempDir, "state.json"), initial);

  return { initial, stateStore, tempDir };
}

function createManager({ fetch, platform = "win32", stateStore, tempDir }) {
  return new UpdateManager({
    allowedHosts: [RELEASE_HOST],
    architecture: "x64",
    channel: "stable",
    currentVersion: "0.1.1",
    fetch,
    manifestUrl: `https://${RELEASE_HOST}/stable.json`,
    platform,
    requestTimeoutMs: 1_000,
    stageDirectory: join(tempDir, "staged"),
    stateStore
  });
}

test("persists update state through an atomic temporary file", async () => {
  const { initial, stateStore, tempDir } = await fixture();
  try {
    await stateStore.write({ ...initial, phase: "checking" });

    assert.equal((await stateStore.read()).phase, "checking");
    assert.equal(existsSync(stateStore.filePath), true);
    assert.equal((await readFile(stateStore.filePath, "utf8")).endsWith("\n"), true);
    assert.deepEqual((await readdir(tempDir)).filter((name) => name.endsWith(".tmp")), []);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("checks, downloads and prepares a reverified installer handoff", async () => {
  const { stateStore, tempDir } = await fixture();
  const bytes = new TextEncoder().encode("installer payload");
  const releaseManifest = manifest("0.2.0", bytes);
  const manager = createManager({
    fetch: async (url) => String(url).endsWith("stable.json")
      ? Response.json(releaseManifest)
      : new Response(bytes, {
          headers: { "content-length": String(bytes.byteLength) },
          status: 200
        }),
    stateStore,
    tempDir
  });

  try {
    const checked = await manager.checkForUpdate();
    assert.equal(checked.available, true);
    assert.equal((await manager.readState()).phase, "available");

    const staged = await manager.downloadAvailableUpdate();
    assert.equal(staged.phase, "staged");
    assert.equal(existsSync(staged.stagedPath), true);

    const handoff = await manager.prepareApply();
    assert.deepEqual(handoff.arguments, [
      "/VERYSILENT",
      "/SUPPRESSMSGBOXES",
      "/NORESTART",
      "/UPDATE",
      "/STARTTRAY=1"
    ]);
    assert.equal((await manager.readState()).phase, "applying");
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("rejects downgrade and cross-channel manifests", async () => {
  for (const releaseManifest of [
    manifest("0.1.0", new Uint8Array([1])),
    manifest("0.2.0", new Uint8Array([1]), { channel: "beta" })
  ]) {
    const { stateStore, tempDir } = await fixture();
    const manager = createManager({
      fetch: async () => Response.json(releaseManifest),
      stateStore,
      tempDir
    });

    try {
      await assert.rejects(
        manager.checkForUpdate(),
        (error) => error instanceof UpdateError && error.code === "invalid_manifest"
      );
      assert.equal((await manager.readState()).phase, "failed");
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  }
});

test("rejects an artifact URL outside the allowed release hosts during check", async () => {
  const { stateStore, tempDir } = await fixture();
  const bytes = new Uint8Array([1]);
  const releaseManifest = manifest("0.2.0", bytes);
  releaseManifest.artifacts[0].url = "https://evil.example.test/DeskCueSetup.exe";
  const manager = createManager({
    fetch: async () => Response.json(releaseManifest),
    stateStore,
    tempDir
  });

  try {
    await assert.rejects(
      manager.checkForUpdate(),
      (error) => error instanceof UpdateError && error.code === "invalid_update_source"
    );
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("reconciles stale applying state after the installed version changes", async () => {
  const { initial, stateStore, tempDir } = await fixture();
  const stagedPath = join(tempDir, "staged", "DeskCueSetup-0.2.0-win-x64.exe");

  await mkdir(join(tempDir, "staged"), { recursive: true });
  await writeFile(stagedPath, "installed update payload");
  await stateStore.write({
    ...initial,
    phase: "applying",
    stagedPath,
    targetVersion: "0.2.0"
  });
  const manager = new UpdateManager({
    allowedHosts: [RELEASE_HOST],
    architecture: "x64",
    channel: "stable",
    currentVersion: "0.2.0",
    fetch: async () => {
      throw new Error("not used");
    },
    manifestUrl: `https://${RELEASE_HOST}/stable.json`,
    platform: "win32",
    requestTimeoutMs: 1_000,
    stageDirectory: join(tempDir, "staged"),
    stateStore
  });

  try {
    const reconciled = await manager.reconcileInstalledVersion();

    assert.equal(reconciled.currentVersion, "0.2.0");
    assert.equal(reconciled.phase, "idle");
    assert.equal(reconciled.targetVersion, null);
    assert.equal(existsSync(stagedPath), false);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("recovers an incomplete apply as retryable when the old version is still installed", async () => {
  const { initial, stateStore, tempDir } = await fixture();
  const bytes = Buffer.from("installer payload");
  const stagedPath = join(tempDir, "staged", "DeskCueSetup-0.2.0-win-x64.exe");
  const updateArtifact = manifest("0.2.0", bytes).artifacts[0];

  await mkdir(join(tempDir, "staged"), { recursive: true });
  await writeFile(stagedPath, bytes);
  await stateStore.write({
    ...initial,
    artifact: updateArtifact,
    phase: "applying",
    progressBytes: bytes.byteLength,
    stagedPath,
    targetVersion: "0.2.0",
    totalBytes: bytes.byteLength
  });
  const manager = createManager({
    fetch: async () => {
      throw new Error("not used");
    },
    stateStore,
    tempDir
  });

  try {
    const reconciled = await manager.reconcileInstalledVersion();

    assert.equal(reconciled.phase, "staged");
    assert.equal(reconciled.error.code, "apply_incomplete");
    assert.equal(reconciled.stagedPath, stagedPath);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("restart reconciliation sweeps orphaned apply snapshots and old installers safely", async () => {
  const { initial, stateStore, tempDir } = await fixture();
  const bytes = Buffer.from("installer payload");
  const stagedDirectory = join(tempDir, "staged");
  const stagedPath = join(stagedDirectory, "DeskCueSetup-0.2.0-win-x64.exe");
  const oldInstallerPath = join(stagedDirectory, "DeskCueSetup-0.1.9-win-x64.exe");
  const oldPartialPath = join(stagedDirectory, "DeskCueSetup-0.1.8-win-x64.exe.part");
  const foreignFilePath = join(stagedDirectory, "notes.txt");
  const foreignSnapshotDirectory = join(
    stagedDirectory,
    ".deskcue-apply-00000000-0000-4000-8000-000000000000-ABC123"
  );
  const foreignSnapshotFile = join(foreignSnapshotDirectory, "foreign.txt");
  const updateArtifact = manifest("0.2.0", bytes).artifacts[0];

  await mkdir(foreignSnapshotDirectory, { recursive: true });
  await writeFile(stagedPath, bytes);
  await writeFile(oldInstallerPath, "old installer");
  await writeFile(oldPartialPath, "old partial");
  await writeFile(foreignFilePath, "foreign");
  await writeFile(foreignSnapshotFile, "foreign");
  await stateStore.write({
    ...initial,
    artifact: updateArtifact,
    phase: "applying",
    progressBytes: bytes.byteLength,
    stagedPath,
    targetVersion: "0.2.0",
    totalBytes: bytes.byteLength
  });

  const handoff = await prepareInstallerApplyHandoff({
    artifact: updateArtifact,
    currentVersion: "0.1.1",
    installerPath: stagedPath,
    targetVersion: "0.2.0"
  });
  let orphanedSnapshotPath = null;

  await launchInstallerApplyHandoff(handoff, {
    spawnInstaller: (command) => {
      orphanedSnapshotPath = command;
      const child = new EventEmitter();
      child.pid = 42;
      child.unref = () => {};
      queueMicrotask(() => child.emit("spawn"));
      return child;
    }
  });

  const manager = createManager({
    fetch: async () => {
      throw new Error("not used");
    },
    stateStore,
    tempDir
  });

  try {
    assert.equal(existsSync(orphanedSnapshotPath), true);

    const reconciled = await manager.reconcileInstalledVersion();

    assert.equal(reconciled.phase, "staged");
    assert.equal(existsSync(orphanedSnapshotPath), false);
    assert.equal(existsSync(stagedPath), true);
    assert.equal(existsSync(oldInstallerPath), false);
    assert.equal(existsSync(oldPartialPath), false);
    assert.equal(existsSync(foreignFilePath), true);
    assert.equal(existsSync(foreignSnapshotFile), true);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("fails closed when an incomplete apply has no reusable staged installer", async () => {
  const { initial, stateStore, tempDir } = await fixture();
  await stateStore.write({
    ...initial,
    phase: "applying",
    targetVersion: "0.2.0"
  });
  const manager = createManager({
    fetch: async () => {
      throw new Error("not used");
    },
    stateStore,
    tempDir
  });

  try {
    const reconciled = await manager.reconcileInstalledVersion();

    assert.equal(reconciled.phase, "failed");
    assert.equal(reconciled.error.code, "missing_staged_artifact");
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("resets interrupted checking so another update check can run", async () => {
  const { initial, stateStore, tempDir } = await fixture();
  await stateStore.write({
    ...initial,
    phase: "checking"
  });
  const manager = createManager({
    fetch: async () => {
      throw new Error("not used");
    },
    stateStore,
    tempDir
  });

  try {
    const reconciled = await manager.reconcileInstalledVersion();

    assert.equal(reconciled.phase, "idle");
    assert.equal(reconciled.error.code, "check_interrupted");
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("removes an interrupted partial download and restores available", async () => {
  const { initial, stateStore, tempDir } = await fixture();
  const bytes = Buffer.from("installer payload");
  const updateArtifact = manifest("0.2.0", bytes).artifacts[0];
  const stagedDirectory = join(tempDir, "staged");
  const partialPath = join(stagedDirectory, "DeskCueSetup-0.2.0-win-x64.exe.part");

  await mkdir(stagedDirectory, { recursive: true });
  await writeFile(partialPath, bytes.subarray(0, 4));
  await stateStore.write({
    ...initial,
    artifact: updateArtifact,
    phase: "downloading",
    progressBytes: 4,
    targetVersion: "0.2.0",
    totalBytes: bytes.byteLength
  });
  const manager = createManager({
    fetch: async () => {
      throw new Error("not used");
    },
    stateStore,
    tempDir
  });

  try {
    const reconciled = await manager.reconcileInstalledVersion();

    assert.equal(reconciled.phase, "available");
    assert.equal(reconciled.error.code, "download_interrupted");
    assert.equal(reconciled.progressBytes, 0);
    assert.equal(existsSync(partialPath), false);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("recovers staged when download completed before the state write", async () => {
  const { initial, stateStore, tempDir } = await fixture();
  const bytes = Buffer.from("installer payload");
  const updateArtifact = manifest("0.2.0", bytes).artifacts[0];
  const stagedDirectory = join(tempDir, "staged");
  const stagedPath = join(stagedDirectory, "DeskCueSetup-0.2.0-win-x64.exe");

  await mkdir(stagedDirectory, { recursive: true });
  await writeFile(stagedPath, bytes);
  await stateStore.write({
    ...initial,
    artifact: updateArtifact,
    phase: "downloading",
    progressBytes: bytes.byteLength,
    targetVersion: "0.2.0",
    totalBytes: bytes.byteLength
  });
  const manager = createManager({
    fetch: async () => {
      throw new Error("not used");
    },
    stateStore,
    tempDir
  });

  try {
    const reconciled = await manager.reconcileInstalledVersion();

    assert.equal(reconciled.phase, "staged");
    assert.equal(reconciled.stagedPath, stagedPath);
    assert.equal(reconciled.progressBytes, bytes.byteLength);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("fails closed when interrupted download metadata is incomplete", async () => {
  const { initial, stateStore, tempDir } = await fixture();
  await stateStore.write({
    ...initial,
    phase: "downloading",
    targetVersion: "0.2.0"
  });
  const manager = createManager({
    fetch: async () => {
      throw new Error("not used");
    },
    stateStore,
    tempDir
  });

  try {
    const reconciled = await manager.reconcileInstalledVersion();

    assert.equal(reconciled.phase, "failed");
    assert.equal(reconciled.error.code, "invalid_state");
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("resets applying state before recovery when the update channel changes", async () => {
  const { initial, stateStore, tempDir } = await fixture();
  const bytes = Buffer.from("installer payload");
  const stagedPath = join(tempDir, "staged", "DeskCueSetup-0.2.0-win-x64.exe");

  await mkdir(join(tempDir, "staged"), { recursive: true });
  await writeFile(stagedPath, bytes);
  await stateStore.write({
    ...initial,
    artifact: manifest("0.2.0", bytes).artifacts[0],
    phase: "applying",
    progressBytes: bytes.byteLength,
    stagedPath,
    targetVersion: "0.2.0",
    totalBytes: bytes.byteLength
  });
  const manager = new UpdateManager({
    allowedHosts: [RELEASE_HOST],
    architecture: "x64",
    channel: "beta",
    currentVersion: "0.1.1",
    fetch: async () => {
      throw new Error("not used");
    },
    manifestUrl: `https://${RELEASE_HOST}/beta.json`,
    platform: "win32",
    requestTimeoutMs: 1_000,
    stageDirectory: join(tempDir, "staged"),
    stateStore
  });

  try {
    const reconciled = await manager.reconcileInstalledVersion();

    assert.equal(reconciled.channel, "beta");
    assert.equal(reconciled.phase, "idle");
    assert.equal(reconciled.artifact, null);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("reuses a valid staged installer after a repeated update check", async () => {
  const { stateStore, tempDir } = await fixture();
  const bytes = new TextEncoder().encode("installer payload");
  const releaseManifest = manifest("0.2.0", bytes);
  let artifactFetchCount = 0;
  const manager = createManager({
    fetch: async (url) => {
      if (String(url).endsWith("stable.json")) return Response.json(releaseManifest);

      artifactFetchCount += 1;
      return new Response(bytes, {
        headers: { "content-length": String(bytes.byteLength) },
        status: 200
      });
    },
    stateStore,
    tempDir
  });

  try {
    await manager.checkForUpdate();
    const first = await manager.downloadAvailableUpdate();
    await manager.checkForUpdate();
    const second = await manager.downloadAvailableUpdate();

    assert.equal(artifactFetchCount, 1);
    assert.equal(second.phase, "staged");
    assert.equal(second.stagedPath, first.stagedPath);

    await writeFile(second.stagedPath, "corrupt");
    await manager.checkForUpdate();
    const replaced = await manager.downloadAvailableUpdate();

    assert.equal(artifactFetchCount, 2);
    assert.deepEqual(await readFile(replaced.stagedPath), Buffer.from(bytes));
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("coalesces identical checks and cancels one active network operation", async () => {
  const { stateStore, tempDir } = await fixture();
  let fetchCount = 0;
  let resolveFetchStarted;
  const fetchStarted = new Promise((resolve) => {
    resolveFetchStarted = resolve;
  });
  const manager = createManager({
    fetch: async (_url, init) => {
      fetchCount += 1;
      resolveFetchStarted();
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
    },
    stateStore,
    tempDir
  });

  try {
    const first = manager.checkForUpdate();
    const second = manager.checkForUpdate();
    assert.equal(first, second);

    await fetchStarted;
    assert.equal(fetchCount, 1);
    assert.equal(manager.cancelActiveOperation(), true);
    await assert.rejects(
      first,
      (error) => error instanceof UpdateError && error.code === "cancelled"
    );
    assert.equal((await manager.readState()).phase, "idle");
    assert.equal(manager.cancelActiveOperation(), false);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("cancels an artifact stream, removes .part and returns to available", async () => {
  const { stateStore, tempDir } = await fixture();
  const bytes = new TextEncoder().encode("installer payload");
  const releaseManifest = manifest("0.2.0", bytes);
  let artifactStreamStarted;
  const streamStarted = new Promise((resolve) => {
    artifactStreamStarted = resolve;
  });
  const manager = createManager({
    fetch: async (url, init) => {
      if (String(url).endsWith("stable.json")) return Response.json(releaseManifest);

      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.subarray(0, 4));
          artifactStreamStarted();
          init.signal.addEventListener("abort", () => controller.error(init.signal.reason), { once: true });
        }
      });
      return new Response(body, { status: 200 });
    },
    stateStore,
    tempDir
  });

  try {
    await manager.checkForUpdate();
    const downloading = manager.downloadAvailableUpdate();
    await streamStarted;
    assert.equal(manager.cancelActiveOperation(), true);
    await assert.rejects(
      downloading,
      (error) => error instanceof UpdateError && error.code === "cancelled"
    );

    const state = await manager.readState();
    assert.equal(state.phase, "available");
    assert.deepEqual(
      (await readdir(join(tempDir, "staged"))).filter((name) => name.endsWith(".part")),
      []
    );
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("reverifies a staged installer and launches it detached", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-update-apply-"));
  const installerPath = join(tempDir, "DeskCueSetup.exe");
  const bytes = Buffer.from("installer");
  const updateArtifact = {
    platform: "win32",
    architecture: "x64",
    url: `https://${RELEASE_HOST}/DeskCueSetup.exe`,
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };

  try {
    await writeFile(installerPath, bytes);
    const handoff = await prepareInstallerApplyHandoff({
      arguments: ["/VERYSILENT"],
      artifact: updateArtifact,
      currentVersion: "0.1.1",
      installerPath,
      targetVersion: "0.2.0"
    });
    let spawned = null;
    let spawnedChild = null;
    let unrefCalled = false;
    const resultPromise = launchInstallerApplyHandoff(handoff, {
      spawnInstaller: (command, args, options) => {
        spawned = { args, command, options };
        const child = new EventEmitter();
        child.pid = 42;
        child.unref = () => {
          unrefCalled = true;
        };
        spawnedChild = child;
        queueMicrotask(() => child.emit("spawn"));
        return child;
      }
    });
    const result = await resultPromise;

    assert.notEqual(spawned.command, installerPath);
    assert.equal(spawned.command.startsWith(join(tempDir, ".deskcue-apply-")), true);
    assert.deepEqual(await readFile(spawned.command), bytes);
    assert.equal(spawned.options.detached, true);
    assert.equal(unrefCalled, true);
    assert.deepEqual(result, { pid: 42, targetVersion: "0.2.0" });

    const snapshotPath = spawned.command;
    spawnedChild.emit("exit", 0);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(existsSync(snapshotPath), false);

    await writeFile(installerPath, "tampered!");
    await assert.rejects(
      prepareInstallerApplyHandoff({
        artifact: updateArtifact,
        currentVersion: "0.1.1",
        installerPath,
        targetVersion: "0.2.0"
      }),
      (error) => error instanceof UpdateError && error.code === "staged_artifact_changed"
    );

    let replacementSpawned = false;
    await assert.rejects(
      launchInstallerApplyHandoff(handoff, {
        spawnInstaller: () => {
          replacementSpawned = true;
          throw new Error("must not spawn");
        }
      }),
      (error) => error instanceof UpdateError && error.code === "staged_artifact_changed"
    );
    assert.equal(replacementSpawned, false);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("reports an asynchronous installer launch failure", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-update-launch-"));
  const installerPath = join(tempDir, "DeskCueSetup.exe");
  const bytes = Buffer.from("x");
  const handoff = {
    arguments: [],
    artifact: {
      platform: "win32",
      architecture: "x64",
      url: `https://${RELEASE_HOST}/DeskCueSetup.exe`,
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex")
    },
    currentVersion: "0.1.1",
    installerPath,
    targetVersion: "0.2.0"
  };

  try {
    await writeFile(installerPath, bytes);
    await assert.rejects(
      launchInstallerApplyHandoff(handoff, {
        spawnInstaller: () => {
          const child = new EventEmitter();
          child.pid = undefined;
          child.unref = () => {};
          queueMicrotask(() => child.emit("error", new Error("blocked")));
          return child;
        }
      }),
      (error) => error instanceof UpdateError && error.code === "installer_launch_failed"
    );
    assert.deepEqual((await readdir(tempDir)).filter((name) => name.startsWith(".deskcue-apply-")), []);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});
