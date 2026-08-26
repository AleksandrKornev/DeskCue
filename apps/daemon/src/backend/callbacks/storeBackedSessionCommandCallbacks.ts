import type { SessionDetail, SessionLogLine } from "@deskcue/protocol";
import { logger } from "#infrastructure/logging/logger";

import {
  createSessionLookupCallbacksForBackend,
  createSessionRunnerCallbacksForBackend,
  createSessionStateCallbacksForBackend
} from "./storeBackedSessionCallbackGroups.ts";
import type { StoreBackedSessionCallbackContext } from "./storeBackedSessionCallbackTypes.ts";

export function createSessionPromptDeliveryCallbacks(
  context: StoreBackedSessionCallbackContext
) {
  return {
    ...createSessionLookupCallbacksForBackend(context),
    ...createSessionStateCallbacksForBackend(context),
    appendSystemLog: (sessionId: string, text: string) =>
      context.appendLog(sessionId, "system", text),
    resumeAgentSession: context.resumeAgentSession,
    resumeCodexSession: context.resumeCodexSession,
    sendSourceInput: context.sendSourceInput,
    supportsSourceInput: context.supportsSourceInput
  };
}

export function createSessionCommandCallbacks(context: StoreBackedSessionCallbackContext) {
  return {
    ...createSessionLookupCallbacksForBackend(context),
    ...createSessionRunnerCallbacksForBackend(context),
    ...createSessionStateCallbacksForBackend(context),
    appendSystemLog: (sessionId: string, text: string) =>
      context.appendLog(sessionId, "system", text),
    emitServerEvent: context.emitServerEvent,
    syncWorkspaceFromGit: context.syncWorkspaceFromGit,
    toSummary: context.toSummary
  };
}

export function createSessionReplyStateSyncCallbacks(
  context: StoreBackedSessionCallbackContext,
  options: {
    startQueuedPrompt: (session: SessionDetail) => Promise<SessionDetail>;
  }
) {
  return {
    appendLog: (
      sessionId: string,
      stream: SessionLogLine["stream"],
      text: string
    ) => context.appendLog(sessionId, stream, text),
    detachAttachedSession: context.detachAttachedSession,
    detachPromptTransport: (sessionId: string, reason: string) => {
      const child = context.sessionRunner.getChild(sessionId);

      void context.sessionRunner.killChild(sessionId, child, reason).catch((error) => {
        logger.error("Failed to terminate completed prompt transport", {
          message: error instanceof Error ? error.message : String(error),
          sessionId
        });
      });
      // The source transcript has already recorded the terminal assistant
      // response. Treat that as the authoritative completion signal even if a
      // Windows CLI hook keeps the child-process stream open after its parent
      // has exited.
      context.finishSession(sessionId, "done", 0);
    },
    emitServerEvent: context.emitServerEvent,
    getPublicSession: context.getSession,
    listSessions: () => context.repository.listSessionDetails(),
    persistState: context.persistState,
    startQueuedPrompt: options.startQueuedPrompt,
    toSummary: context.toSummary,
    updateSession: context.updateSession
  };
}

export function createSessionLogAppendCallbacks(context: StoreBackedSessionCallbackContext) {
  return {
    emitServerEvent: context.emitServerEvent,
    getSession: (sessionId: string) => context.repository.getSession(sessionId),
    schedulePersistState: context.schedulePersistState,
    toSummary: context.toSummary,
    updateSession: (sessionId: string, patch: Partial<SessionDetail>) => {
      context.updateSession(sessionId, patch);
    }
  };
}
