import type { ServerEvent, SessionDetail, SessionSummary } from "@deskcue/protocol";
import { emptyReplyState } from "#sessions/model/sessionDefaults";
import type { SessionRunnerShutdownSurvivor } from "#sessions/process/sessionRunner";

type SessionShutdownRecoveryCallbacks = {
  appendSystemLog: (sessionId: string, text: string) => void;
  emitServerEvent: (event: ServerEvent) => void;
  getSession: (sessionId: string) => SessionDetail | null;
  markPromptOutcomeUnknown: (sessionId: string) => void;
  stopGitPolling: (sessionId: string) => void;
  toSummary: (session: SessionDetail) => SessionSummary;
  updateSession: (sessionId: string, patch: Partial<SessionDetail>) => void;
};

export function markSessionRecoveryRequiredAfterShutdown(
  callbacks: SessionShutdownRecoveryCallbacks,
  survivor: SessionRunnerShutdownSurvivor
) {
  const session = callbacks.getSession(survivor.sessionId);
  if (!session || session.status !== "running") return;

  callbacks.markPromptOutcomeUnknown(survivor.sessionId);
  callbacks.stopGitPolling(survivor.sessionId);
  callbacks.appendSystemLog(
    survivor.sessionId,
    "DeskCue could not confirm that the managed process exited during daemon shutdown. " +
      "The session was detached and requires recovery before it can be controlled again.\n"
  );
  callbacks.updateSession(survivor.sessionId, {
    actionRequest: null,
    exitCode: null,
    finishedAt: new Date().toISOString(),
    replyState: emptyReplyState(),
    status: "read_only"
  });
  const updatedSession = callbacks.getSession(survivor.sessionId);
  if (updatedSession) {
    callbacks.emitServerEvent({
      type: "session.updated",
      payload: callbacks.toSummary(updatedSession)
    });
  }
}
