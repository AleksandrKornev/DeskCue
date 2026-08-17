import type { SessionDetail } from "@deskcue/protocol";

import {
  createSessionLookupCallbacksForBackend,
  createSessionRunnerCallbacksForBackend,
  createSessionStateCallbacksForBackend
} from "./storeBackedSessionCallbackGroups.ts";
import type { StoreBackedSessionCallbackContext } from "./storeBackedSessionCallbackTypes.ts";

export function createSessionStartCallbacks(context: StoreBackedSessionCallbackContext) {
  return {
    getWorkspace: (workspaceId: string) => context.repository.getWorkspace(workspaceId),
    launchSession: context.launchSession
  };
}

export function createSessionAttachCallbacks(context: StoreBackedSessionCallbackContext) {
  return {
    ...createSessionLookupCallbacksForBackend(context),
    createReadOnlyClaudeSession: context.createReadOnlyClaudeSession,
    createReadOnlyCodexSession: context.createReadOnlyCodexSession,
    createWorkspace: context.createWorkspace,
    findReadOnlyAttachedSession: context.findReadOnlyAttachedSession,
    findReusableAttachedSession: context.findReusableAttachedSession,
    getSession: context.getSession,
    launchSession: context.launchSession,
    restartClaudePromptTransport: context.restartClaudePromptTransport,
    restartCodexTransport: context.restartCodexTransport,
    sendInput: context.sendInput
  };
}

export function createSessionLaunchCallbacks(context: StoreBackedSessionCallbackContext) {
  return {
    ...createSessionLookupCallbacksForBackend(context),
    ...createSessionRunnerCallbacksForBackend(context),
    ...createSessionStateCallbacksForBackend(context),
    appendLog: context.appendLog,
    emitServerEvent: context.emitServerEvent,
    finishSession: context.finishSession,
    scheduleDelayedAction: context.sessionRunner.scheduleDelayedAction.bind(
      context.sessionRunner
    ),
    sendSourceInput: context.sendSourceInput,
    setSession: (session: SessionDetail) => {
      context.repository.setSession(session);
    },
    startGitPolling: (sessionId: string, workspacePath: string) =>
      context.gitPolling.start(sessionId, workspacePath),
    supportsSourceInput: context.supportsSourceInput,
    syncWorkspaceFromGit: context.syncWorkspaceFromGit,
    toSummary: context.toSummary
  };
}

export function createSessionFinalizationCallbacks(
  context: StoreBackedSessionCallbackContext
) {
  return {
    ...createSessionLookupCallbacksForBackend(context),
    ...createSessionRunnerCallbacksForBackend(context),
    ...createSessionStateCallbacksForBackend(context),
    emitServerEvent: context.emitServerEvent,
    onAppendSystemLog: (sessionId: string, text: string) =>
      context.appendLog(sessionId, "system", text),
    stopGitPolling: (sessionId: string) => context.gitPolling.stop(sessionId),
    toSummary: context.toSummary
  };
}
