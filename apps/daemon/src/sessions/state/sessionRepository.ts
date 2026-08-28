import type { GitSnapshot, SessionDetail, WorkspaceSummary } from "@deskcue/protocol";
import { normalizeSessionLogs } from "#sessions/logs/sessionLogs";

function toPersistedSession(session: SessionDetail) {
  const persistedSession = structuredClone(session);

  persistedSession.logs = normalizeSessionLogs(persistedSession.logs).logs;

  return persistedSession;
}

export class SessionRepository {
  private readonly workspaces = new Map<string, WorkspaceSummary>();
  private readonly sessions = new Map<string, SessionDetail>();
  private readonly workspacePersistenceRevisions = new Map<string, number>();
  private readonly sessionPersistenceRevisions = new Map<string, number>();
  private readonly dirtyWorkspaceIds = new Set<string>();
  private readonly dirtySessionIds = new Set<string>();
  private readonly partialSessionIds = new Set<string>();
  private readonly attachedSessionCreations = new Map<string, Promise<SessionDetail>>();
  private nextPersistenceRevision = 0;

  get workspaceCount() {
    return this.workspaces.size;
  }

  get sessionCount() {
    return this.sessions.size;
  }

  listWorkspaces() {
    return Array.from(this.workspaces.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }

  listSessionDetails() {
    return Array.from(this.sessions.values()).sort((a, b) =>
      b.startedAt.localeCompare(a.startedAt)
    );
  }

  listPersistedSessions() {
    return this.listSessionDetails().map((session) => {
      return toPersistedSession(session);
    });
  }

  listWorkspacePersistenceSnapshots(options: { dirtyOnly: boolean }) {
    const workspaceIds = options.dirtyOnly
      ? Array.from(this.dirtyWorkspaceIds)
      : Array.from(this.workspaces.keys());

    return workspaceIds
      .flatMap((workspaceId) => {
        const state = this.workspaces.get(workspaceId);
        const revision = this.workspacePersistenceRevisions.get(workspaceId);

        return state && revision !== undefined ? [{ revision, state }] : [];
      })
      .sort((a, b) => b.state.createdAt.localeCompare(a.state.createdAt));
  }

  listSessionPersistenceSnapshots(options: { dirtyOnly: boolean }) {
    const sessionIds = options.dirtyOnly
      ? Array.from(this.dirtySessionIds)
      : Array.from(this.sessions.keys());

    return sessionIds
      .flatMap((sessionId) => {
        if (options.dirtyOnly && this.partialSessionIds.has(sessionId)) return [];

        const session = this.sessions.get(sessionId);
        const revision = this.sessionPersistenceRevisions.get(sessionId);

        return session && revision !== undefined
          ? [{ revision, state: toPersistedSession(session) }]
          : [];
      })
      .sort((a, b) => b.state.startedAt.localeCompare(a.state.startedAt));
  }

  listPartialSessionIds() {
    return Array.from(this.partialSessionIds);
  }

  listDirtyWorkspaces() {
    return Array.from(this.dirtyWorkspaceIds)
      .flatMap((workspaceId) => {
        const workspace = this.workspaces.get(workspaceId);

        return workspace ? [workspace] : [];
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  listDirtyPersistedSessions() {
    return Array.from(this.dirtySessionIds)
      .flatMap((sessionId) => {
        if (this.partialSessionIds.has(sessionId)) return [];

        const session = this.sessions.get(sessionId);

        return session ? [toPersistedSession(session)] : [];
      })
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  markPersistenceSnapshotsPersisted(
    workspaces: Array<{ revision: number; state: WorkspaceSummary }>,
    sessions: Array<{ revision: number; state: SessionDetail }>
  ) {
    for (const { revision, state } of workspaces) {
      if (this.workspacePersistenceRevisions.get(state.id) === revision) this.dirtyWorkspaceIds.delete(state.id);
    }

    for (const { revision, state } of sessions) {
      if (this.sessionPersistenceRevisions.get(state.id) === revision) this.dirtySessionIds.delete(state.id);
    }
  }

  markAllPersisted() {
    this.dirtyWorkspaceIds.clear();
    this.dirtySessionIds.clear();
  }

  getWorkspace(id: string) {
    return this.workspaces.get(id) ?? null;
  }

  setWorkspace(workspace: WorkspaceSummary) {
    this.workspaces.set(workspace.id, workspace);
    this.workspacePersistenceRevisions.set(workspace.id, this.allocatePersistenceRevision());
    this.dirtyWorkspaceIds.add(workspace.id);
  }

  rollbackWorkspace(workspaceId: string) {
    this.workspaces.delete(workspaceId);
    this.workspacePersistenceRevisions.delete(workspaceId);
    this.dirtyWorkspaceIds.delete(workspaceId);
  }

  findWorkspaceByPath(workspacePath: string) {
    const normalizedPath = workspacePath.toLowerCase();

    return this.listWorkspaces().find(
      (workspace) => workspace.path.toLowerCase() === normalizedPath
    ) ?? null;
  }

  getSession(id: string) {
    return this.sessions.get(id) ?? null;
  }

  isPartialSession(sessionId: string) {
    return this.partialSessionIds.has(sessionId);
  }

  setSession(session: SessionDetail, options: { partial?: boolean } = {}) {
    this.sessions.set(session.id, session);
    this.sessionPersistenceRevisions.set(session.id, this.allocatePersistenceRevision());
    if (options.partial) {
      this.partialSessionIds.add(session.id);
    } else {
      this.partialSessionIds.delete(session.id);
      this.dirtySessionIds.add(session.id);
    }
  }

  replaceSessionIfCurrent(
    sessionId: string,
    expected: SessionDetail,
    replacement: SessionDetail
  ) {
    if (this.sessions.get(sessionId) !== expected) return false;

    this.setSession(replacement, {
      partial: this.partialSessionIds.has(sessionId)
    });
    return true;
  }

  materializePartialSessionIfCurrent(
    sessionId: string,
    expected: SessionDetail,
    materialized: SessionDetail
  ) {
    if (
      materialized.id !== sessionId ||
      this.sessions.get(sessionId) !== expected ||
      !this.partialSessionIds.has(sessionId)
    ) {
      return false;
    }

    this.sessions.set(sessionId, materialized);
    this.sessionPersistenceRevisions.set(sessionId, this.allocatePersistenceRevision());
    this.partialSessionIds.delete(sessionId);
    this.dirtySessionIds.delete(sessionId);
    return true;
  }

  isSessionCurrent(sessionId: string, expected: SessionDetail) {
    return this.sessions.get(sessionId) === expected;
  }

  removeSessionIfCurrent(sessionId: string, expected: SessionDetail) {
    if (this.sessions.get(sessionId) !== expected) return false;

    this.sessions.delete(sessionId);
    this.sessionPersistenceRevisions.delete(sessionId);
    this.dirtySessionIds.delete(sessionId);
    this.partialSessionIds.delete(sessionId);
    return true;
  }

  updateSession(sessionId: string, patch: Partial<SessionDetail>) {
    const current = this.sessions.get(sessionId);

    if (!current) return null;

    const next: SessionDetail = {
      ...current,
      ...patch,
      lastActivityAt: new Date().toISOString()
    };

    this.sessions.set(sessionId, next);
    this.sessionPersistenceRevisions.set(sessionId, this.allocatePersistenceRevision());
    if (!this.partialSessionIds.has(sessionId)) this.dirtySessionIds.add(sessionId);

    return next;
  }

  syncWorkspaceFromGit(workspaceId: string, git: GitSnapshot) {
    const workspace = this.workspaces.get(workspaceId);

    if (!workspace) return;

    this.workspaces.set(workspaceId, {
      ...workspace,
      isGitRepo: git.isGitRepo,
      branch: git.branch
    });

    this.workspacePersistenceRevisions.set(workspaceId, this.allocatePersistenceRevision());
    this.dirtyWorkspaceIds.add(workspaceId);
  }

  private allocatePersistenceRevision() {
    this.nextPersistenceRevision += 1;

    return this.nextPersistenceRevision;
  }

  findReusableAttachedSession(sourceSessionId: string, adapterId?: string) {
    return this.listSessionDetails().find(
      (session) =>
        session.sourceSessionId === sourceSessionId &&
        (!adapterId || session.adapterId === adapterId) &&
        session.status === "running"
    ) ?? null;
  }

  findAttachedSession(sourceSessionId: string, adapterId: string) {
    return this.listSessionDetails().find(
      (session) =>
        session.sourceSessionId === sourceSessionId &&
        session.adapterId === adapterId
    ) ?? null;
  }

  claimAttachedSession(session: SessionDetail) {
    if (!session.sourceSessionId) return null;

    const existing = this.findAttachedSession(session.sourceSessionId, session.adapterId);

    if (existing) return existing;

    this.setSession(session);
    return null;
  }

  private createAttachedSessionCreationCleanup(key: string, created: Promise<SessionDetail>) {
    return () => {
      if (this.attachedSessionCreations.get(key) === created) this.attachedSessionCreations.delete(key);
    };
  }

  runAttachedSessionCreation(
    adapterId: string,
    sourceSessionId: string,
    operation: () => Promise<SessionDetail>
  ) {
    const key = `${adapterId}\0${sourceSessionId}`;
    const pending = this.attachedSessionCreations.get(key);

    if (pending) return pending;

    const created = Promise.resolve().then(operation);
    const clearPending = this.createAttachedSessionCreationCleanup(key, created);

    this.attachedSessionCreations.set(key, created);
    created.then(clearPending, clearPending);
    return created;
  }

  findReadOnlyAttachedSession(sourceSessionId: string, adapterId?: string) {
    return this.listSessionDetails()
      .filter(
        (session) =>
          session.sourceSessionId === sourceSessionId &&
          (!adapterId || session.adapterId === adapterId) &&
          (
            session.status === "read_only" ||
            session.command.endsWith(" (read-only)") ||
            (session.adapterId === "claude-code" && session.status === "failed")
          )
      )[0] ?? null;
  }
}
