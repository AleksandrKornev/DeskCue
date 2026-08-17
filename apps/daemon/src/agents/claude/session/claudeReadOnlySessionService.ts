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
  createWorkspace: (workspacePath: string) => Promise<WorkspaceSummary>;
  emitServerEvent: (event: ServerEvent) => void;
  findReadOnlyAttachedSession: (sourceSessionId: string) => SessionDetail | undefined;
  getPublicSession: (sessionId: string) => SessionDetail | null;
  persistState: () => Promise<void>;
  setSession: (session: SessionDetail) => void;
  syncWorkspaceFromGit: (workspaceId: string, git: GitSnapshot) => void;
  toSummary: (session: SessionDetail) => SessionSummary;
};

export async function createReadOnlyClaudeSession(
  callbacks: ReadOnlyClaudeSessionCallbacks,
  agentSession: AgentSessionSummary,
  options: { observeOnly?: boolean; reason: string }
) {
  const startedAt = performance.now();
  const existing = callbacks.findReadOnlyAttachedSession(agentSession.sourceSessionId);
  if (existing) {
    return callbacks.getPublicSession(existing.id)!;
  }

  if (!agentSession.workspacePath) {
    throw new AppError("invalid_input", "Claude Code session is missing workspace metadata.");
  }

  const workspace = await callbacks.createWorkspace(agentSession.workspacePath);
  const git = await buildGitIdentitySnapshot(workspace.path);
  callbacks.syncWorkspaceFromGit(workspace.id, git);

  const session = buildReadOnlyClaudeSessionShell({
    agentSession,
    git,
    observeOnly: options.observeOnly,
    workspace
  });
  callbacks.setSession(session);
  callbacks.appendLog(session.id, "system", `Opened Claude Code chat without an interactive terminal. ${options.reason}\n`);
  callbacks.emitServerEvent({
    type: "session.created",
    payload: callbacks.toSummary(session)
  });
  await callbacks.persistState();

  logger.info("Read-only Claude session shell created", {
    sessionId: session.id,
    sourceSessionId: agentSession.sourceSessionId,
    observeOnly: options.observeOnly ?? false,
    totalDurationMs: Math.round(performance.now() - startedAt)
  });

  return callbacks.getPublicSession(session.id)!;
}
