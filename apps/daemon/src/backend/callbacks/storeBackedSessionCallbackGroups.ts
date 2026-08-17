import {
  createSessionLookupCallbacks,
  createSessionRunnerCallbacks,
  createSessionStateCallbacks
} from "#sessions/backend/sessionBackendCallbacks";
import type { RunningChild } from "#sessions/process/sessionProcess";

import type { StoreBackedSessionCallbackContext } from "./storeBackedSessionCallbackTypes.ts";

export function createSessionLookupCallbacksForBackend(
  context: StoreBackedSessionCallbackContext
) {
  return createSessionLookupCallbacks({
    getChild: (sessionId: string) => context.sessionRunner.getChild(sessionId),
    getPublicSession: context.getSession,
    getSession: (sessionId: string) => context.repository.getSession(sessionId),
    getWorkspace: (workspaceId: string) => context.repository.getWorkspace(workspaceId),
    isCurrentChild: (sessionId: string, child: RunningChild) =>
      context.sessionRunner.isCurrentChild(sessionId, child)
  });
}

export function createSessionRunnerCallbacksForBackend(
  context: StoreBackedSessionCallbackContext
) {
  return createSessionRunnerCallbacks({
    deleteChild: (sessionId: string) => context.sessionRunner.deleteChild(sessionId),
    killChild: (sessionId: string, child: RunningChild | undefined, reason: string) =>
      context.sessionRunner.killChild(sessionId, child, reason),
    spawnProcess: context.sessionRunner.spawnProcess.bind(context.sessionRunner)
  });
}

export function createSessionStateCallbacksForBackend(
  context: StoreBackedSessionCallbackContext
) {
  return createSessionStateCallbacks({
    persistState: context.persistState,
    updateSession: context.updateSession
  });
}
