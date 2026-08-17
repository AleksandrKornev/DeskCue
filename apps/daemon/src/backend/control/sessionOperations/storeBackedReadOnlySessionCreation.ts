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
      createWorkspace: callbackContext.createWorkspace,
      emitServerEvent: callbackContext.emitServerEvent,
      findReadOnlyAttachedSession: (sourceSessionId) =>
        callbackContext.findReadOnlyAttachedSession(sourceSessionId) ?? undefined,
      getPublicSession: callbackContext.getSession,
      persistState: callbackContext.persistState,
      setSession: (session) => callbackContext.repository.setSession(session),
      syncWorkspaceFromGit: callbackContext.syncWorkspaceFromGit,
      toSummary: callbackContext.toSummary
    },
    agentSession,
    options
  );
}
