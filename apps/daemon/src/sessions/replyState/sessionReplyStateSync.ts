import type {
  AgentSessionDetail,
  AgentSessionSummary,
  ServerEvent,
  SessionDetail,
  SessionLogLine,
  SessionSummary
} from "@deskcue/protocol";
import {
  deriveReplyStateFromAgentSession,
  isManagedSessionOwnActiveTurn,
  isManagedSessionOwnCompletedTurn,
  isReplyStateEqual
} from "#agents/codex/session/codexReplyState";
import { logger } from "#infrastructure/logging/logger";

import { reconcileSessionPromptRecovery } from "./sessionPromptRecovery.ts";

export type SessionReplyStateSyncCallbacks = {
  appendLog: (sessionId: string, stream: SessionLogLine["stream"], text: string) => void;
  detachAttachedSession: (
    sessionId: string,
    options: { reason: string }
  ) => Promise<void>;
  detachPromptTransport: (sessionId: string, reason: string) => void;
  emitServerEvent: (event: ServerEvent) => void;
  getPublicSession: (sessionId: string) => SessionDetail | null;
  hasPromptTransport?: (sessionId: string) => boolean;
  listSessions: () => SessionDetail[];
  persistState: () => Promise<void>;
  startQueuedPrompt: (session: SessionDetail) => Promise<SessionDetail>;
  toSummary: (session: SessionDetail) => SessionSummary;
  updateSession: (sessionId: string, patch: Partial<SessionDetail>) => void;
};

function hasManagedPromptInFlight(session: Pick<SessionDetail, "replyState">) {
  return (
    (session.replyState.phase === "queued" ||
      session.replyState.phase === "sending" ||
      session.replyState.phase === "waiting") &&
    Boolean(session.replyState.promptText?.trim()) &&
    Boolean(session.replyState.requestedAt)
  );
}

function shouldDetachCompletedPromptTransport(
  session: Pick<SessionDetail, "replyState" | "sourceSessionId">,
  nextReplyState: SessionDetail["replyState"],
  agentSession: AgentSessionDetail,
  canObserveOwnedPrompt: boolean
) {
  return (
    canObserveOwnedPrompt &&
    Boolean(session.sourceSessionId) &&
    (session.replyState.phase === "sending" || session.replyState.phase === "waiting") &&
    Boolean(session.replyState.promptText?.trim()) &&
    nextReplyState.phase === "idle" &&
    isManagedSessionOwnCompletedTurn(session, agentSession)
  );
}

function hasManagedTakeoverHistory(session: Pick<SessionDetail, "inputHistory">) {
  return session.inputHistory.some((input) => input.trim());
}

function selectLatestActivityTimestamp(session: SessionDetail, agentSession: AgentSessionDetail) {
  return session.lastActivityAt > agentSession.updatedAt
    ? session.lastActivityAt
    : agentSession.updatedAt;
}

