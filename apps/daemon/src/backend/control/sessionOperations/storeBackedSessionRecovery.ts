import type { ServerEvent, SessionDetail, SessionSummary } from "@deskcue/protocol";
import { markSessionRecoveryRequiredAfterShutdown } from "#sessions/lifecycle/sessionShutdownRecovery";
import { emptyReplyState } from "#sessions/model/sessionDefaults";
import type { SessionRunnerShutdownSurvivor } from "#sessions/process/sessionRunner";

type PromptRecoveryOperations = {
  getSession: (sessionId: string) => SessionDetail | null;
  persistState: () => Promise<void>;
  publishServerEvent: (event: ServerEvent) => void;
  toSummary: (session: SessionDetail) => SessionSummary;
  updateSession: (sessionId: string, patch: Partial<SessionDetail>) => void;
};

type ShutdownRecoveryOperations = {
  appendSystemLog: (sessionId: string, text: string) => void;
  emitServerEvent: (event: ServerEvent) => void;
  getSession: (sessionId: string) => SessionDetail | null;
  markPromptOutcomeUnknown: (sessionId: string) => void;
  stopGitPolling: (sessionId: string) => void;
  toSummary: (session: SessionDetail) => SessionSummary;
  updateSession: (sessionId: string, patch: Partial<SessionDetail>) => void;
};

export async function markStoreBackedPromptRecoveryOutcomeUnknown(
  operations: PromptRecoveryOperations,
  sessionId: string
): Promise<SessionDetail | null> {
  const session = operations.getSession(sessionId);
  if (!session?.promptRecovery || session.promptRecovery.phase !== "checking") return session;

  operations.updateSession(sessionId, {
    promptRecovery: {
      ...session.promptRecovery,
      phase: "outcome_unknown",
      retryable: false
    },
    replyState: emptyReplyState()
  });
  const updatedSession = operations.getSession(sessionId);
  if (!updatedSession) return updatedSession;

  operations.publishServerEvent({
    type: "session.updated",
    payload: operations.toSummary(updatedSession)
  });
  await operations.persistState();
  return updatedSession;
}

export function markStoreBackedSessionRecoveryRequiredAfterShutdown(
  operations: ShutdownRecoveryOperations,
  survivor: SessionRunnerShutdownSurvivor
): void {
  markSessionRecoveryRequiredAfterShutdown(operations, survivor);
}
