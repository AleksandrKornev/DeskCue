import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { HOST_CONTROL_PROTOCOL_VERSION } from "@deskcue/host-control";
import type { HostCapability, HostControlRequest, HostStatus } from "@deskcue/host-control";
import type { HostControlPaths } from "@deskcue/host-control";

import { HostAutostartService } from "./autostartService.ts";
import { DaemonSupervisor } from "./daemonSupervisor.ts";
import { HostOperationError } from "./hostOperationError.ts";
import { readPersistedHostState, writePersistedHostState } from "./hostStateStore.ts";
import { HostUpdateService } from "./updateService.ts";

const HOST_VERSION = readHostVersion();

type HostRuntimeOptions = {
  createAutostartService?: () => HostAutostartService;
  createDaemonSupervisor?: (onStatusChange: () => void) => DaemonSupervisor;
  createUpdateService?: (onStatusChange: () => void) => HostUpdateService;
  paths: HostControlPaths;
};

function readHostVersion() {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version?: unknown;
  };

  if (typeof manifest.version !== "string") throw new Error("DeskCue Host version is invalid.");

  return manifest.version;
}

function createCapability(allowed: boolean, reason: string | null = null): HostCapability {
  return { allowed, reason };
}

function writeRuntimeMetadata(filePath: string, status: HostStatus) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const metadata = {
    daemon: status.daemon,
    host: status.host,
    protocolVersion: HOST_CONTROL_PROTOCOL_VERSION
  };

  writeFileSync(temporaryPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, filePath);
}

export class HostRuntime {
  private readonly autostart: HostAutostartService;
  private readonly daemon: DaemonSupervisor;
  private desiredDaemonRunning: boolean;
  private hostState: HostStatus["host"]["state"] = "starting";
  private operationQueue = Promise.resolve();
  private shutdownRequested = false;
  private readonly startedAt = new Date().toISOString();
  private readonly update: HostUpdateService;

  constructor(private readonly options: HostRuntimeOptions) {
    const persistedState = readPersistedHostState(options.paths.stateFilePath);

    this.desiredDaemonRunning = persistedState.desiredDaemonRunning;
    this.daemon = options.createDaemonSupervisor?.(() => this.persistRuntimeMetadata()) ?? new DaemonSupervisor({
      dataRootPath: options.paths.dataRootPath,
      onStatusChange: () => this.persistRuntimeMetadata()
    });
    this.autostart = options.createAutostartService?.() ?? new HostAutostartService();
    this.update = options.createUpdateService?.(() => this.persistRuntimeMetadata()) ?? new HostUpdateService({
      currentVersion: HOST_VERSION,
      dataRootPath: options.paths.dataRootPath,
      onStatusChange: () => this.persistRuntimeMetadata()
    });

    this.daemon.setDesiredRunning(this.desiredDaemonRunning);
  }

  get status(): HostStatus {
    const daemon = this.daemon.status;
    const update = this.update.status;
    const updateBusy = update.state === "checking" || update.state === "downloading" || update.state === "applying";
    const lifecycleAllowed = !updateBusy && !this.shutdownRequested;
    const lifecycleBlockReason = this.shutdownRequested
      ? "DeskCue Host is shutting down."
      : updateBusy
        ? `DeskCue update is ${update.state}.`
        : null;
    const autostartAllowed = this.autostart.supported && lifecycleAllowed;
    const autostartReason = autostartAllowed
      ? null
      : lifecycleBlockReason ?? "Autostart is unavailable in this DeskCue installation.";
    const daemonRestartAllowed = lifecycleAllowed && (daemon.state === "running" || daemon.state === "degraded");
    const daemonStartAllowed = lifecycleAllowed && !this.daemon.hasActiveChild &&
      (daemon.state === "stopped" || daemon.state === "degraded");
    const daemonStopAllowed = lifecycleAllowed &&
      (daemon.state === "running" || daemon.state === "starting" || daemon.state === "degraded");
    const canApplyUpdate = this.update.supported &&
      (update.state === "available" || update.state === "staged") &&
      daemon.state === "running";
    const updateCheckAllowed = this.update.supported && !updateBusy && !this.shutdownRequested;
    const updateUnavailableReason = this.update.supported
      ? lifecycleBlockReason
      : "Self-updates are unavailable in this DeskCue installation.";

    return {
      autostart: this.autostart.status,
      busyReason: updateBusy ? `DeskCue update is ${update.state}.` : null,
      capabilities: {
        "autostart.disable": createCapability(autostartAllowed, autostartReason),
        "autostart.enable": createCapability(autostartAllowed, autostartReason),
        "autostart.get": createCapability(autostartAllowed, autostartReason),
        "daemon.restart": createCapability(
          daemonRestartAllowed,
          daemonRestartAllowed ? null : lifecycleBlockReason ?? `Cannot restart while the daemon is ${daemon.state}.`
        ),
        "daemon.start": createCapability(
          daemonStartAllowed,
          daemonStartAllowed ? null : lifecycleBlockReason ?? `Cannot start while the daemon is ${daemon.state}.`
        ),
        "daemon.stop": createCapability(
          daemonStopAllowed,
          daemonStopAllowed ? null : lifecycleBlockReason ?? `Cannot stop while the daemon is ${daemon.state}.`
        ),
        "host.shutdown": createCapability(
          !this.shutdownRequested,
          this.shutdownRequested ? "DeskCue Host is already shutting down." : null
        ),
        status: createCapability(true),
        "update.apply": createCapability(
          canApplyUpdate,
          canApplyUpdate ? null : "Check and stage an update while the daemon is running before installing."
        ),
        "update.check": createCapability(updateCheckAllowed, updateCheckAllowed ? null : updateUnavailableReason)
      },
      daemon,
      host: {
        pid: process.pid,
        startedAt: this.startedAt,
        state: this.hostState,
        version: HOST_VERSION
      },
      update
    };
  }

