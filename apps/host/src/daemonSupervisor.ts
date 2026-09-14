import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import type { HostStatus } from "@deskcue/host-control";

import { isDaemonChildMessage } from "./daemonChildProtocol.ts";
import type { DaemonChildMessage, HostChildMessage } from "./daemonChildProtocol.ts";

const DAEMON_START_TIMEOUT_MS = 30_000;
const DAEMON_STOP_TIMEOUT_MS = 7_000;
const DAEMON_FORCE_STOP_TIMEOUT_MS = 2_000;
const DAEMON_UPDATE_READINESS_TIMEOUT_MS = 10_000;
const MAX_AUTOMATIC_RESTARTS = 3;
const RESTART_DELAYS_MS = [250, 1_000, 3_000] as const;
const STABLE_RUN_RESET_MS = 60_000;

type SpawnDaemonChild = () => ChildProcess;

type DaemonSupervisorOptions = {
  dataRootPath: string;
  daemonEntryPath?: string;
  onStatusChange?: () => void;
  restartDelaysMs?: readonly number[];
  spawnChild?: SpawnDaemonChild;
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
  forceStopTimeoutMs?: number;
};

type StartWaiter = {
  reject: (error: Error) => void;
  resolve: () => void;
  timeout: NodeJS.Timeout;
};

type StopWaiter = {
  acknowledged: boolean;
  child: ChildProcess;
  forceTimeout: NodeJS.Timeout | null;
  forced: boolean;
  reject: (error: Error) => void;
  resolve: () => void;
  timeout: NodeJS.Timeout;
};

export type DaemonUpdateReadiness = {
  backupPath?: string | null;
  blockers: Array<{ code: string; count: number; message: string }>;
  ok: boolean;
};

type UpdateWaiter = {
  reject: (error: Error) => void;
  resolve: (readiness: DaemonUpdateReadiness) => void;
  timeout: NodeJS.Timeout;
};

function createDefaultSpawnChild(dataRootPath: string, daemonEntryPath: string) {
  return () => spawn(process.execPath, [daemonEntryPath], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    env: {
      ...process.env,
      DESKCUE_DATA_DIR: dataRootPath
    },
    serialization: "json",
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    windowsHide: true
  });
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function createDaemonStopError(
  code: "daemon_stop_forced" | "daemon_stop_timeout" | "daemon_stop_unclean",
  message: string
) {
  return Object.assign(new Error(message), { code, retryable: true });
}

export class DaemonSupervisor {
  private child: ChildProcess | null = null;
  private daemonStatus: HostStatus["daemon"] = {
    baseUrl: null,
    generation: null,
    lastError: null,
    pid: null,
    port: null,
    restartAttempt: 0,
    state: "stopped",
    version: null
  };

  private desiredRunning = true;
  private readonly forcedChildren = new WeakSet<ChildProcess>();
  private readonly restartAfterExitChildren = new WeakSet<ChildProcess>();
  private restartTimer: NodeJS.Timeout | null = null;
  private readonly spawnChild: SpawnDaemonChild;
  private startWaiter: StartWaiter | null = null;
  private stableRunTimer: NodeJS.Timeout | null = null;
  private readonly stoppingChildren = new WeakSet<ChildProcess>();
  private stopPromise: Promise<void> | null = null;
  private stopWaiter: StopWaiter | null = null;
  private readonly updateWaiters = new Map<string, UpdateWaiter>();

  constructor(private readonly options: DaemonSupervisorOptions) {
    const daemonEntryPath = options.daemonEntryPath ?? fileURLToPath(
      new URL("../../daemon/dist/managedEntry.js", import.meta.url)
    );

    this.spawnChild = options.spawnChild ?? createDefaultSpawnChild(
      options.dataRootPath,
      daemonEntryPath
    );
  }

  get status() {
    return structuredClone(this.daemonStatus);
  }

  get hasActiveChild() {
    return this.child !== null;
  }

