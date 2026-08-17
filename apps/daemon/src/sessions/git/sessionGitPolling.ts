import { resolve } from "node:path";

import type { GitSnapshot, SessionDetail } from "@deskcue/protocol";
import { daemonConfig } from "#config/daemonConfig";
import { buildGitSnapshot } from "#infrastructure/git";
import { logger } from "#infrastructure/logging/logger";

type SessionGitPollingOptions = {
  buildSnapshot?: typeof buildGitSnapshot;
  concurrency?: number;
  getSession: (sessionId: string) => SessionDetail | null;
  onGitSnapshot: (sessionId: string, git: GitSnapshot) => void;
  queueCapacity?: number;
};

type QueuedWorkspaceRead = {
  reject: (reason?: unknown) => void;
  start: () => void;
};

const DEFAULT_GIT_POLL_CONCURRENCY = 2;
const DEFAULT_GIT_POLL_QUEUE_CAPACITY = 64;

function readPositiveInteger(value: number | undefined, fallback: number) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new TypeError("Managed Git polling limits must be positive integers.");
  }
  return resolved;
}

export class SessionGitPolling {
  private activeReadCount = 0;
  private readonly activeReads = new Set<Promise<GitSnapshot>>();
  private readonly buildSnapshot: typeof buildGitSnapshot;
  private closed = false;
  private closePromise: Promise<void> | null = null;
  private readonly concurrency: number;
  private readonly inFlightWorkspaceReads = new Map<string, Promise<GitSnapshot>>();
  private readonly queueCapacity: number;
  private readonly queuedWorkspaceReads: QueuedWorkspaceRead[] = [];
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly options: SessionGitPollingOptions) {
    this.buildSnapshot = options.buildSnapshot ?? buildGitSnapshot;
    this.concurrency = readPositiveInteger(options.concurrency, DEFAULT_GIT_POLL_CONCURRENCY);
    this.queueCapacity = readPositiveInteger(options.queueCapacity, DEFAULT_GIT_POLL_QUEUE_CAPACITY);
  }

  start(sessionId: string, workspacePath: string) {
    if (this.closed) return;
    this.stop(sessionId);

    let isRefreshing = false;
    const refresh = async () => {
      if (isRefreshing) {
        return;
      }

      isRefreshing = true;
      try {
        const session = this.options.getSession(sessionId);
        if (!session || session.status !== "running") {
          this.stop(sessionId);
          return;
        }

        const git = await this.readWorkspaceSnapshot(workspacePath);
        const updatedSession = this.options.getSession(sessionId);
        if (!updatedSession || updatedSession.status !== "running") {
          this.stop(sessionId);
          return;
        }

        this.options.onGitSnapshot(sessionId, git);

        logger.debug("Background git poll refreshed session", {
          sessionId,
          isDirty: git.isDirty,
          changedFiles: git.changedFiles.length
        });
      } catch {
        if (!this.closed) {
          logger.warn("Background git poll failed", {
            sessionId
          });
        }
      } finally {
        isRefreshing = false;
      }
    };

    const timer = setInterval(refresh, daemonConfig.sessionGitPollingIntervalMs);

    this.timers.set(sessionId, timer);
    void refresh();
  }

  stop(sessionId: string) {
    const timer = this.timers.get(sessionId);
    if (!timer) {
      return;
    }

    clearInterval(timer);
    this.timers.delete(sessionId);
  }

  stopAll() {
    for (const sessionId of this.timers.keys()) {
      this.stop(sessionId);
    }
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.stopAll();
    for (const queued of this.queuedWorkspaceReads.splice(0)) {
      queued.reject(new Error("Managed Git polling is shutting down."));
    }
    this.inFlightWorkspaceReads.clear();
    this.closePromise = Promise.allSettled([...this.activeReads]).then(() => undefined);
    return this.closePromise;
  }

  private readWorkspaceSnapshot(workspacePath: string) {
    if (this.closed) return Promise.reject(new Error("Managed Git polling is shutting down."));
    const normalizedPath = resolve(workspacePath);
    const key = process.platform === "win32" ? normalizedPath.toLowerCase() : normalizedPath;
    const existing = this.inFlightWorkspaceReads.get(key);
    if (existing) return existing;
    if (this.queuedWorkspaceReads.length >= this.queueCapacity) {
      return Promise.reject(new Error("Managed Git polling queue is full."));
    }

    let rejectQueued!: (reason?: unknown) => void;
    let start!: () => void;
    const promise = new Promise<GitSnapshot>((resolve, reject) => {
      rejectQueued = reject;
      start = () => {
        this.activeReadCount += 1;
        this.activeReads.add(promise);
        let read: Promise<GitSnapshot>;
        try {
          read = this.buildSnapshot(workspacePath);
        } catch (error) {
          read = Promise.reject(error);
        }
        read.then(resolve, reject).finally(() => {
          this.activeReadCount -= 1;
          this.activeReads.delete(promise);
          if (this.inFlightWorkspaceReads.get(key) === promise) {
            this.inFlightWorkspaceReads.delete(key);
          }
          this.startQueuedWorkspaceReads();
        }).catch(() => undefined);
      };
    });
    this.inFlightWorkspaceReads.set(key, promise);
    this.queuedWorkspaceReads.push({
      reject: (reason) => {
        if (this.inFlightWorkspaceReads.get(key) === promise) {
          this.inFlightWorkspaceReads.delete(key);
        }
        rejectQueued(reason);
      },
      start
    });
    this.startQueuedWorkspaceReads();
    return promise;
  }

  private startQueuedWorkspaceReads() {
    while (
      !this.closed &&
      this.activeReadCount < this.concurrency &&
      this.queuedWorkspaceReads.length > 0
    ) {
      this.queuedWorkspaceReads.shift()?.start();
    }
  }
}
