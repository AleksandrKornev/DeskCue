import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyLinuxUpdate, verifyExtractedLinuxPayload } from "../dist/linuxApplyWorker.js";

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "deskcue-linux-apply-worker-"));
  const artifactPath = join(root, "deskcue-0.3.0-linux-x64.tar.gz");
  const installRootPath = join(root, "deskcue");
  const unitPath = join(root, "systemd", "user", "deskcue-host.service");

  await mkdir(installRootPath);
  await writeFile(join(installRootPath, "installation-owner.json"), JSON.stringify({
    packageId: "io.deskcue.app",
    schemaVersion: 1,
    updateMode: "linux-standalone"
  }), "utf8");
  await writeFile(join(installRootPath, "payload-manifest.json"), JSON.stringify({
    files: [
      { path: "bin/deskcue" },
      { path: "installation-owner.json" },
      { path: "systemd/deskcue-host.service" }
    ],
    packageId: "io.deskcue.app",
    platform: "linux",
    schemaVersion: 1
  }), "utf8");
  await mkdir(join(installRootPath, "bin"));
  await mkdir(join(installRootPath, "systemd"));
  await mkdir(join(root, "systemd", "user"), { recursive: true });
  await writeFile(join(installRootPath, "bin", "deskcue"), "cli", "utf8");
  await writeFile(join(installRootPath, "systemd", "deskcue-host.service"), "unit", "utf8");
  await writeFile(unitPath, "unit", "utf8");
  await writeFile(join(installRootPath, "version.txt"), "old", "utf8");
  await writeFile(artifactPath, "archive", "utf8");

  return {
    options: {
      architecture: "x64",
      artifactPath,
      hostPid: 42,
      installRootPath,
      sha256: "a".repeat(64),
      sizeBytes: 7,
      targetVersion: "0.3.0",
      unitPath
    },
    root
  };
}

function dependencies({ healthFailures = 0 } = {}) {
  const expectedVersions = [];
  const systemctlCalls = [];
  let healthChecks = 0;

  return {
    dependencies: {
      extractArtifact: async (_options, extractionRoot) => {
        await mkdir(join(extractionRoot, "systemd"));
        await writeFile(join(extractionRoot, "systemd", "deskcue-host.service"), "new unit", "utf8");
        await writeFile(join(extractionRoot, "version.txt"), "new", "utf8");
      },
      runSystemctl: async (...arguments_) => {
        systemctlCalls.push(arguments_);
      },
      verifyArtifact: async () => undefined,
      waitForHealthyInstall: async (_installRootPath, expectedVersion) => {
        healthChecks += 1;
        expectedVersions.push(expectedVersion ?? null);
        if (healthChecks <= healthFailures) throw new Error(`not healthy ${healthChecks}`);
      },
      waitForHostExit: async () => undefined
    },
    expectedVersions,
    systemctlCalls
  };
}

test("atomically replaces a Linux install and removes the staged archive after health succeeds", async () => {
  const { options, root } = await fixture();
  const injected = dependencies();

  try {
    await applyLinuxUpdate(options, injected.dependencies);

    assert.equal(await readFile(join(options.installRootPath, "version.txt"), "utf8"), "new");
    assert.equal(await readFile(options.unitPath, "utf8"), "new unit");
    assert.equal(existsSync(options.artifactPath), false);
    assert.deepEqual(injected.expectedVersions, ["0.3.0"]);
    assert.deepEqual(injected.systemctlCalls, [
      ["daemon-reload"],
      ["restart", "deskcue-host.service"]
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("restores the previous Linux install when the replacement does not become healthy", async () => {
  const { options, root } = await fixture();
  const injected = dependencies({ healthFailures: 1 });

  try {
    await assert.rejects(applyLinuxUpdate(options, injected.dependencies), /not healthy 1/u);

    assert.equal(await readFile(join(options.installRootPath, "version.txt"), "utf8"), "old");
    assert.equal(await readFile(options.unitPath, "utf8"), "unit");
    assert.equal(existsSync(options.artifactPath), true);
    assert.deepEqual(injected.expectedVersions, ["0.3.0", null]);
    assert.deepEqual(injected.systemctlCalls, [
      ["daemon-reload"],
      ["restart", "deskcue-host.service"],
      ["stop", "deskcue-host.service"],
      ["daemon-reload"],
      ["restart", "deskcue-host.service"]
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("reports a failed rollback health check and retains the failed replacement for diagnosis", async () => {
  const { options, root } = await fixture();
  const injected = dependencies({ healthFailures: 2 });

  try {
    await assert.rejects(
      applyLinuxUpdate(options, injected.dependencies),
      /restored version is unhealthy; failed payload retained/u
    );

    assert.equal(await readFile(join(options.installRootPath, "version.txt"), "utf8"), "old");
    assert.equal(await readFile(options.unitPath, "utf8"), "unit");
    assert.equal(existsSync(options.artifactPath), true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("refuses to update through a user service modified outside the installed package", async () => {
  const { options, root } = await fixture();

  try {
    await writeFile(options.unitPath, "user override", "utf8");

    await assert.rejects(
      applyLinuxUpdate(options, dependencies().dependencies),
      /user service was modified outside the package/u
    );

    assert.equal(await readFile(join(options.installRootPath, "version.txt"), "utf8"), "old");
    assert.equal(await readFile(options.unitPath, "utf8"), "user override");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("rejects extracted payload files that are absent from the integrity manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "deskcue-linux-payload-verification-"));
  const declaredContents = "declared";
  const options = {
    architecture: "x64",
    artifactPath: join(root, "unused.tar.gz"),
    hostPid: 42,
    installRootPath: join(root, "install"),
    sha256: "a".repeat(64),
    sizeBytes: 1,
    targetVersion: "0.3.0"
  };

  try {
    await writeFile(join(root, "declared.txt"), declaredContents, "utf8");
    await writeFile(join(root, "unexpected.txt"), "unexpected", "utf8");
    await writeFile(join(root, "payload-manifest.json"), JSON.stringify({
      appVersion: options.targetVersion,
      architecture: options.architecture,
      files: [{
        path: "declared.txt",
        sha256: sha256(declaredContents),
        size: Buffer.byteLength(declaredContents)
      }],
      packageId: "io.deskcue.app",
      platform: "linux",
      schemaVersion: 1
    }), "utf8");

    await assert.rejects(
      verifyExtractedLinuxPayload(root, options),
      /files differ from the payload manifest/u
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
