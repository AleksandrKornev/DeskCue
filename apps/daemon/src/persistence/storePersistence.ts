import { performance } from "node:perf_hooks";

import type { SessionDetail, WorkspaceSummary } from "@deskcue/protocol";
import { daemonConfig } from "#config/daemonConfig";
import { logger } from "#infrastructure/logging/logger";

import { DeskCueSqliteStateStorage } from "./state/sqliteStateStorage.ts";
import { DeskCueJsonStateStorage } from "./state/state.ts";
import { hasPersistedState } from "./state/types.ts";
import type { DaemonStateStorage, PersistedDeskCueStatePatch } from "./state/types.ts";

type DeskCuePersistenceOptions = {
  legacyJsonStorage?: DaemonStateStorage;
  listDirtyPersistedSessions: () => SessionDetail[];
  listDirtyWorkspaces: () => WorkspaceSummary[];
  listPartialSessionIds: () => string[];
  listPersistedSessions: () => SessionDetail[];
  listWorkspaces: () => WorkspaceSummary[];
  markAllPersisted: () => void;
  markPersisted: (workspaceIds: string[], sessionIds: string[]) => void;
  stateStorage?: DaemonStateStorage;
};

const SLOW_PERSIST_LOG_THRESHOLD_MS = 100;

function elapsedMs(startedAt: number) {
  return Math.round(performance.now() - startedAt);
}

export class DeskCuePersistence {
  private closePromise: Promise<void> | null = null;
  private closing = false;
  private persistChain = Promise.resolve();
  private persistTimer: NodeJS.Timeout | null = null;
  private readonly legacyJsonStorage: DaemonStateStorage;
  private readonly stateStorage: DaemonStateStorage;

  constructor(private readonly options: DeskCuePersistenceOptions) {
    this.legacyJsonStorage = options.legacyJsonStorage ?? new DeskCueJsonStateStorage();
    this.stateStorage = options.stateStorage ?? new DeskCueSqliteStateStorage();
  }

  async load() {
    const state = await this.stateStorage.load();
    if (hasPersistedState(state)) {
      return state;
    }

    const legacyState = await this.legacyJsonStorage.load();
    if (!hasPersistedState(legacyState)) {
      return state;
    }

    await this.stateStorage.save(legacyState);
    return legacyState;
  }

  persistNow(options: { full?: boolean } = {}) {
    return this.queuePersist(options);
  }

  private queuePersist(options: { full?: boolean } = {}) {
    const persist = this.persistChain
      .catch(() => undefined)
      .then(() => this.performPersistNow(options));
    this.persistChain = persist;
    return persist;
  }

  private async performPersistNow(options: { full?: boolean } = {}) {
    const startedAt = performance.now();
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }

    const workspacesStartedAt = performance.now();
    const workspaces = options.full
      ? this.options.listWorkspaces()
      : this.options.listDirtyWorkspaces();
    const listWorkspacesDurationMs = elapsedMs(workspacesStartedAt);
    const sessionsStartedAt = performance.now();
    const sessions = options.full
      ? this.options.listPersistedSessions()
      : this.options.listDirtyPersistedSessions();
    const listSessionsDurationMs = elapsedMs(sessionsStartedAt);

    if (!options.full && workspaces.length === 0 && sessions.length === 0) {
      return;
    }

    const saveStartedAt = performance.now();

    const state = {
      version: 1,
      workspaces,
      sessions,
      partialSessionIds: options.full ? this.options.listPartialSessionIds() : []
    } satisfies PersistedDeskCueStatePatch;

    if (!options.full && this.stateStorage instanceof DeskCueSqliteStateStorage) {
      await this.stateStorage.savePatch(state);
      this.options.markPersisted(
        workspaces.map((workspace) => workspace.id),
        sessions.map((session) => session.id)
      );
    } else {
      await this.stateStorage.save(state);
      this.options.markAllPersisted();
      if (this.stateStorage instanceof DeskCueSqliteStateStorage) {
        this.stateStorage.checkpointWalIfLarge("full-persist");
      }
    }

    const saveDurationMs = elapsedMs(saveStartedAt);
    const totalDurationMs = elapsedMs(startedAt);

    if (totalDurationMs >= SLOW_PERSIST_LOG_THRESHOLD_MS) {
      logger.info("Daemon state persist completed", {
        mode: options.full ? "full" : "patch",
        workspaces: workspaces.length,
        sessions: sessions.length,
        sessionLogLines: sessions.reduce((total, session) => total + session.logs.length, 0),
        listWorkspacesDurationMs,
        listSessionsDurationMs,
        saveDurationMs,
        totalDurationMs
      });
    }
  }

  schedulePersist() {
    if (this.closing || this.persistTimer) {
      return;
    }

    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persistNow().catch((error) => {
        logger.error("Scheduled daemon state persistence failed", {
          message: error instanceof Error ? error.message : String(error)
        });
      });
    }, daemonConfig.persistDebounceMs);
  }

  close() {
    if (this.closePromise) {
      return this.closePromise;
    }

    this.closing = true;

    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }

    const flush = this.queuePersist();
    this.closePromise = (async () => {
      await flush;
      if (this.stateStorage instanceof DeskCueSqliteStateStorage) {
        this.stateStorage.close();
      }
    })();
    return this.closePromise;
  }
}
