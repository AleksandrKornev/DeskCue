import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { HOST_CONTROL_PROTOCOL_VERSION, resolveHostControlPaths } from "@deskcue/host-control";
import type { HostControlMethod, HostControlRequest, HostStatus } from "@deskcue/host-control";
import type { InstallerApplyHandoff } from "@deskcue/update";

import type { HostAutostartService } from "./autostartService.ts";
import type { DaemonSupervisor, DaemonUpdateReadiness } from "./daemonSupervisor.ts";
import { HostOperationError } from "./hostOperationError.ts";
import { HostRuntime } from "./hostRuntime.ts";
import type { HostUpdateService } from "./updateService.ts";

const TEST_HANDOFF = {
  arguments: ["/UPDATE"],
  artifact: {
    architecture: "x64",
    platform: "win32",
    sha256: "a".repeat(64),
    sizeBytes: 10,
    url: "https://release-assets.githubusercontent.com/update.exe"
  },
  currentVersion: "0.1.1",
  installerPath: "C:\\data\\update.exe",
  targetVersion: "0.2.0"
} satisfies InstallerApplyHandoff;

function request(method: HostControlMethod, params?: Record<string, unknown>): HostControlRequest {
  return {
    id: method,
    method,
    ...(params ? { params } : {}),
    protocolVersion: HOST_CONTROL_PROTOCOL_VERSION,
    token: "t".repeat(32)
  };
}

class FakeDaemon {
  readonly calls: string[] = [];
  prepareError: Error | null = null;
  readiness: DaemonUpdateReadiness = { blockers: [], ok: true };
  stopError: Error | null = null;
  stopGate: Promise<void> | null = null;
  constructor(private readonly timeline: string[] = []) {}
  status: HostStatus["daemon"] = {
    baseUrl: "http://127.0.0.1:4100",
    generation: "generation",
    lastError: null,
    pid: 42,
    port: 4100,
    restartAttempt: 0,
    state: "running",
    version: "0.1.1"
  };

  cancelUpdate() {
    this.calls.push("cancel-update");
    return Promise.resolve({ blockers: [], ok: true });
  }

  close() {
    this.calls.push("close");
    return Promise.resolve();
  }

  prepareUpdate() {
    this.calls.push("prepare-update");
    this.timeline.push("prepare-update");
    if (this.prepareError) return Promise.reject(this.prepareError);

    return Promise.resolve(this.readiness);
  }

  restart() {
    return Promise.resolve();
  }

  setDesiredRunning() {}

  start() {
    this.calls.push("start");
    this.timeline.push("start");
    return Promise.resolve();
  }

  stop() {
    this.calls.push("stop");
    return Promise.resolve();
  }

  stopForUpdate() {
    this.calls.push("stop-for-update");
    this.timeline.push("stop-for-update");
    if (this.stopError) return Promise.reject(this.stopError);

    return this.stopGate ?? Promise.resolve();
  }
}

class FakeUpdate {
  readonly calls: string[] = [];
  launchError: Error | null = null;
  stageError: Error | null = null;
  status: HostStatus["update"] = {
    availableVersion: "0.2.0",
    lastError: null,
    state: "available"
  };

  supported = true;
  constructor(private readonly timeline: string[] = []) {}

  abortApply() {
    this.calls.push("abort-apply");
    this.timeline.push("abort-apply");
    this.status = { ...this.status, state: "staged" };
    return Promise.resolve(this.status);
  }

  cancelActiveOperation() {
    return false;
  }

  check() {
    return Promise.resolve(this.status);
  }

  initialize() {
    return Promise.resolve(this.status);
  }

  launchApply() {
    this.calls.push("launch");
    this.timeline.push("launch");
    if (this.launchError) return Promise.reject(this.launchError);

    this.status = { ...this.status, state: "applying" };
    return Promise.resolve({ pid: 100, targetVersion: "0.2.0" });
  }

  prepareApply() {
    this.calls.push("prepare-apply");
    this.timeline.push("prepare-apply");
    return Promise.resolve(TEST_HANDOFF);
  }

  stageAvailable() {
    this.calls.push("stage");
    this.timeline.push("stage");
    if (this.stageError) return Promise.reject(this.stageError);

    this.status = { ...this.status, state: "staged" };
    return Promise.resolve(this.status);
  }
}

function createRuntime(root: string, daemon: FakeDaemon, update: FakeUpdate) {
  const autostart = {
    status: { enabled: false, supported: true },
    supported: true
  };

  return new HostRuntime({
    createAutostartService: () => autostart as unknown as HostAutostartService,
    createDaemonSupervisor: () => daemon as unknown as DaemonSupervisor,
    createUpdateService: () => update as unknown as HostUpdateService,
    paths: resolveHostControlPaths(root)
  });
}

