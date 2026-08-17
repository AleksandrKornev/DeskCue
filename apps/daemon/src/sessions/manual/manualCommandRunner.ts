import { spawn as spawnChildProcess } from "node:child_process";
import { stat } from "node:fs/promises";

import type { ManualCommandResult } from "@deskcue/protocol";
import {
  normalizeOwnedProcessId,
  terminateOwnedProcessTree
} from "#infrastructure/process/ownedProcessTree";
import type { OwnedProcessTree } from "#infrastructure/process/ownedProcessTree";

const DEFAULT_MANUAL_COMMAND_START_GRACE_MS = 1_000;
const DEFAULT_MANUAL_COMMAND_CLOSE_TIMEOUT_MS = 5_000;
const DEFAULT_MANUAL_COMMAND_TERMINATE_GRACE_MS = 1_500;
const DEFAULT_MANUAL_COMMAND_CONCURRENCY = 4;

export class ManualCommandCapacityError extends Error {
  constructor(limit: number) {
    super(`Manual command capacity is exhausted (${limit} active commands).`);
    this.name = "ManualCommandCapacityError";
  }
}

type ManualCommandChild = {
  kill(signal?: NodeJS.Signals): boolean;
  pid?: number;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
};

type SpawnManualCommand = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    detached: boolean;
    shell: true;
    stdio: "ignore";
    windowsHide: true;
  }
) => ManualCommandChild;

type ActiveManualCommand = OwnedProcessTree<ManualCommandChild>;

type TerminateManualCommandProcessTree = (
  command: ActiveManualCommand,
  options: {
    terminateGraceMs: number;
    timeoutMs: number;
  }
) => Promise<void>;

type RunManualCommandOptions = {
  closeTimeoutMs?: number;
  spawnCommand?: SpawnManualCommand;
  startGraceMs?: number;
  terminateGraceMs?: number;
  terminateProcessTree?: TerminateManualCommandProcessTree;
  validateWorkingDirectory?: (cwd: string) => Promise<string | null>;
  now?: () => number;
  maxActiveCommands?: number;
};

function terminateManualCommandProcessTree(
  command: ActiveManualCommand,
  options: {
    terminateGraceMs: number;
    timeoutMs: number;
  }
) {
  return terminateOwnedProcessTree(command, {
    ...options,
    processDidNotExitMessage: (pid) =>
      `Timed out while terminating manual command process tree${
        pid === null ? "" : ` ${pid}`
      }.`,
    processGroupDidNotTerminateMessage: (pid) =>
      `Manual command process group ${pid} did not terminate.`
  });
}

function normalizePositiveDuration(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Math.floor(value as number) : fallback;
}

