import { execFile } from "node:child_process";

const PROCESS_GROUP_POLL_INTERVAL_MS = 25;

export type OwnedProcessTreeChild = {
  kill(signal?: NodeJS.Signals): unknown;
};

export type OwnedProcessTree<Child extends OwnedProcessTreeChild = OwnedProcessTreeChild> = {
  child: Child;
  exited: Promise<void>;
  hasExited: () => boolean;
  pid: number | null;
};

export type ProcessTreeTerminationRuntime = {
  isProcessGroupAlive: (pid: number) => boolean;
  now: () => number;
  platform: NodeJS.Platform;
  signalProcessGroup: (pid: number, signal: NodeJS.Signals) => void;
  terminateWindowsProcessTree: (pid: number, timeoutMs: number) => Promise<void>;
  wait: (durationMs: number) => Promise<void>;
};

export type TerminateOwnedProcessTreeOptions = {
  createError?: (message: string) => Error;
  processDidNotExitMessage: (pid: number | null) => string;
  processGroupDidNotTerminateMessage: (pid: number) => string;
  runtime?: ProcessTreeTerminationRuntime;
  terminateGraceMs: number;
  timeoutMs: number;
};

export function normalizeOwnedProcessId(pid: number | undefined) {
  return Number.isSafeInteger(pid) && (pid ?? 0) > 0 ? (pid as number) : null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutError: Error) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(timeoutError), timeoutMs);
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

function remainingDuration(deadline: number, now: number) {
  return Math.max(1, deadline - now);
}

async function waitForChildExit(
  processTree: OwnedProcessTree,
  deadline: number,
  runtime: ProcessTreeTerminationRuntime,
  createError: (message: string) => Error,
  options: TerminateOwnedProcessTreeOptions
) {
  if (processTree.hasExited()) {
    return;
  }
  await withTimeout(
    processTree.exited,
    remainingDuration(deadline, runtime.now()),
    createError(options.processDidNotExitMessage(processTree.pid))
  );
}

async function waitForProcessGroupExit(
  pid: number,
  timeoutMs: number,
  runtime: ProcessTreeTerminationRuntime
) {
  const deadline = runtime.now() + timeoutMs;
  while (runtime.isProcessGroupAlive(pid)) {
    if (runtime.now() >= deadline) {
      return false;
    }
    await runtime.wait(Math.min(PROCESS_GROUP_POLL_INTERVAL_MS, remainingDuration(deadline, runtime.now())));
  }
  return true;
}

function normalizeDuration(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function isMissingProcessError(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ESRCH";
}

const defaultRuntime: ProcessTreeTerminationRuntime = {
  isProcessGroupAlive(pid) {
    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      return !isMissingProcessError(error);
    }
  },
  now: Date.now,
  platform: process.platform,
  signalProcessGroup(pid, signal) {
    try {
      process.kill(-pid, signal);
    } catch (error) {
      if (!isMissingProcessError(error)) {
        throw error;
      }
    }
  },
  terminateWindowsProcessTree(pid, timeoutMs) {
    return new Promise<void>((resolve, reject) => {
      execFile(
        "taskkill.exe",
        ["/PID", String(pid), "/T", "/F"],
        { shell: false, timeout: timeoutMs, windowsHide: true },
        (error) => error ? reject(error) : resolve()
      );
    });
  },
  wait(durationMs) {
    return new Promise<void>((resolve) => setTimeout(resolve, durationMs));
  }
};

/**
 * Terminates one DeskCue-owned child and every descendant within a bounded
 * deadline. Domain runners provide their own error factory/messages while the
 * OS-specific taskkill/process-group behavior stays shared.
 */
export async function terminateOwnedProcessTree(
  processTree: OwnedProcessTree,
  options: TerminateOwnedProcessTreeOptions
) {
  const runtime = options.runtime ?? defaultRuntime;
  const createError = options.createError ?? ((message: string) => new Error(message));
  const timeoutMs = normalizeDuration(options.timeoutMs);
  const terminateGraceMs = Math.min(normalizeDuration(options.terminateGraceMs), timeoutMs);
  const deadline = runtime.now() + timeoutMs;

  if (processTree.pid === null) {
    try {
      processTree.child.kill();
    } catch {
      // The child may have exited between the active-set read and kill.
    }
    await waitForChildExit(processTree, deadline, runtime, createError, options);
    return;
  }

  if (runtime.platform === "win32") {
    try {
      await runtime.terminateWindowsProcessTree(
        processTree.pid,
        remainingDuration(deadline, runtime.now())
      );
    } catch (error) {
      // taskkill reports a failure when the exact process exits during the
      // call. Let Node observe that benign race before surfacing the error.
      await Promise.race([processTree.exited, runtime.wait(PROCESS_GROUP_POLL_INTERVAL_MS)]);
      if (!processTree.hasExited()) {
        throw error;
      }
    }
    await waitForChildExit(processTree, deadline, runtime, createError, options);
    return;
  }

  runtime.signalProcessGroup(processTree.pid, "SIGTERM");
  const gracefulExit = await waitForProcessGroupExit(
    processTree.pid,
    Math.min(terminateGraceMs, remainingDuration(deadline, runtime.now())),
    runtime
  );
  if (!gracefulExit) {
    runtime.signalProcessGroup(processTree.pid, "SIGKILL");
    if (!await waitForProcessGroupExit(
      processTree.pid,
      remainingDuration(deadline, runtime.now()),
      runtime
    )) {
      throw createError(options.processGroupDidNotTerminateMessage(processTree.pid));
    }
  }
  await waitForChildExit(processTree, deadline, runtime, createError, options);
}
