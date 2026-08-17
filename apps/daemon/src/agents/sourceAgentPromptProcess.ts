import type { SessionDetail, SessionStatus, WorkspaceSummary } from "@deskcue/protocol";
import {
  attachSessionDataHandler,
  attachSessionExitHandler
} from "#sessions/process/sessionLifecycle";
import type {
  RunningChild,
  SessionSpawnSpec
} from "#sessions/process/sessionProcess";

export type SourcePromptProcessCallbacks = {
  appendStdoutLog: (sessionId: string, text: string) => void;
  appendSystemLog: (sessionId: string, text: string, timestamp?: string) => void;
  finishSession: (sessionId: string, status: SessionStatus, exitCode: number | null) => void;
  getSession: (sessionId: string) => SessionDetail | null;
  isCurrentChild: (sessionId: string, child: RunningChild) => boolean;
  markPromptAccepted?: (sessionId: string) => void;
  markPromptDispatching?: (sessionId: string) => void;
  persistState: () => Promise<void>;
  spawnProcess: (input: {
    command: string;
    cwd: string;
    env: Record<string, string | undefined>;
    sessionId: string;
    spawnSpec?: SessionSpawnSpec;
  }) => RunningChild;
  startGitPolling: (sessionId: string, workspacePath: string) => void;
  stopGitPolling: (sessionId: string) => void;
  updateSession: (sessionId: string, patch: Partial<SessionDetail>) => void;
};

type SourcePromptProcessLifecycle = {
  beforeSessionCommit: (child: RunningChild) => Promise<void>;
  command: string;
  env: Record<string, string | undefined>;
  logStarted: (child: RunningChild) => void;
  prompt: string;
  requestedAt: string;
  session: SessionDetail;
  spawnSpec: SessionSpawnSpec;
  startedMessage: string;
  workspace: WorkspaceSummary;
};

export async function runSourcePromptProcessLifecycle(
  callbacks: SourcePromptProcessCallbacks,
  lifecycle: SourcePromptProcessLifecycle
): Promise<SessionDetail | null> {
  const { session, workspace } = lifecycle;
  callbacks.markPromptDispatching?.(session.id);
  const child = callbacks.spawnProcess({
    command: lifecycle.command,
    cwd: workspace.path,
    env: lifecycle.env,
    sessionId: session.id,
    spawnSpec: lifecycle.spawnSpec
  });
  callbacks.markPromptAccepted?.(session.id);

  attachSessionDataHandler({
    adapterId: session.adapterId,
    child,
    command: lifecycle.command,
    onAppendStdoutLog: callbacks.appendStdoutLog,
    onAppendSystemLog: callbacks.appendSystemLog,
    sessionId: session.id
  });
  callbacks.stopGitPolling(session.id);
  callbacks.startGitPolling(session.id, workspace.path);

  await lifecycle.beforeSessionCommit(child);
  callbacks.updateSession(session.id, {
    command: lifecycle.command,
    status: "running",
    finishedAt: null,
    exitCode: null,
    inputHistory: [...session.inputHistory, lifecycle.prompt],
    replyState: {
      phase: "sending",
      promptText: lifecycle.prompt,
      requestedAt: lifecycle.requestedAt
    },
    actionRequest: null
  });
  callbacks.appendSystemLog(session.id, "Input sent.\n", lifecycle.requestedAt);
  callbacks.appendSystemLog(session.id, lifecycle.startedMessage);
  await callbacks.persistState();

  // A short-lived source runtime can finish before its handlers are attached.
  // Register exit only after the session owns the child and is persisted.
  attachSessionExitHandler({
    child,
    getSession: callbacks.getSession,
    isCurrentChild: callbacks.isCurrentChild,
    onAppendSystemLog: callbacks.appendSystemLog,
    onFinishSession: callbacks.finishSession,
    sessionId: session.id
  });

  lifecycle.logStarted(child);
  return callbacks.getSession(session.id);
}
