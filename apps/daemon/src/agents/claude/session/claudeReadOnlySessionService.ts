import { performance } from "node:perf_hooks";

import type {
  AgentSessionSummary,
  GitSnapshot,
  ServerEvent,
  SessionDetail,
  SessionLogLine,
  SessionSummary,
  WorkspaceSummary
} from "@deskcue/protocol";
import { AppError } from "#application/errors";
import { buildGitIdentitySnapshot } from "#infrastructure/git";
import { logger } from "#infrastructure/logging/logger";

import { buildReadOnlyClaudeSessionShell } from "./claudeReadOnlySession.ts";

type ReadOnlyClaudeSessionCallbacks = {
  appendLog: (sessionId: string, stream: SessionLogLine["stream"], text: string) => void;
  claimAttachedSession: (session: SessionDetail) => SessionDetail | null;
  createWorkspace: (workspacePath: string) => Promise<WorkspaceSummary>;
  emitServerEvent: (event: ServerEvent) => void;
  findAttachedSession: (sourceSessionId: string) => SessionDetail | undefined;
  getPublicSession: (sessionId: string) => SessionDetail | null;
  isSessionCurrent: (sessionId: string, expected: SessionDetail) => boolean;
  persistState: () => Promise<void>;
  restoreSessionIfCurrent: (
    sessionId: string,
    expected: SessionDetail,
    replacement: SessionDetail
  ) => boolean;
  removeSessionIfCurrent: (sessionId: string, expected: SessionDetail) => boolean;
  runAttachedSessionCreation: (
    sourceSessionId: string,
    operation: () => Promise<SessionDetail>
  ) => Promise<SessionDetail>;
  setSession: (session: SessionDetail) => void;
  syncWorkspaceFromGit: (workspaceId: string, git: GitSnapshot) => void;
  toSummary: (session: SessionDetail) => SessionSummary;
};

function reconcileClaudeOwnershipCommand(session: SessionDetail, observeOnly: boolean) {
  const hadOwnershipMarker = / \((?:observe-only|read-only)\)$/.test(session.command);
  const commandWithoutOwnership = session.command.replace(/ \((?:observe-only|read-only)\)$/, "");

  if (observeOnly) return `${commandWithoutOwnership} (observe-only)`;
  if (session.status === "read_only" || hadOwnershipMarker) return `${commandWithoutOwnership} (read-only)`;

  return commandWithoutOwnership;
}

async function reconcileExistingClaudeSessionOwnership(
  callbacks: ReadOnlyClaudeSessionCallbacks,
  session: SessionDetail,
  options: { observeOnly?: boolean; reason: string }
) {
  const observeOnly = options.observeOnly === true;
  const wasObserveOnly = session.command.endsWith(" (observe-only)");
  const command = reconcileClaudeOwnershipCommand(session, observeOnly);
  const inputBlockedReason = observeOnly
    ? options.reason
    : wasObserveOnly
      ? null
      : session.inputBlockedReason;

  if (command === session.command && inputBlockedReason === session.inputBlockedReason) {
    return callbacks.getPublicSession(session.id)!;
  }

  const updatedSession = {
    ...session,
    command,
    inputBlockedReason
  };

  callbacks.setSession(updatedSession);

  try {
    await callbacks.persistState();
  } catch (error) {
    callbacks.restoreSessionIfCurrent(session.id, updatedSession, session);
    throw error;
  }

  if (callbacks.isSessionCurrent(session.id, updatedSession)) {
    callbacks.emitServerEvent({
      type: "session.updated",
      payload: callbacks.toSummary(updatedSession)
    });
  }

  return callbacks.getPublicSession(session.id)!;
}

function reuseExistingClaudeSession(
  callbacks: ReadOnlyClaudeSessionCallbacks,
  session: SessionDetail,
  options: { observeOnly?: boolean; reason: string }
) {
  if (session.status === "running") return callbacks.getPublicSession(session.id)!;

  return reconcileExistingClaudeSessionOwnership(callbacks, session, options);
}

async function createReadOnlyClaudeSessionOperation(
  callbacks: ReadOnlyClaudeSessionCallbacks,
  agentSession: AgentSessionSummary,
  options: { observeOnly?: boolean; reason: string }
) {
  const startedAt = performance.now();
  const existing = callbacks.findAttachedSession(agentSession.sourceSessionId);

  if (existing) return reuseExistingClaudeSession(callbacks, existing, options);

  if (!agentSession.workspacePath) {
    throw new AppError("invalid_input", "Claude Code session is missing workspace metadata.");
  }

  const workspace = await callbacks.createWorkspace(agentSession.workspacePath);
  const git = await buildGitIdentitySnapshot(workspace.path);

  const session = buildReadOnlyClaudeSessionShell({
    agentSession,
    git,
    observeOnly: options.observeOnly,
    workspace
  });

  const claimedBy = callbacks.claimAttachedSession(session);

  if (claimedBy) return reuseExistingClaudeSession(callbacks, claimedBy, options);

  callbacks.syncWorkspaceFromGit(workspace.id, git);

  try {
    await callbacks.persistState();
  } catch (error) {
    callbacks.removeSessionIfCurrent(session.id, session);
    throw error;
  }

  if (!callbacks.isSessionCurrent(session.id, session)) return callbacks.getPublicSession(session.id)!;

  callbacks.emitServerEvent({
    type: "session.created",
    payload: callbacks.toSummary(session)
  });

  callbacks.appendLog(session.id, "system", `Opened Claude Code chat without an interactive terminal. ${options.reason}\n`);

  logger.info("Read-only Claude session shell created", {
    sessionId: session.id,
    sourceSessionId: agentSession.sourceSessionId,
    observeOnly: options.observeOnly ?? false,
    totalDurationMs: Math.round(performance.now() - startedAt)
  });

  return callbacks.getPublicSession(session.id)!;
}

export async function createReadOnlyClaudeSession(
  callbacks: ReadOnlyClaudeSessionCallbacks,
  agentSession: AgentSessionSummary,
  options: { observeOnly?: boolean; reason: string }
) {
  const session = await callbacks.runAttachedSessionCreation(
    agentSession.sourceSessionId,
    () => createReadOnlyClaudeSessionOperation(callbacks, agentSession, options)
  );

  return reuseExistingClaudeSession(callbacks, session, options);
}
