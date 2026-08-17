import type {
  ServerEvent,
  SessionDetail,
  SessionStatus,
  SessionSummary
} from "@deskcue/protocol";
import { logger } from "#infrastructure/logging/logger";
import { emptyReplyState } from "#sessions/model/sessionDefaults";
import type { RunningChild } from "#sessions/process/sessionProcess";

type SessionFinalizationCallbacks = {
  deleteChild: (sessionId: string) => void;
  emitServerEvent: (event: ServerEvent) => void;
  getChild: (sessionId: string) => RunningChild | undefined;
  getSession: (sessionId: string) => SessionDetail | null;
  killChild: (
    sessionId: string,
    child: RunningChild | undefined,
    reason: string
  ) => Promise<void>;
  onAppendSystemLog: (sessionId: string, text: string) => void;
  persistState: () => Promise<void>;
  stopGitPolling: (sessionId: string) => void;
  toSummary: (session: SessionDetail) => SessionSummary;
  updateSession: (sessionId: string, patch: Partial<SessionDetail>) => void;
};

function persistFinalizedState(
  callbacks: Pick<SessionFinalizationCallbacks, "persistState">,
  sessionId: string
) {
  void callbacks.persistState().catch((error) => {
    logger.error("Failed to persist finalized session", {
      message: error instanceof Error ? error.message : String(error),
      sessionId
    });
  });
}

export function finalizeSession(
  callbacks: SessionFinalizationCallbacks,
  sessionId: string,
  status: SessionStatus,
  exitCode: number | null
) {
  const currentSession = callbacks.getSession(sessionId);
  const keepClaudeReplyState =
    status === "read_only" &&
    currentSession?.adapterId === "claude-code" &&
    Boolean(currentSession.sourceSessionId) &&
    currentSession.replyState.phase === "sending";

  callbacks.stopGitPolling(sessionId);
  callbacks.deleteChild(sessionId);
  callbacks.updateSession(sessionId, {
    status,
    exitCode,
    finishedAt: new Date().toISOString(),
    replyState: keepClaudeReplyState
      ? {
          ...currentSession.replyState,
          phase: "waiting"
        }
      : emptyReplyState(),
    actionRequest: null
  });

  const session = callbacks.getSession(sessionId);
  if (session) {
    callbacks.emitServerEvent({
      type: "session.updated",
      payload: callbacks.toSummary(session)
    });
  }

  logger.info("Session finalized", {
    sessionId,
    status,
    exitCode
  });
  persistFinalizedState(callbacks, sessionId);
}

export async function detachAttachedSession(
  callbacks: SessionFinalizationCallbacks,
  sessionId: string,
  options: {
    reason: string;
  }
) {
  const session = callbacks.getSession(sessionId);
  if (!session || session.status !== "running") {
    return;
  }

  const child = callbacks.getChild(sessionId);
  await callbacks.killChild(sessionId, child, "detach");
  callbacks.stopGitPolling(sessionId);
  callbacks.deleteChild(sessionId);

  callbacks.onAppendSystemLog(sessionId, `${options.reason}\n`);
  callbacks.onAppendSystemLog(
    sessionId,
    "DeskCue detached from this managed session because the source chat is active elsewhere.\n"
  );
  callbacks.updateSession(sessionId, {
    status: "stopped",
    finishedAt: new Date().toISOString(),
    exitCode: null,
    replyState: emptyReplyState(),
    actionRequest: null
  });

  const updatedSession = callbacks.getSession(sessionId);
  if (updatedSession) {
    callbacks.emitServerEvent({
      type: "session.updated",
      payload: callbacks.toSummary(updatedSession)
    });
  }

  logger.warn("Detached stale attached session", {
    sessionId,
    sourceSessionId: session.sourceSessionId,
    adapterId: session.adapterId,
    reason: options.reason
  });

  await callbacks.persistState();
}