function normalizePositiveInteger(value: number | undefined, fallback: number) {
  return Number.isInteger(value) && (value ?? 0) > 0 ? value as number : fallback;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function validateWorkingDirectory(cwd: string): Promise<string | null> {
  try {
    const directory = await stat(cwd);
    if (!directory.isDirectory()) {
      return `Working directory is not a directory: ${cwd}`;
    }
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Working directory is not available: ${message}`;
  }
}

function finishedResult({
  ok,
  pid,
  stderr,
  startedAt,
  now
}: {
  ok: boolean;
  pid: number | null;
  stderr: string;
  startedAt: number;
  now: () => number;
}): ManualCommandResult {
  return {
    status: "finished",
    ok,
    exitCode: null,
    pid,
    signal: null,
    stdout: "",
    stderr,
    durationMs: now() - startedAt,
    truncated: false
  };
}

export class ManualCommandRunner {
  private readonly activeCommands = new Set<ActiveManualCommand>();
  private admittedCount = 0;
  private closed = false;
  private closePromise: Promise<void> | null = null;

  constructor(private readonly options: RunManualCommandOptions = {}) {}

  async run(command: string, cwd: string): Promise<ManualCommandResult> {
    if (this.closed) {
      throw new Error("Manual command runner is closed.");
    }
    const maxActiveCommands = normalizePositiveInteger(
      this.options.maxActiveCommands,
      DEFAULT_MANUAL_COMMAND_CONCURRENCY
    );
    if (this.admittedCount >= maxActiveCommands) {
      throw new ManualCommandCapacityError(maxActiveCommands);
    }
    this.admittedCount += 1;
    let admissionReleased = false;
    const releaseAdmission = () => {
      if (admissionReleased) return;
      admissionReleased = true;
      this.admittedCount = Math.max(0, this.admittedCount - 1);
    };

    const options = this.options;
    const now = options.now ?? Date.now;
    const startedAt = now();
    const workingDirectoryError = await (
      options.validateWorkingDirectory ?? validateWorkingDirectory
    )(cwd);
    if (workingDirectoryError) {
      releaseAdmission();
      return finishedResult({
        ok: false,
        pid: null,
        stderr: workingDirectoryError,
        startedAt,
        now
      });
    }
    if (this.closed) {
      releaseAdmission();
      throw new Error("Manual command runner is closed.");
    }

    const spawnCommand = options.spawnCommand ?? spawnChildProcess;
    const startGraceMs = options.startGraceMs ?? DEFAULT_MANUAL_COMMAND_START_GRACE_MS;

    return new Promise((resolve) => {
      let settled = false;
      let child: ManualCommandChild;
      let activeCommand: ActiveManualCommand;
      let startedTimer: ReturnType<typeof setTimeout> | null = null;

      const finish = (result: ManualCommandResult) => {
        if (settled) {
          return;
        }

        settled = true;
        if (startedTimer) {
          clearTimeout(startedTimer);
        }
        resolve(result);
      };

      try {
        child = spawnCommand(command, [], {
          cwd,
          detached: process.platform !== "win32",
          shell: true,
          stdio: "ignore",
          windowsHide: true
        });
      } catch (error) {
        releaseAdmission();
        finish(
          finishedResult({
            ok: false,
            pid: null,
            stderr: error instanceof Error ? error.message : String(error),
            startedAt,
            now
          })
        );
        return;
      }

      let childExited = false;
      let resolveExited!: () => void;
      const exited = new Promise<void>((resolveExit) => {
        resolveExited = resolveExit;
      });
      activeCommand = {
        child,
        exited,
        hasExited: () => childExited,
        pid: normalizeOwnedProcessId(child.pid)
      };
      this.activeCommands.add(activeCommand);
      startedTimer = setTimeout(() => {
        finish({
          status: "started",
          ok: true,
          exitCode: null,
          pid: child.pid ?? null,
          signal: null,
          stdout: "",
          stderr: "",
          durationMs: now() - startedAt,
          truncated: false
        });
      }, startGraceMs);

      child.once("error", (error) => {
        childExited = true;
        this.activeCommands.delete(activeCommand);
        resolveExited();
        releaseAdmission();
        finish(
          finishedResult({
            ok: false,
            pid: child.pid ?? null,
            stderr: error instanceof Error ? error.message : String(error),
            startedAt,
            now
          })
        );
      });

      child.once("exit", (code, signal) => {
        childExited = true;
        this.activeCommands.delete(activeCommand);
        resolveExited();
        releaseAdmission();
        finish({
          status: "finished",
          ok: code === 0,
          exitCode: code,
          pid: child.pid ?? null,
          signal,
          stdout: "",
          stderr: "",
          durationMs: now() - startedAt,
          truncated: false
        });
      });
    });
  }

  close(): Promise<void> {
    if (this.closePromise) {
      return this.closePromise;
    }
    this.closed = true;

    const activeCommands = [...this.activeCommands];
    const closeTimeoutMs = normalizePositiveDuration(
      this.options.closeTimeoutMs,
      DEFAULT_MANUAL_COMMAND_CLOSE_TIMEOUT_MS
    );
    const terminateGraceMs = Math.min(
      normalizePositiveDuration(
        this.options.terminateGraceMs,
        DEFAULT_MANUAL_COMMAND_TERMINATE_GRACE_MS
      ),
      closeTimeoutMs
    );
    const terminateProcessTree = this.options.terminateProcessTree ?? terminateManualCommandProcessTree;

    this.closePromise = (async () => {
      const results = await Promise.allSettled(
        activeCommands.map(async (activeCommand) => {
          try {
            await withTimeout(
              terminateProcessTree(activeCommand, {
                terminateGraceMs,
                timeoutMs: closeTimeoutMs
              }),
              closeTimeoutMs,
              `Timed out while terminating manual command process tree${
                activeCommand.pid === null ? "" : ` ${activeCommand.pid}`
              }.`
            );
          } finally {
            this.activeCommands.delete(activeCommand);
          }
        })
      );
      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => (result as { reason: unknown }).reason);
      if (failures.length > 0) {
        throw new AggregateError(failures, "One or more manual commands failed to terminate.");
      }
    })();

    return this.closePromise;
  }
}
