import assert from "node:assert/strict";
import test from "node:test";

import { createInitialUpdateState } from "@deskcue/update";
import type {
  InstallerApplyHandoff,
  UpdateManagerOptions,
  UpdateState
} from "@deskcue/update";

import { HostUpdateService } from "./updateService.ts";

function availableState(): UpdateState {
  return {
    ...createInitialUpdateState({
      architecture: "x64",
      channel: "stable",
      currentVersion: "0.1.1"
    }),
    artifact: {
      architecture: "x64",
      platform: "win32",
      sha256: "a".repeat(64),
      sizeBytes: 10,
      url: "https://release-assets.githubusercontent.com/update.exe"
    },
    phase: "available",
    targetVersion: "0.2.0",
    totalBytes: 10
  };
}

class FakeUpdateManager {
  readonly calls: string[] = [];
  state: UpdateState;

  constructor(channel: "stable" | "beta" = "stable") {
    this.state = createInitialUpdateState({
      architecture: "x64",
      channel,
      currentVersion: "0.1.1"
    });
  }

  cancelActiveOperation() {
    return false;
  }

  async checkForUpdate() {
    this.calls.push("check");
    this.state = availableState();
    return {} as never;
  }

  async downloadAvailableUpdate() {
    this.calls.push("download");
    this.state = {
      ...this.state,
      phase: "staged",
      progressBytes: 10,
      stagedPath: "C:\\data\\update.exe"
    };

    return this.state;
  }

  async prepareApply() {
    this.calls.push("prepare");
    this.state = { ...this.state, phase: "applying" };
    return {
      arguments: ["/UPDATE"],
      artifact: this.state.artifact!,
      currentVersion: "0.1.1",
      installerPath: this.state.stagedPath!,
      targetVersion: this.state.targetVersion!
    } satisfies InstallerApplyHandoff;
  }

  async readState() {
    return this.state;
  }

  async reconcileInstalledVersion() {
    return this.state;
  }

  async recordApplyLaunchFailure() {
    this.calls.push("launch-failed");
    this.state = { ...this.state, phase: "staged" };
    return this.state;
  }
}

test("uses the bounded GitHub release feed and exposes package state", async () => {
  const manager = new FakeUpdateManager();
  const capturedManagerOptions: UpdateManagerOptions[] = [];
  const service = new HostUpdateService({
    architecture: "x64",
    createManager: (options) => {
      capturedManagerOptions.push(options);
      return manager;
    },
    currentVersion: "0.1.1",
    dataRootPath: "C:\\data",
    env: { DESKCUE_DISTRIBUTION_MODE: "installed" },
    platform: "win32"
  });

  await service.initialize();
  await service.check();

  assert.equal(service.supported, true);
  assert.deepEqual(service.status, {
    availableVersion: "0.2.0",
    lastError: null,
    state: "available"
  });
  assert.equal(
    capturedManagerOptions[0]?.manifestUrl,
    "https://github.com/AleksandrKornev/DeskCue/releases/latest/download/update-manifest-v1.json"
  );

  assert.deepEqual(capturedManagerOptions[0]?.allowedHosts, [
    "github.com",
    "release-assets.githubusercontent.com"
  ]);
  assert.equal(capturedManagerOptions[0]?.platform, "win32");
});

test("stages available updates before preparing and launching the installer", async () => {
  const manager = new FakeUpdateManager();
  const launches: InstallerApplyHandoff[] = [];
  const service = new HostUpdateService({
    architecture: "x64",
    createManager: () => manager,
    currentVersion: "0.1.1",
    dataRootPath: "C:\\data",
    env: { DESKCUE_DISTRIBUTION_MODE: "installed" },
    launchInstaller: async (handoff) => {
      launches.push(handoff);
      return { pid: 42, targetVersion: handoff.targetVersion };
    },
    platform: "win32"
  });

  await service.initialize();
  await service.check();
  await service.stageAvailable({ version: "0.2.0" });
  const handoff = await service.prepareApply();

  await service.launchApply(handoff);

  assert.deepEqual(manager.calls, ["check", "download", "prepare"]);
  assert.equal(launches[0]?.targetVersion, "0.2.0");
  assert.equal(service.status.state, "applying");
});