  setDesiredRunning(desiredRunning: boolean) {
    this.desiredRunning = desiredRunning;
    if (!desiredRunning && this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  async start(resetRestartAttempts = true) {
    this.setDesiredRunning(true);
    if (this.daemonStatus.state === "running") return;

    if (this.stopPromise) {
      try {
        await this.stopPromise;
      } catch (error) {
        if (this.child) throw error;
      }
    }

    if (this.startWaiter) {
      await new Promise<void>((resolve, reject) => {
        const check = setInterval(() => {
          if (this.daemonStatus.state === "running") {
            clearInterval(check);
            resolve();
          } else if (!this.startWaiter) {
            clearInterval(check);
            reject(new Error(this.daemonStatus.lastError ?? "DeskCue daemon failed to start."));
          }
        }, 25);

        check.unref?.();
      });
      return;
    }

    if (this.child) {
      throw Object.assign(
        new Error("DeskCue daemon process is still active; wait for its exit before starting another."),
        { code: "daemon_process_active", retryable: true }
      );
    }

    if (resetRestartAttempts) this.daemonStatus.restartAttempt = 0;
    this.clearRestartTimer();
    this.daemonStatus = {
      ...this.daemonStatus,
      baseUrl: null,
      generation: randomUUID(),
      lastError: null,
      pid: null,
      port: null,
      state: "starting",
      version: null
    };

    this.options.onStatusChange?.();

    const child = this.spawnChild();

    this.child = child;

    child.on("message", (message: unknown) => this.handleChildMessage(child, message));
    child.on("error", (error) => this.handleChildError(child, error));
    child.once("exit", (code, signal) => this.handleChildExit(child, code, signal));

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.startWaiter = null;
        const error = new Error("DeskCue daemon startup timed out.");

        this.daemonStatus = { ...this.daemonStatus, lastError: error.message, state: "degraded" };
        void this.stopChild(true).catch(() => undefined);
        reject(error);
      }, this.options.startTimeoutMs ?? DAEMON_START_TIMEOUT_MS);

      timeout.unref?.();
      this.startWaiter = { reject, resolve, timeout };
    });
  }

  async stop() {
    this.setDesiredRunning(false);
    return this.stopChild();
  }

  stopForUpdate() {
    return this.stopChild();
  }

  private async stopChild(restartAfterExit = false) {
    const child = this.child;

    if (!child) {
      this.daemonStatus = { ...this.daemonStatus, state: "stopped" };
      this.options.onStatusChange?.();
      return;
    }

    if (restartAfterExit) this.restartAfterExitChildren.add(child);
    if (this.stopPromise) return this.stopPromise;

    this.stoppingChildren.add(child);
    this.daemonStatus = { ...this.daemonStatus, state: "stopping" };

    this.options.onStatusChange?.();
    this.stopPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const waiter = this.stopWaiter;

        if (!waiter || waiter.child !== child) return;

        waiter.forced = true;
        this.forcedChildren.add(child);
        if (this.child === child) child.kill("SIGKILL");
        if (!this.stopWaiter || this.stopWaiter.child !== child) return;

        waiter.forceTimeout = setTimeout(() => {
          if (this.stopWaiter !== waiter) return;

          this.stopWaiter = null;
          const error = createDaemonStopError(
            "daemon_stop_timeout",
            "DeskCue daemon did not exit after forced shutdown."
          );

          this.daemonStatus = { ...this.daemonStatus, lastError: error.message, state: "degraded" };
          this.options.onStatusChange?.();
          reject(error);
        }, this.options.forceStopTimeoutMs ?? DAEMON_FORCE_STOP_TIMEOUT_MS);
        waiter.forceTimeout.unref?.();
      }, this.options.stopTimeoutMs ?? DAEMON_STOP_TIMEOUT_MS);

      timeout.unref?.();
      this.stopWaiter = {
        acknowledged: false,
        child,
        forceTimeout: null,
        forced: false,
        reject,
        resolve,
        timeout
      };

      const message: HostChildMessage = { reason: "host-request", type: "shutdown" };

      if (child.connected) child.send(message);
      else {
        this.stopWaiter.forced = true;
        this.forcedChildren.add(child);
        child.kill("SIGKILL");
      }
    }).finally(() => {
      this.stopPromise = null;
    });

    return this.stopPromise;
  }

  async restart() {
    await this.stop();
    this.daemonStatus.restartAttempt = 0;
    await this.start();
  }

  async close() {
    this.setDesiredRunning(false);
    await this.stop();
  }

  prepareUpdate() {
    return this.requestUpdateReadiness("prepare-update");
  }

  cancelUpdate() {
    return this.requestUpdateReadiness("cancel-update");
  }

  private clearRestartTimer() {
    if (!this.restartTimer) return;

    clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  private finishStart(error?: Error) {
    const waiter = this.startWaiter;

    if (!waiter) return;

    this.startWaiter = null;
    clearTimeout(waiter.timeout);
    if (error) waiter.reject(error);
    else waiter.resolve();
  }

  private handleChildMessage(child: ChildProcess, message: unknown) {
    if (this.child !== child || !isDaemonChildMessage(message)) return;

    this.applyChildMessage(child, message);
  }

  private applyChildMessage(child: ChildProcess, message: DaemonChildMessage) {
    if (message.type === "update-readiness") {
      const waiter = this.updateWaiters.get(message.requestId);

      if (!waiter) return;

      this.updateWaiters.delete(message.requestId);
      clearTimeout(waiter.timeout);
      waiter.resolve({
        ...(message.backupPath !== undefined ? { backupPath: message.backupPath } : {}),
        blockers: message.blockers,
        ok: message.ok
      });
      return;
    }

    if (message.type === "stopped") {
      if (this.stopWaiter) this.stopWaiter.acknowledged = true;
      return;
    }

    if (message.type === "ready") {
      if (this.stoppingChildren.has(child)) return;

      this.daemonStatus = {
        ...this.daemonStatus,
        baseUrl: message.baseUrl,
        lastError: null,
        pid: message.pid,
        port: message.port,
        state: "running",
        version: message.version
      };

      this.scheduleStableRunReset();
      this.finishStart();
    } else if (message.type === "startup-failed") {
      const error = new Error(message.message);

      this.finishStart(error);
      if (this.stoppingChildren.has(child)) return;

      this.desiredRunning = message.retryable && this.desiredRunning;

      this.daemonStatus = {
        ...this.daemonStatus,
        lastError: message.message,
        state: "degraded"
      };

    }

    this.options.onStatusChange?.();
  }

  private handleChildError(child: ChildProcess, error: Error) {
    if (this.child !== child) return;

    const wasStopping = this.stoppingChildren.has(child);
    const spawnFailed = child.pid === undefined;
    const restartAfterExit = this.restartAfterExitChildren.has(child);

    this.clearStableRunTimer();
    this.failUpdateWaiters(new Error("DeskCue daemon failed during update readiness."));
    if (spawnFailed) {
      this.failStopWaiter(child, createDaemonStopError("daemon_stop_unclean", error.message));
    }

    if (spawnFailed) this.child = null;

    this.daemonStatus = {
      ...this.daemonStatus,
      lastError: error.message,
      ...(spawnFailed ? { baseUrl: null, pid: null, port: null } : {}),
      state: wasStopping && !spawnFailed ? "stopping" : "degraded"
    };

    this.finishStart(error);
    this.options.onStatusChange?.();

    if (spawnFailed && this.desiredRunning && (!wasStopping || restartAfterExit)) {
      this.scheduleRestart(null, null, error.message);
    }
  }

  private handleChildExit(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null) {
    if (this.child !== child) return;

    this.child = null;
    this.clearStableRunTimer();
    this.failUpdateWaiters(new Error("DeskCue daemon exited during update readiness."));
    const wasStopping = this.stoppingChildren.has(child);
    const stopWaiter = this.stopWaiter?.child === child ? this.stopWaiter : null;
    const hadStopWaiter = stopWaiter !== null;
    const restartAfterExit = this.restartAfterExitChildren.has(child);
    const stopError = wasStopping ? this.finishStopWaiter(child, code, signal) : null;

    this.finishStart(new Error(`DeskCue daemon exited before readiness (${code ?? signal ?? "unknown"}).`));

    this.daemonStatus = {
      ...this.daemonStatus,
      baseUrl: null,
      pid: null,
      port: null,
      lastError: stopError?.message ?? (wasStopping ? null : this.daemonStatus.lastError),
      state: wasStopping && !stopError ? "stopped" : "degraded"
    };

    this.options.onStatusChange?.();

    if (this.desiredRunning && (!wasStopping || !hadStopWaiter || restartAfterExit)) {
      this.scheduleRestart(code, signal);
    }
  }

  private scheduleRestart(
    code: number | null,
    signal: NodeJS.Signals | null,
    failureDescription = String(code ?? signal ?? "unknown")
  ) {
    const restartDelaysMs = this.options.restartDelaysMs ?? RESTART_DELAYS_MS;
    const maximumRestarts = restartDelaysMs.length || MAX_AUTOMATIC_RESTARTS;

    if (this.daemonStatus.restartAttempt >= maximumRestarts) {
      this.daemonStatus.lastError = `DeskCue daemon crash loop stopped after ${maximumRestarts} attempts.`;
      this.options.onStatusChange?.();
      return;
    }

    const attempt = this.daemonStatus.restartAttempt + 1;
    const delayMs = restartDelaysMs[attempt - 1] ?? restartDelaysMs.at(-1) ?? RESTART_DELAYS_MS.at(-1)!;

    this.daemonStatus.restartAttempt = attempt;

    this.daemonStatus.lastError = `DeskCue daemon exited unexpectedly (${failureDescription}).`;
    this.options.onStatusChange?.();
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.start(false).catch((error) => {
        this.daemonStatus.lastError = toErrorMessage(error);
        this.options.onStatusChange?.();
      });
    }, delayMs);
    this.restartTimer.unref?.();
  }

  private finishStopWaiter(
    child: ChildProcess,
    code: number | null,
    signal: NodeJS.Signals | null
  ) {
    const waiter = this.stopWaiter;

    if (!waiter || waiter.child !== child) {
      return createDaemonStopError("daemon_stop_unclean", "DeskCue daemon exited without an active stop request.");
    }

    this.stopWaiter = null;
    clearTimeout(waiter.timeout);
    if (waiter.forceTimeout) clearTimeout(waiter.forceTimeout);

    const forced = waiter.forced || this.forcedChildren.has(child);

    if (waiter.acknowledged && !forced && code === 0 && signal === null) {
      waiter.resolve();
      return null;
    }

    const detail = signal ?? (code === null ? "unknown exit" : `exit code ${code}`);
    const error = forced
      ? createDaemonStopError("daemon_stop_forced", `DeskCue daemon required a forced stop (${detail}).`)
      : createDaemonStopError(
          "daemon_stop_unclean",
          waiter.acknowledged
            ? `DeskCue daemon acknowledged shutdown but ended with ${detail}.`
            : `DeskCue daemon exited without a graceful shutdown acknowledgement (${detail}).`
        );

    waiter.reject(error);
    return error;
  }

  private failStopWaiter(child: ChildProcess, error: Error) {
    const waiter = this.stopWaiter;

    if (!waiter || waiter.child !== child) return;

    this.stopWaiter = null;
    clearTimeout(waiter.timeout);
    if (waiter.forceTimeout) clearTimeout(waiter.forceTimeout);
    waiter.reject(error);
  }

  private requestUpdateReadiness(type: "prepare-update" | "cancel-update") {
    const child = this.child;

    if (!child?.connected || this.daemonStatus.state !== "running") {
      return Promise.reject(new Error("DeskCue daemon is not available for update readiness."));
    }

    const requestId = randomUUID();

    return new Promise<DaemonUpdateReadiness>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.updateWaiters.delete(requestId);
        reject(new Error("DeskCue daemon update readiness timed out."));
      }, DAEMON_UPDATE_READINESS_TIMEOUT_MS);

      timeout.unref?.();
      this.updateWaiters.set(requestId, { reject, resolve, timeout });
      child.send({ requestId, type });
    });
  }

  private failUpdateWaiters(error: Error) {
    for (const waiter of this.updateWaiters.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }

    this.updateWaiters.clear();
  }

  private scheduleStableRunReset() {
    this.clearStableRunTimer();
    this.stableRunTimer = setTimeout(() => {
      this.stableRunTimer = null;
      this.daemonStatus.restartAttempt = 0;
      this.options.onStatusChange?.();
    }, STABLE_RUN_RESET_MS);
    this.stableRunTimer.unref?.();
  }

  private clearStableRunTimer() {
    if (!this.stableRunTimer) return;

    clearTimeout(this.stableRunTimer);
    this.stableRunTimer = null;
  }
}