  async startInitialDaemon() {
    this.hostState = "running";
    this.persistRuntimeMetadata();
    await Promise.allSettled([
      this.update.initialize(),
      this.autostart.supported ? this.autostart.refresh() : Promise.resolve()
    ]);
    this.persistRuntimeMetadata();
    if (this.shutdownRequested || !this.desiredDaemonRunning) return;

    try {
      await this.daemon.start();
    } catch {
      this.persistRuntimeMetadata();
    }
  }

  handle(request: HostControlRequest) {
    if (request.method === "status") return Promise.resolve(this.status);

    if (request.method === "host.shutdown") {
      this.shutdownRequested = true;
      this.update.cancelActiveOperation();
      return Promise.resolve(this.status);
    }

    const operation = this.operationQueue.then(() => this.execute(request));

    this.operationQueue = operation.then(() => undefined, () => undefined);

    return operation;
  }

  async close() {
    const failures: unknown[] = [];

    this.shutdownRequested = true;
    this.hostState = "stopping";
    this.update.cancelActiveOperation();

    try {
      this.persistRuntimeMetadata();
    } catch (error) {
      failures.push(error);
    }

    try {
      await this.operationQueue;
    } catch (error) {
      failures.push(error);
    }

    try {
      await this.daemon.close();
    } catch (error) {
      failures.push(error);
    }

    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "DeskCue Host shutdown failed.");
  }

  private async execute(request: HostControlRequest) {
    if (this.shutdownRequested && request.method !== "host.shutdown") {
      throw new HostOperationError("host_shutting_down", "DeskCue Host is shutting down.");
    }

    if (this.update.status.state === "applying" && request.method.startsWith("daemon.")) {
      throw new HostOperationError("update_in_progress", "DeskCue daemon lifecycle is locked during update apply.");
    }

    switch (request.method) {
      case "status":
        return this.status;
      case "daemon.start":
        this.setDesiredDaemonRunning(true);
        await this.daemon.start();
        return this.status;
      case "daemon.stop":
        this.setDesiredDaemonRunning(false);
        await this.daemon.stop();
        return this.status;
      case "daemon.restart":
        this.setDesiredDaemonRunning(true);
        await this.daemon.restart();
        return this.status;
      case "host.shutdown":
        this.shutdownRequested = true;
        return this.status;
      case "update.check":
        await this.update.check(request.params);
        return this.status;
      case "update.apply":
        await this.applyUpdate(request.params);
        return this.status;
      case "autostart.get":
        await this.autostart.refresh();
        return this.status;
      case "autostart.enable":
        await this.autostart.setEnabled(true);
        return this.status;
      case "autostart.disable":
        await this.autostart.setEnabled(false);
        return this.status;
      default:
        throw Object.assign(new Error(`Host control method ${request.method} is not implemented.`), {
          code: "unsupported_method"
        });
    }
  }

  private async applyUpdate(params?: Record<string, unknown>) {
    let applyTransitionStarted = false;
    let daemonRecoveryRequired = false;
    let daemonStopped = false;

    try {
      await this.update.stageAvailable(params);
      this.assertNotShuttingDown();
      daemonRecoveryRequired = true;
      const readiness = await this.daemon.prepareUpdate();

      if (!readiness.ok) {
        const readinessFailure = readiness.blockers.find((blocker) => blocker.code === "update_readiness_failed");

        if (readinessFailure) {
          throw new HostOperationError(
            "update_readiness_failed",
            readinessFailure.message,
            true,
            { blockers: readiness.blockers }
          );
        }

        daemonRecoveryRequired = false;
        throw new HostOperationError(
          "update_blocked",
          "DeskCue cannot update while local work is active.",
          false,
          { blockers: readiness.blockers }
        );
      }

      await this.daemon.stopForUpdate();
      daemonStopped = true;
      this.assertNotShuttingDown();
      applyTransitionStarted = true;
      const handoff = await this.update.prepareApply();

      this.assertNotShuttingDown();
      await this.update.launchApply(handoff);
      this.shutdownRequested = true;
    } catch (error) {
      if (applyTransitionStarted) await this.update.abortApply(error).catch(() => undefined);
      if (daemonRecoveryRequired && !this.shutdownRequested) {
        if (!daemonStopped) await this.daemon.stopForUpdate().catch(() => undefined);
        await this.daemon.start(false).catch(() => undefined);
      }

      throw error;
    }
  }

  private persistRuntimeMetadata() {
    writeRuntimeMetadata(this.options.paths.runtimeFilePath, this.status);
  }

  private assertNotShuttingDown() {
    if (!this.shutdownRequested) return;

    throw new HostOperationError("host_shutting_down", "DeskCue Host is shutting down.");
  }

  private setDesiredDaemonRunning(desiredDaemonRunning: boolean) {
    this.desiredDaemonRunning = desiredDaemonRunning;
    writePersistedHostState(this.options.paths.stateFilePath, { desiredDaemonRunning });
    this.daemon.setDesiredRunning(desiredDaemonRunning);
  }
}
