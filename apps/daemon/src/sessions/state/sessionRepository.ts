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
  private readonly dirtyWorkspaceIds = new Set<string>();
  private readonly dirtySessionIds = new Set<string>();
  private readonly partialSessionIds = new Set<string>();

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
        if (this.partialSessionIds.has(sessionId)) {
          return [];
        }

        const session = this.sessions.get(sessionId);

        return session ? [toPersistedSession(session)] : [];
      })
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  markPersisted(workspaceIds: string[], sessionIds: string[]) {
    for (const workspaceId of workspaceIds) {
      this.dirtyWorkspaceIds.delete(workspaceId);
    }

    for (const sessionId of sessionIds) {
      this.dirtySessionIds.delete(sessionId);
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
    this.dirtyWorkspaceIds.add(workspace.id);
  }

  rollbackWorkspace(workspaceId: string) {
    this.workspaces.delete(workspaceId);
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

  setSession(session: SessionDetail, options: { partial?: boolean } = {}) {
    this.sessions.set(session.id, session);
    if (options.partial) {
      this.partialSessionIds.add(session.id);
    } else {
      this.partialSessionIds.delete(session.id);
      this.dirtySessionIds.add(session.id);
    }
  }

  updateSession(sessionId: string, patch: Partial<SessionDetail>) {
    const current = this.sessions.get(sessionId);

    if (!current) {
      return null;
    }

    const next: SessionDetail = {
      ...current,
      ...patch,
      lastActivityAt: new Date().toISOString()
    };

    this.sessions.set(sessionId, next);
    if (!this.partialSessionIds.has(sessionId)) {
      this.dirtySessionIds.add(sessionId);
    }

    return next;
  }

  syncWorkspaceFromGit(workspaceId: string, git: GitSnapshot) {
    const workspace = this.workspaces.get(workspaceId);

    if (!workspace) {
      return;
    }

    this.workspaces.set(workspaceId, {
      ...workspace,
      isGitRepo: git.isGitRepo,
      branch: git.branch
    });

    this.dirtyWorkspaceIds.add(workspaceId);
  }

  findReusableAttachedSession(sourceSessionId: string) {
    return this.listSessionDetails().find(
      (session) => session.sourceSessionId === sourceSessionId && session.status === "running"
    ) ?? null;
  }

  findReadOnlyAttachedSession(sourceSessionId: string) {
    return this.listSessionDetails()
      .filter(
        (session) =>
          session.sourceSessionId === sourceSessionId &&
          (session.status === "read_only" || session.command.endsWith(" (read-only)"))
      )[0] ?? null;
  }
}