test("returns a prepared apply transition to staged after handoff is aborted", async () => {
  const manager = new FakeUpdateManager();
  const service = new HostUpdateService({
    architecture: "x64",
    createManager: () => manager,
    currentVersion: "0.1.1",
    dataRootPath: "C:\\data",
    env: { DESKCUE_DISTRIBUTION_MODE: "installed" },
    platform: "win32"
  });

  await service.initialize();
  await service.check();
  await service.stageAvailable({ version: "0.2.0" });
  await service.prepareApply();
  await service.abortApply(new Error("daemon stop was not clean"));

  assert.deepEqual(manager.calls, ["check", "download", "prepare", "launch-failed"]);
  assert.equal(service.status.state, "staged");
});

test("does not advertise package updates in source mode", () => {
  const service = new HostUpdateService({
    architecture: "x64",
    currentVersion: "0.1.1",
    dataRootPath: "C:\\data",
    env: {},
    platform: "win32"
  });

  assert.equal(service.supported, false);
});

test("supports standalone Linux updates and selects Linux artifacts", async () => {
  const manager = new FakeUpdateManager();
  const capturedManagerOptions: UpdateManagerOptions[] = [];
  const service = new HostUpdateService({
    architecture: "arm64",
    createManager: (options) => {
      capturedManagerOptions.push(options);
      return manager;
    },
    currentVersion: "0.1.1",
    dataRootPath: "/home/user/.local/share/deskcue/data",
    env: {
      DESKCUE_DISTRIBUTION_MODE: "installed",
      DESKCUE_INSTALL_DIR: "/home/user/.local/lib/deskcue",
      DESKCUE_UPDATE_APPLY_MODE: "linux-standalone"
    },
    launchInstaller: async (handoff) => ({ pid: 42, targetVersion: handoff.targetVersion }),
    platform: "linux"
  });

  await service.initialize();

  assert.equal(service.supported, true);
  assert.equal(capturedManagerOptions[0]?.architecture, "arm64");
  assert.equal(capturedManagerOptions[0]?.platform, "linux");
});

test("keeps self-update disabled for package-manager-owned Linux installs", async () => {
  const service = new HostUpdateService({
    architecture: "x64",
    currentVersion: "0.1.1",
    dataRootPath: "/var/lib/deskcue",
    env: {
      DESKCUE_DISTRIBUTION_MODE: "installed",
      DESKCUE_INSTALL_DIR: "/usr/lib/deskcue",
      DESKCUE_UPDATE_APPLY_MODE: "external"
    },
    platform: "linux"
  });

  assert.equal(service.supported, false);
  await assert.rejects(
    service.check(),
    /repeat the Debian install command/u
  );
});

test("selects a distinct default manifest for the beta channel", async () => {
  const manager = new FakeUpdateManager("beta");
  const capturedManagerOptions: UpdateManagerOptions[] = [];
  const service = new HostUpdateService({
    architecture: "x64",
    createManager: (options) => {
      capturedManagerOptions.push(options);
      return manager;
    },
    currentVersion: "0.1.1",
    dataRootPath: "C:\\data",
    env: {
      DESKCUE_DISTRIBUTION_MODE: "installed",
      DESKCUE_UPDATE_CHANNEL: "beta"
    },
    platform: "win32"
  });

  await service.initialize();

  assert.equal(
    capturedManagerOptions[0]?.manifestUrl,
    "https://github.com/AleksandrKornev/DeskCue/releases/latest/download/update-manifest-v1-beta.json"
  );
});

test("an explicit update channel applies only to that check", async () => {
  const capturedChannels: string[] = [];
  const service = new HostUpdateService({
    architecture: "x64",
    createManager: (options) => {
      capturedChannels.push(options.channel);
      return new FakeUpdateManager(options.channel);
    },
    currentVersion: "0.1.1",
    dataRootPath: "C:\\data",
    env: { DESKCUE_DISTRIBUTION_MODE: "installed" },
    platform: "win32"
  });

  await service.initialize();
  await service.check({ channel: "beta" });
  await service.check();

  assert.deepEqual(capturedChannels, ["stable", "beta", "stable"]);
});
