import { performance } from "node:perf_hooks";

import type {
  CodexSessionDetail,
  CodexSessionSummary,
  GitSnapshot,
  ServerEvent,
  SessionDetail,
  SessionLogLine,
  SessionSummary,
  WorkspaceSummary
} from "@deskcue/protocol";
import { buildGitIdentitySnapshot, buildGitSnapshot } from "#infrastructure/git";
import { logger } from "#infrastructure/logging/logger";

import { buildReadOnlyCodexSessionShell } from "./codexSessionShell.ts";

export type ReadOnlyCodexSessionCallbacks = {
  appendLog: (
    sessionId: string,
    stream: SessionLogLine["stream"],
    text: string
  ) => void;
  createWorkspace: (workspacePath: string) => Promise<WorkspaceSummary>;
  emitServerEvent: (event: ServerEvent) => void;
  findReadOnlyAttachedSession: (sourceSessionId: string) => SessionDetail | undefined;
  getPublicSession: (sessionId: string) => SessionDetail | null;
  persistState: () => Promise<void>;
  setSession: (session: SessionDetail) => void;
  syncWorkspaceFromGit: (workspaceId: string, git: GitSnapshot) => void;
  toSummary: (session: SessionDetail) => SessionSummary;
  updateSession: (sessionId: string, patch: Partial<SessionDetail>) => void;
};

function refreshReadOnlyCodexSessionGit(
  callbacks: ReadOnlyCodexSessionCallbacks,
  sessionId: string,
  workspace: WorkspaceSummary
) {
  buildGitSnapshot(workspace.path, {
    includeDiff: false
  })
    .then((git) => {
      if (!callbacks.getPublicSession(sessionId)) {
        return;
      }

      callbacks.updateSession(sessionId, {
        git
      });
      callbacks.syncWorkspaceFromGit(workspace.id, git);
      const updatedSession = callbacks.getPublicSession(sessionId);
      if (!updatedSession) {
        return;
      }

      callbacks.emitServerEvent({
        type: "session.git",
        payload: callbacks.toSummary(updatedSession)
      });
      callbacks.persistState().catch((error: unknown) => {
        logger.warn("Failed to persist read-only Codex git snapshot", {
          error
        });
      });
    })
    .catch((error: unknown) => {
      logger.warn("Failed to refresh read-only Codex git snapshot", {
        error,
        sessionId,
        workspaceId: workspace.id
      });
    });
}

function elapsedMs(startedAt: number) {
  return Math.round(performance.now() - startedAt);
}

export async function createReadOnlyCodexSession(
  callbacks: ReadOnlyCodexSessionCallbacks,
  codexSession: CodexSessionSummary | CodexSessionDetail,
  reason: string
): Promise<SessionDetail> {
  const startedAt = performance.now();
  const existing = callbacks.findReadOnlyAttachedSession(codexSession.id);
  if (existing) {
    logger.info("Read-only Codex session shell reused", {
      sessionId: existing.id,
      sourceSessionId: codexSession.id,
      totalDurationMs: elapsedMs(startedAt)
    });
    return callbacks.getPublicSession(existing.id)!;
  }

  const workspaceStartedAt = performance.now();
  const workspace = await callbacks.createWorkspace(codexSession.workspacePath);
  const workspaceDurationMs = elapsedMs(workspaceStartedAt);
  const gitStartedAt = performance.now();
  const git = await buildGitIdentitySnapshot(workspace.path);
  const gitIdentityDurationMs = elapsedMs(gitStartedAt);
  callbacks.syncWorkspaceFromGit(workspace.id, git);

  const session = buildReadOnlyCodexSessionShell({
    codexSession,
    git,
    workspace
  });

  callbacks.setSession(session);
  callbacks.appendLog(
    session.id,
    "system",
    `Opened read-only shared Codex chat. ${reason}\n`
  );
  logger.info("Read-only Codex session shell created", {
    sessionId: session.id,
    sourceSessionId: codexSession.id,
    workspaceId: workspace.id
  });
  callbacks.emitServerEvent({
    type: "session.created",
    payload: callbacks.toSummary(session)
  });
  const persistStartedAt = performance.now();
  await callbacks.persistState();
  const persistDurationMs = elapsedMs(persistStartedAt);
  logger.info("Read-only Codex session shell ready", {
    sessionId: session.id,
    sourceSessionId: codexSession.id,
    workspaceDurationMs,
    gitIdentityDurationMs,
    persistDurationMs,
    totalDurationMs: elapsedMs(startedAt)
  });
  refreshReadOnlyCodexSessionGit(callbacks, session.id, workspace);

  return callbacks.getPublicSession(session.id)!;
}