export function syncManagedSessionReplyState(
  callbacks: SessionReplyStateSyncCallbacks,
  agentSession: AgentSessionDetail
): SessionDetail | null {
  const session = callbacks.listSessions().find(
    (item) =>
      (item.status === "running" || item.status === "read_only" || Boolean(item.promptRecovery)) &&
      item.adapterId === agentSession.agentId &&
      item.sourceSessionId === agentSession.sourceSessionId
  );

  if (!session) return null;

  const promptRecovery = reconcileSessionPromptRecovery(session, agentSession);

  if (promptRecovery) {
    const lastActivityAt = selectLatestActivityTimestamp(session, agentSession);
    const recoveredStatus = promptRecovery.confirmed && (
      session.status === "stopped" || session.status === "failed"
    )
      ? "read_only" as const
      : session.status;
    const recoveredExitCode = promptRecovery.terminalOutcome === "completed" &&
      session.exitCode !== null && session.exitCode !== 0
      ? 0
      : session.exitCode;
    const recoveryChanged =
      session.promptRecovery?.phase !== promptRecovery.promptRecovery?.phase ||
      session.promptRecovery?.retryable !== promptRecovery.promptRecovery?.retryable ||
      session.promptRecovery?.observedPromptAt !== promptRecovery.promptRecovery?.observedPromptAt ||
      session.status !== recoveredStatus ||
      session.exitCode !== recoveredExitCode ||
      !isReplyStateEqual(session.replyState, promptRecovery.replyState);
    if (!recoveryChanged) return callbacks.getPublicSession(session.id);

    callbacks.updateSession(session.id, {
      lastActivityAt,
      exitCode: recoveredExitCode,
      promptRecovery: promptRecovery.promptRecovery,
      replyState: promptRecovery.replyState,
      status: recoveredStatus
    });
    const updatedSession = {
      ...session,
      lastActivityAt,
      exitCode: recoveredExitCode,
      promptRecovery: promptRecovery.promptRecovery,
      replyState: promptRecovery.replyState,
      status: recoveredStatus
    };

    callbacks.emitServerEvent({
      type: "session.updated",
      payload: callbacks.toSummary(updatedSession)
    });
    void callbacks.persistState().catch((error) => {
      logger.error("Failed to persist prompt recovery reconciliation", {
        message: error instanceof Error ? error.message : String(error),
        sessionId: session.id
      });
    });
    return callbacks.getPublicSession(session.id);
  }

  if (session.replyState.phase === "queued") {
    if (agentSession.attachMode === "resume") {
      void callbacks.startQueuedPrompt(session)
        .then((updatedSession) => {
          callbacks.emitServerEvent({
            type: "session.updated",
            payload: callbacks.toSummary(updatedSession)
          });
        })
        .catch(() => {});
    }

    return callbacks.getPublicSession(session.id);
  }

  if (
    agentSession.attachMode !== "resume" &&
    !hasManagedPromptInFlight(session) &&
    !hasManagedTakeoverHistory(session) &&
    !isManagedSessionOwnActiveTurn(session, agentSession)
  ) {
    void callbacks.detachAttachedSession(session.id, {
      reason:
        agentSession.attachModeReason ||
        `${agentSession.agentLabel} is no longer resumable from DeskCue.`
    }).catch((error) => {
      logger.error("Failed to detach stale managed session", {
        message: error instanceof Error ? error.message : String(error),
        sessionId: session.id
      });
    });
    return callbacks.getPublicSession(session.id);
  }

  const canObserveOwnedPrompt = callbacks.hasPromptTransport?.(session.id) === true;
  const nextReplyState = deriveReplyStateFromAgentSession(
    session,
    agentSession,
    canObserveOwnedPrompt
  );

  if (isReplyStateEqual(session.replyState, nextReplyState)) return callbacks.getPublicSession(session.id);

  if (shouldDetachCompletedPromptTransport(
    session,
    nextReplyState,
    agentSession,
    canObserveOwnedPrompt
  )) {
    callbacks.detachPromptTransport(session.id, "completed-prompt");
    return callbacks.getPublicSession(session.id);
  }

  callbacks.updateSession(session.id, {
    replyState: nextReplyState
  });
  callbacks.emitServerEvent({
    type: "session.updated",
    payload: callbacks.toSummary({
      ...session,
      replyState: nextReplyState
    })
  });
  void callbacks.persistState().catch((error) => {
    logger.error("Failed to persist managed reply state", {
      message: error instanceof Error ? error.message : String(error),
      sessionId: session.id
    });
  });

  return callbacks.getPublicSession(session.id);
}

export function reconcileAttachedAgentSession<T extends AgentSessionSummary | AgentSessionDetail>(
  sessions: SessionDetail[],
  hasRunningChild: (sessionId: string) => boolean,
  agentSession: T
): T {
  if (agentSession.attachMode === "resume") return agentSession;

  // A verified external process stop is the control-plane acknowledgement for
  // this turn. Some runtimes do not flush a terminal transcript entry after
  // being terminated, so waiting for that entry would leave the next prompt
  // unnecessarily queued.
  if (agentSession.interruptLifecycle?.confirmation === "verified_process") {
    return {
      ...agentSession,
      attachMode: "resume",
      attachModeReason: null
    };
  }

  const runningAttachedSession = sessions.find(
    (session) =>
      session.status === "running" &&
      session.adapterId === agentSession.agentId &&
      session.sourceSessionId === agentSession.sourceSessionId &&
      hasRunningChild(session.id)
  );

  if (!runningAttachedSession) return agentSession;

  if (
    !("transcript" in agentSession) ||
    (!hasManagedTakeoverHistory(runningAttachedSession) &&
      !isManagedSessionOwnActiveTurn(runningAttachedSession, agentSession))
  ) {
    return agentSession;
  }

  if ("transcript" in agentSession) {
    return {
      ...agentSession,
      attachMode: "resume",
      attachModeReason: null,
      transcript: agentSession.transcript
    };
  }

  return {
    ...(agentSession as AgentSessionSummary),
    attachMode: "resume",
    attachModeReason: null
  } as T;
}
