import type {
  AgentSessionSummary,
  CodexSessionDetail,
  CodexSessionSummary,
  SessionDetail
} from "@deskcue/protocol";
import { createReadOnlyClaudeSession as createReadOnlyClaudeSessionShell } from "#agents/claude/session/claudeReadOnlySessionService";
import { createReadOnlyCodexSession as createReadOnlyCodexSessionShell } from "#agents/codex/session/codexReadOnlySession";

import { createReadOnlyCodexSessionCallbacks } from "../../callbacks/storeBackedSessionCallbacks.ts";
import type { StoreBackedSessionCallbackContext } from "../../callbacks/storeBackedSessionCallbacks.ts";

export function createStoreBackedReadOnlyCodexSession(
  callbackContext: StoreBackedSessionCallbackContext,
  codexSession: CodexSessionSummary | CodexSessionDetail,
  reason: string
): Promise<SessionDetail> {
  return createReadOnlyCodexSessionShell(
    createReadOnlyCodexSessionCallbacks(callbackContext),
    codexSession,
    reason
  );
}

export function createStoreBackedReadOnlyClaudeSession(
  callbackContext: StoreBackedSessionCallbackContext,
  agentSession: AgentSessionSummary,
  options: { observeOnly?: boolean; reason: string }
): Promise<SessionDetail> {
  return createReadOnlyClaudeSessionShell(
    {
      appendLog: callbackContext.appendLog,
      claimAttachedSession: (session) =>
        callbackContext.repository.claimAttachedSession(session),
      createWorkspace: callbackContext.createWorkspace,
      emitServerEvent: callbackContext.emitServerEvent,
      findAttachedSession: (sourceSessionId) =>
        callbackContext.repository.findAttachedSession(sourceSessionId, "claude-code") ?? undefined,
      getPublicSession: callbackContext.getSession,
      isSessionCurrent: (sessionId, expected) =>
        callbackContext.repository.isSessionCurrent(sessionId, expected),
      persistState: callbackContext.persistState,
      restoreSessionIfCurrent: (sessionId, expected, replacement) =>
        callbackContext.repository.replaceSessionIfCurrent(
          sessionId,
          expected,
          replacement
        ),
      removeSessionIfCurrent: (sessionId, expected) =>
        callbackContext.repository.removeSessionIfCurrent(sessionId, expected),
      runAttachedSessionCreation: (sourceSessionId, operation) =>
        callbackContext.repository.runAttachedSessionCreation(
          "claude-code",
          sourceSessionId,
          operation
        ),
      setSession: (session) => callbackContext.repository.setSession(session),
      syncWorkspaceFromGit: callbackContext.syncWorkspaceFromGit,
      toSummary: callbackContext.toSummary
    },
    agentSession,
    options
  );
}
