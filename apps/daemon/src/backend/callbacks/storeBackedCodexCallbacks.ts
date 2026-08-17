import type { SessionDetail, SessionLogLine } from "@deskcue/protocol";

import {
  createSessionLookupCallbacksForBackend,
  createSessionRunnerCallbacksForBackend,
  createSessionStateCallbacksForBackend
} from "./storeBackedSessionCallbackGroups.ts";
import type { StoreBackedSessionCallbackContext } from "./storeBackedSessionCallbackTypes.ts";

export function createReadOnlyCodexSessionCallbacks(
  context: StoreBackedSessionCallbackContext
) {
  return {
    appendLog: (
      sessionId: string,
      stream: SessionLogLine["stream"],
      text: string
    ) => context.appendLog(sessionId, stream, text),
    createWorkspace: context.createWorkspace,
    emitServerEvent: context.emitServerEvent,
    findReadOnlyAttachedSession: (sourceSessionId: string) =>
      context.findReadOnlyAttachedSession(sourceSessionId) ?? undefined,
    getPublicSession: context.getSession,
    persistState: context.persistState,
    setSession: (session: SessionDetail) => {
      context.repository.setSession(session);
    },
    syncWorkspaceFromGit: context.syncWorkspaceFromGit,
    toSummary: context.toSummary,
    updateSession: context.updateSession
  };
}

export function createCodexSessionCommandCallbacks(
  context: StoreBackedSessionCallbackContext
) {
  return {
    getChild: (sessionId: string) => context.sessionRunner.getChild(sessionId),
    getSession: (sessionId: string) => context.repository.getSession(sessionId),
    restartCodexTransport: context.restartCodexTransport
  };
}

export function createCodexPromptDeliveryCallbacks(
  context: StoreBackedSessionCallbackContext
) {
  return {
    ...createSessionLookupCallbacksForBackend(context),
    ...createSessionRunnerCallbacksForBackend(context),
    ...createSessionStateCallbacksForBackend(context),
    appendStdoutLog: (sessionId: string, text: string) =>
      context.appendLog(sessionId, "stdout", text),
    appendSystemLog: (sessionId: string, text: string, timestamp?: string) =>
      context.appendLog(sessionId, "system", text, timestamp),
    finishSession: context.finishSession,
    startGitPolling: (sessionId: string, workspacePath: string) =>
      context.gitPolling.start(sessionId, workspacePath),
    stopGitPolling: (sessionId: string) => context.gitPolling.stop(sessionId)
  };
}
