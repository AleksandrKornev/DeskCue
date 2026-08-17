import { spawn } from "node:child_process";
import path from "node:path";

import {
  normalizeOwnedProcessId,
  terminateOwnedProcessTree
} from "#infrastructure/process/ownedProcessTree";
import type { OwnedProcessTree } from "#infrastructure/process/ownedProcessTree";

import { clampLocalLlmToolLimit, LocalLlmToolError } from "./localLlmToolTypes.ts";
import type { LocalLlmToolExecutorLimits, LocalLlmToolRequest } from "./localLlmToolTypes.ts";

const COMMAND_TERMINATE_GRACE_MS = 1_500;
const COMMAND_TERMINATE_TIMEOUT_MS = 5_000;

type RunWorkspaceCommandRequest = Extract<LocalLlmToolRequest, { name: "run_workspace_command" }>;

type ActiveLocalLlmCommand = OwnedProcessTree<ReturnType<typeof spawn>>;

function normalizeExecutableName(value: string) {
  return path.basename(value.trim()).toLowerCase().replace(/\.exe$/, "");
}

export function createDeniedLocalLlmExecutableSet(values: readonly string[]) {
  return new Set(values.map(normalizeExecutableName).filter(Boolean));
}

async function terminateLocalLlmCommandProcessTree(
  command: ActiveLocalLlmCommand,
  options: { terminateGraceMs: number; timeoutMs: number }
) {
  await terminateOwnedProcessTree(command, {
    ...options,
    createError: (message) => new LocalLlmToolError(message),
    processDidNotExitMessage: (pid) => pid === null
      ? "Command did not exit after termination."
      : `Command process ${pid} did not exit.`,
    processGroupDidNotTerminateMessage: (pid) =>
      `Command process group ${pid} did not terminate.`
  });
}

function deferredSignal<T extends string>(type: T, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<{ type: T }>((resolve) => {
    timer = setTimeout(() => resolve({ type }), timeoutMs);
    timer.unref?.();
  });
  return { promise, cancel: () => clearTimeout(timer!) };
}

function abortSignal(signal: AbortSignal) {
  let onAbort: (() => void) | null = null;
  const promise = new Promise<{ type: "aborted" }>((resolve) => {
    onAbort = () => resolve({ type: "aborted" });
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  return {
    promise,
    cancel: () => {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  };
}

async function runCommand(input: {
  args: string[];
  command: string;
  cwd: string;
  maxOutputBytes: number;
  signal?: AbortSignal;
  timeoutMs: number;
}) {
  input.signal?.throwIfAborted();
  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    detached: process.platform !== "win32",
    shell: false,
    windowsHide: true
  });
  let output = "";
  let outputBytes = 0;
  let truncated = false;
  let exited = false;

  const append = (chunk: Buffer | string) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = input.maxOutputBytes - outputBytes;
    if (remaining <= 0) {
      truncated = true;
      return;
    }
    const clipped = buffer.subarray(0, remaining);
    output += clipped.toString("utf8");
    outputBytes += clipped.byteLength;
    truncated ||= clipped.byteLength < buffer.byteLength;
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);

  let resolveExited!: () => void;
  const exitedPromise = new Promise<void>((resolve) => {
    resolveExited = resolve;
  });
  const completion = new Promise<{ exitCode: number | null }>((resolve, reject) => {
    child.once("error", (error) => {
      exited = true;
      resolveExited();
      reject(new LocalLlmToolError(`Command failed to start: ${error.message}`));
    });
    child.once("close", (exitCode) => {
      exited = true;
      resolveExited();
      resolve({ exitCode });
    });
  });
  // Keep a handler attached if spawn emits synchronously on an unusual
  // platform before Promise.race below has observed the completion promise.
  void completion.catch(() => undefined);

  const active: ActiveLocalLlmCommand = {
    child,
    exited: exitedPromise,
    hasExited: () => exited,
    pid: normalizeOwnedProcessId(child.pid)
  };
  const timeout = deferredSignal("timeout", input.timeoutMs);
  const aborted = input.signal ? abortSignal(input.signal) : null;
  try {
    const outcome = await Promise.race([
      completion.then((result) => ({ type: "completed" as const, result })),
      timeout.promise,
      ...(aborted ? [aborted.promise] : [])
    ]);
    if (outcome.type === "completed") {
      return {
        exitCode: outcome.result.exitCode,
        output,
        timedOut: false,
        truncated
      };
    }

    await terminateLocalLlmCommandProcessTree(active, {
      terminateGraceMs: COMMAND_TERMINATE_GRACE_MS,
      timeoutMs: COMMAND_TERMINATE_TIMEOUT_MS
    });
    if (outcome.type === "aborted") {
      input.signal?.throwIfAborted();
      throw new LocalLlmToolError("Command was aborted.");
    }
    return { exitCode: null, output, timedOut: true, truncated };
  } finally {
    timeout.cancel();
    aborted?.cancel();
  }
}

export async function runLocalLlmWorkspaceCommand(
  root: string,
  request: RunWorkspaceCommandRequest,
  deniedExecutables: ReadonlySet<string>,
  limits: LocalLlmToolExecutorLimits,
  signal?: AbortSignal
) {
  if (!/^[A-Za-z0-9_.-]+(?:\.exe)?$/i.test(request.command)) {
    throw new LocalLlmToolError("Command must be an executable name, not a shell expression or path.");
  }
  if (deniedExecutables.has(normalizeExecutableName(request.command))) {
    throw new LocalLlmToolError(`Command ${request.command} is denied by this DeskCue daemon.`);
  }
  const args = [...(request.args ?? [])];
  if (args.length > 64 || args.some((argument) => argument.length > 4096)) {
    throw new LocalLlmToolError("Command arguments exceed the configured limit.");
  }
  const timeoutMs = clampLocalLlmToolLimit(request.timeoutMs ?? 30_000, 1_000, limits.maxCommandTimeoutMs);
  return runCommand({
    args,
    command: request.command,
    cwd: root,
    maxOutputBytes: limits.maxCommandOutputBytes,
    signal,
    timeoutMs
  });
}