test("coordinates drain, staging, daemon stop and installer launch in order", async () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-host-update-"));
  const timeline: string[] = [];
  const daemon = new FakeDaemon(timeline);
  const update = new FakeUpdate(timeline);
  const runtime = createRuntime(root, daemon, update);

  try {
    const status = await runtime.handle(request("update.apply", { version: "0.2.0" }));

    assert.deepEqual(daemon.calls, ["prepare-update", "stop-for-update"]);
    assert.deepEqual(update.calls, ["stage", "prepare-apply", "launch"]);
    assert.deepEqual(timeline, ["stage", "prepare-update", "stop-for-update", "prepare-apply", "launch"]);
    assert.equal(status.update.state, "applying");
    assert.equal(status.capabilities["host.shutdown"]?.allowed, false);
    assert.equal(
      status.capabilities["host.shutdown"]?.reason,
      "DeskCue Host is already shutting down."
    );

    await assert.rejects(
      runtime.handle(request("daemon.start")),
      (error) => error instanceof HostOperationError && error.code === "host_shutting_down"
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("returns typed blockers without staging or stopping the daemon", async () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-host-update-blocked-"));
  const daemon = new FakeDaemon();
  const update = new FakeUpdate();
  const runtime = createRuntime(root, daemon, update);

  daemon.readiness = {
    blockers: [{ code: "active_agent_turns", count: 2, message: "Two turns are active." }],
    ok: false
  };

  try {
    await assert.rejects(
      runtime.handle(request("update.apply")),
      (error) => error instanceof HostOperationError &&
        error.code === "update_blocked" &&
        Array.isArray(error.details?.blockers)
    );

    assert.deepEqual(daemon.calls, ["prepare-update"]);
    assert.deepEqual(update.calls, ["stage"]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("distinguishes update preparation failures from active-work blockers", async () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-host-update-readiness-failed-"));
  const daemon = new FakeDaemon();
  const update = new FakeUpdate();
  const runtime = createRuntime(root, daemon, update);

  daemon.readiness = {
    blockers: [{ code: "update_readiness_failed", count: 1, message: "Backup storage is unavailable." }],
    ok: false
  };

  try {
    await assert.rejects(
      runtime.handle(request("update.apply")),
      (error) => error instanceof HostOperationError &&
        error.code === "update_readiness_failed" &&
        error.message === "Backup storage is unavailable."
    );

    assert.deepEqual(daemon.calls, ["prepare-update", "stop-for-update", "start"]);
    assert.deepEqual(update.calls, ["stage"]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("stages before drain and restores the daemon when launch fails", async () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-host-update-recovery-"));
  const firstDaemon = new FakeDaemon();
  const firstUpdate = new FakeUpdate();

  firstUpdate.stageError = new Error("download failed");

  try {
    const firstRuntime = createRuntime(root, firstDaemon, firstUpdate);

    await assert.rejects(firstRuntime.handle(request("update.apply")), /download failed/u);
    assert.deepEqual(firstDaemon.calls, []);

    const secondDaemon = new FakeDaemon();
    const secondUpdate = new FakeUpdate();
    const secondRuntime = createRuntime(root, secondDaemon, secondUpdate);

    secondUpdate.launchError = new Error("launch failed");

    await assert.rejects(secondRuntime.handle(request("update.apply")), /launch failed/u);
    assert.deepEqual(secondDaemon.calls, ["prepare-update", "stop-for-update", "start"]);
    assert.deepEqual(secondUpdate.calls, ["stage", "prepare-apply", "launch", "abort-apply"]);
    assert.equal(secondUpdate.status.state, "staged");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("restarts the daemon after a lost or failed prepare response", async () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-host-update-prepare-failure-"));
  const daemon = new FakeDaemon();
  const update = new FakeUpdate();
  const runtime = createRuntime(root, daemon, update);

  daemon.prepareError = new Error("readiness timed out");

  try {
    await assert.rejects(runtime.handle(request("update.apply")), /readiness timed out/u);
    assert.deepEqual(daemon.calls, ["prepare-update", "stop-for-update", "start"]);
    assert.deepEqual(update.calls, ["stage"]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("does not restart the old daemon when shutdown interrupts update stop", async () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-host-update-shutdown-race-"));
  const daemon = new FakeDaemon();
  const update = new FakeUpdate();
  const runtime = createRuntime(root, daemon, update);
  const stopControl: { finish?: () => void } = {};

  daemon.stopGate = new Promise<void>((resolve) => {
    stopControl.finish = resolve;
  });

  try {
    const applying = runtime.handle(request("update.apply"));

    while (!daemon.calls.includes("stop-for-update")) await new Promise((resolve) => setImmediate(resolve));

    await runtime.handle(request("host.shutdown"));
    stopControl.finish?.();
    await assert.rejects(applying, /shutting down/u);
    assert.deepEqual(daemon.calls, ["prepare-update", "stop-for-update"]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("never launches after an unclean update stop and leaves the staged update retryable", async () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-host-update-stop-failure-"));
  const daemon = new FakeDaemon();
  const update = new FakeUpdate();
  const runtime = createRuntime(root, daemon, update);

  daemon.stopError = Object.assign(new Error("daemon exited without acknowledgement"), {
    code: "daemon_stop_unclean"
  });

  try {
    await assert.rejects(
      runtime.handle(request("update.apply")),
      (error) => (error as { code?: string }).code === "daemon_stop_unclean"
    );

    assert.equal(update.calls.includes("launch"), false);
    assert.equal(update.status.state, "staged");
    assert.equal(daemon.calls.includes("start"), true);

    daemon.stopError = null;
    await runtime.handle(request("update.apply"));
    assert.equal(update.calls.filter((call) => call === "launch").length, 1);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("allows stopping a degraded daemon so the persisted desired state can be disabled", async () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-host-degraded-stop-"));
  const daemon = new FakeDaemon();
  const update = new FakeUpdate();
  const runtime = createRuntime(root, daemon, update);

  daemon.status = { ...daemon.status, state: "degraded" };

  try {
    assert.equal(runtime.status.capabilities["daemon.stop"]?.allowed, true);
    await runtime.handle(request("daemon.stop"));
    assert.equal(daemon.calls.includes("stop"), true);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("closes the daemon even when final runtime metadata cannot be persisted", async () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-host-close-metadata-failure-"));
  const paths = resolveHostControlPaths(root);
  const daemon = new FakeDaemon();
  const update = new FakeUpdate();
  const runtime = createRuntime(root, daemon, update);

  mkdirSync(paths.runtimeFilePath, { recursive: true });

  try {
    await assert.rejects(runtime.close());
    assert.equal(daemon.calls.includes("close"), true);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
