import { logger } from "#infrastructure/logging/logger";
import { DeskCueSqliteStateStorage } from "#persistence/state/sqliteStateStorage";
import type { DaemonStateStorage } from "#persistence/state/types";
import { DeskCuePersistence } from "#persistence/storePersistence";
import { hydratePersistedSessions } from "#sessions/state/sessionHydration";
import type { SessionRepository } from "#sessions/state/sessionRepository";

export class StoreBackedPersistenceController {
  private readonly persistence: DeskCuePersistence;
  private readonly stateStorage: DaemonStateStorage;

  constructor(
    private readonly repository: SessionRepository,
    stateStorage: DaemonStateStorage = new DeskCueSqliteStateStorage()
  ) {
    this.stateStorage = stateStorage;
    this.persistence = new DeskCuePersistence({
      listDirtyPersistedSessions: () =>
        this.repository.listSessionPersistenceSnapshots({ dirtyOnly: true }),
      listDirtyWorkspaces: () =>
        this.repository.listWorkspacePersistenceSnapshots({ dirtyOnly: true }),
      listPartialSessionIds: () => this.repository.listPartialSessionIds(),
      listPersistedSessions: () =>
        this.repository.listSessionPersistenceSnapshots({ dirtyOnly: false }),
      listWorkspaces: () =>
        this.repository.listWorkspacePersistenceSnapshots({ dirtyOnly: false }),
      markPersisted: (workspaces, sessions) =>
        this.repository.markPersistenceSnapshotsPersisted(workspaces, sessions),
      stateStorage
    });
  }

  materializeSession(sessionId: string) {
    const current = this.repository.getSession(sessionId);

    if (!current || !this.repository.isPartialSession(sessionId)) return current;

    const materialized = this.stateStorage.loadSession?.(sessionId) ?? null;

    if (!materialized || materialized.id !== sessionId) {
      this.repository.removeSessionIfCurrent(sessionId, current);

      const replacement = this.repository.getSession(sessionId);

      return replacement && !this.repository.isPartialSession(sessionId) ? replacement : null;
    }

    if (!this.repository.materializePartialSessionIfCurrent(sessionId, current, materialized)) {
      const replacement = this.repository.getSession(sessionId);

      return replacement && !this.repository.isPartialSession(sessionId) ? replacement : null;
    }

    return materialized;
  }

  async hydrate() {
    const state = await this.persistence.load();

    for (const workspace of state.workspaces) {
      this.repository.setWorkspace(workspace);
    }

    const hydratedState = hydratePersistedSessions(state.sessions);

    for (const session of hydratedState.sessions) {
      this.repository.setSession(session, {
        partial: state.partialSessionIds?.includes(session.id) === true
      });
    }

    this.repository.markAllPersisted();

    logger.info("Daemon state restored", {
      workspaces: this.repository.workspaceCount,
      sessions: this.repository.sessionCount,
      restoredCodexAttachedSessions: hydratedState.restoredCodexAttachedSessions,
      revivedRunningSessions: hydratedState.revivedRunningSessions,
      normalizedDetachedSessions: hydratedState.normalizedDetachedSessions,
      prunedPersistedSessions: hydratedState.prunedPersistedSessions
    });

    if (
      hydratedState.revivedRunningSessions > 0 ||
      hydratedState.restoredCodexAttachedSessions > 0 ||
      hydratedState.normalizedDetachedSessions > 0 ||
      hydratedState.prunedPersistedSessions > 0
    ) {
      await this.persistFull();
    }
  }

  async persistNow() {
    await this.persistence.persistNow();
  }

  async persistFull() {
    await this.persistence.persistNow({
      full: true
    });
  }

  schedulePersist() {
    this.persistence.schedulePersist();
  }

  close() {
    return this.persistence.close();
  }
}
