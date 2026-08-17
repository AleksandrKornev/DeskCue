import { logger } from "#infrastructure/logging/logger";
import {
  normalizeOwnedProcessId,
  terminateOwnedProcessTree
} from "#infrastructure/process/ownedProcessTree";
import type { OwnedProcessTree } from "#infrastructure/process/ownedProcessTree";

import { createSessionPipe, createSessionPty } from "./sessionProcess.ts";
import type { RunningChild, SessionSpawnSpec } from "./sessionProcess.ts";

type SpawnSessionProcessInput = {
  command: string;
  cwd: string;
  env: Record<string, string | undefined>;
  sessionId: string;
  spawnSpec?: SessionSpawnSpec;
};

type SessionRunnerOptions = {
  createPipe?: typeof createSessionPipe;
  createPty?: typeof createSessionPty;
};

export type SessionRunnerShutdownSurvivor = {
  error: string;
  pid: number | null;
  sessionId: string;
};

export type SessionRunnerShutdownResult = {
  confirmedExitSessionIds: string[];
  preservedSessionIds: string[];
  survivors: SessionRunnerShutdownSurvivor[];
};

const SESSION_RUNNER_SHUTDOWN_TIMEOUT_MS = 2_000;
const SESSION_PROCESS_TERMINATION_GRACE_MS = 500;

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export class SessionRunner {
  private readonly children = new Map<string, RunningChild>();
  private readonly delayedActions = new Map<string, NodeJS.Timeout>();
  private readonly exitPromises = new Map<RunningChild, Promise<void>>();
  private readonly exitedChildren = new WeakSet<RunningChild>();

  constructor(private readonly options: SessionRunnerOptions = {}) {}

  spawnProcess({ command, cwd, env, sessionId, spawnSpec }: SpawnSessionProcessInput) {
    const child = spawnSpec?.transport === "pipe"
      ? (this.options.createPipe ?? createSessionPipe)(cwd, env, spawnSpec)
      : (this.options.createPty ?? createSessionPty)(command, cwd, env, spawnSpec);
    this.children.set(sessionId, child);
    let resolveExit!: () => void;
    const exitPromise = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    this.exitPromises.set(child, exitPromise);
    child.onExit(() => {
      this.exitedChildren.add(child);
      this.exitPromises.delete(child);
      resolveExit();
    });
    return child;
  }

  getChild(sessionId: string) {
    return this.children.get(sessionId);
  }

  hasChild(sessionId: string) {
    return this.children.has(sessionId);
  }

  isCurrentChild(sessionId: string, child: RunningChild) {
    return this.children.get(sessionId) === child;
  }

  deleteChild(sessionId: string) {
    this.cancelDelayedAction(sessionId);
    const child = this.children.get(sessionId);
    // A terminal transcript may finalize the UI before a one-shot CLI closes
    // its streams. Keep owning that process until an actual exit is observed,
    // so shutdown can retry termination instead of orphaning it.
    if (child && !this.exitedChildren.has(child)) {
      return false;
    }
    return this.children.delete(sessionId);
  }

  scheduleDelayedAction(
    sessionId: string,
    action: () => Promise<void>,
    delayMs: number
  ) {
    this.cancelDelayedAction(sessionId);
    const timer = setTimeout(() => {
      this.delayedActions.delete(sessionId);
      void action().catch((error) => {
        logger.error("Delayed session action failed", {
          message: error instanceof Error ? error.message : String(error),
          sessionId
        });
      });
    }, Math.max(0, delayMs));
    timer.unref?.();
    this.delayedActions.set(sessionId, timer);
  }

  async killChild(
    sessionId: string,
    child: RunningChild | undefined,
    reason: string,
    timeoutMs = SESSION_RUNNER_SHUTDOWN_TIMEOUT_MS
  ) {
    if (!child) {
      return;
    }

    try {
      await terminateOwnedProcessTree(this.toOwnedProcessTree(child), {
        processDidNotExitMessage: (pid) =>
          `Managed session process ${pid ?? "with unknown pid"} did not exit.`,
        processGroupDidNotTerminateMessage: (pid) =>
          `Managed session process tree ${pid} did not terminate.`,
        terminateGraceMs: Math.min(SESSION_PROCESS_TERMINATION_GRACE_MS, timeoutMs),
        timeoutMs: Math.max(1, timeoutMs)
      });
    } catch (error) {
      logger.warn("Failed to kill session process", {
        sessionId,
        reason,
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async close({
    preserve = () => false,
    timeoutMs = SESSION_RUNNER_SHUTDOWN_TIMEOUT_MS
  }: {
    preserve?: (sessionId: string, child: RunningChild) => boolean;
    timeoutMs?: number;
  } = {}) {
    for (const sessionId of this.delayedActions.keys()) {
      this.cancelDelayedAction(sessionId);
    }
    const activeChildren = [...this.children.entries()].map(([sessionId, child]) => ({
      child,
      sessionId
    }));
    const preservedChildren = activeChildren.filter(({ child, sessionId }) =>
      child.transport === "pipe" && child.surviveParentExit === true && preserve(sessionId, child)
    );
    const terminatedChildren = activeChildren.filter(
      ({ sessionId }) => !preservedChildren.some((entry) => entry.sessionId === sessionId)
    );
    for (const { child, sessionId } of preservedChildren) {
      this.children.delete(sessionId);
      this.exitPromises.delete(child);
      child.detachFromDeskCue?.();
    }
    const terminationResults = terminatedChildren.length > 0
      ? await Promise.allSettled(terminatedChildren.map(({ child, sessionId }) =>
        this.killChild(sessionId, child, "daemon shutdown", timeoutMs)
      ))
      : [];

    const result: SessionRunnerShutdownResult = {
      confirmedExitSessionIds: [],
      preservedSessionIds: preservedChildren.map(({ sessionId }) => sessionId),
      survivors: []
    };
    terminatedChildren.forEach(({ child, sessionId }, index) => {
      if (this.exitedChildren.has(child)) {
        result.confirmedExitSessionIds.push(sessionId);
        return;
      }

      const terminationResult = terminationResults[index];
      result.survivors.push({
        error: terminationResult?.status === "rejected"
          ? toErrorMessage(terminationResult.reason)
          : "Process exit was not confirmed before the shutdown deadline.",
        pid: normalizeOwnedProcessId(child.pid),
        sessionId
      });
    });
    return result;
  }

  private toOwnedProcessTree(child: RunningChild): OwnedProcessTree<RunningChild> {
    return {
      child,
      exited: this.exitPromises.get(child) ?? Promise.resolve(),
      hasExited: () => this.exitedChildren.has(child),
      pid: normalizeOwnedProcessId(child.pid)
    };
  }

  private cancelDelayedAction(sessionId: string) {
    const timer = this.delayedActions.get(sessionId);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    this.delayedActions.delete(sessionId);
  }
}
