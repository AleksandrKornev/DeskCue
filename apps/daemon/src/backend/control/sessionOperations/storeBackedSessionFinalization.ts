import type { SessionStatus } from "@deskcue/protocol";
import {
  CODEX_ACTIVE_WRITER_BLOCKED_REASON,
  hasCodexActiveWriterConflict
} from "#agents/codex/session/codexWriterConflict";
import type { SourceTurnInterruptLifecycle } from "#agents/sourceTurnInterruptLifecycle";
import { finalizeSession } from "#sessions/lifecycle/sessionFinalization";

import { createSessionFinalizationCallbacks } from "../../callbacks/storeBackedSessionCallbacks.ts";
import type { StoreBackedSessionCallbackContext } from "../../callbacks/storeBackedSessionCallbacks.ts";
import type { StoreBackedPromptTransportCoordinator } from "../storeBackedPromptTransportCoordinator.ts";

export function finishStoreBackedSession(
  context: StoreBackedSessionCallbackContext,
  promptTransport: StoreBackedPromptTransportCoordinator,
  sourceTurnInterrupts: SourceTurnInterruptLifecycle,
  sessionId: string,
  status: SessionStatus,
  exitCode: number | null
) {
  const session = context.repository.getSession(sessionId);
  const activeWriterConflict = Boolean(
    session &&
    status === "failed" &&
    hasCodexActiveWriterConflict(session, { requestedAt: session.replyState.requestedAt })
  );
  const finalStatus = activeWriterConflict ? "read_only" : status;
  const finalExitCode = activeWriterConflict || finalStatus === "stopped" ? null : exitCode;

  if (session && activeWriterConflict) {
    const promptText = session.replyState.promptText?.trim() ?? "";
    const requestedAt = session.replyState.requestedAt;

    context.appendLog(
      sessionId,
      "system",
      `${CODEX_ACTIVE_WRITER_BLOCKED_REASON} The prompt was not sent.\n`
    );

    context.updateSession(sessionId, {
      inputBlockedReason: CODEX_ACTIVE_WRITER_BLOCKED_REASON,
      promptRecovery: promptText && requestedAt
        ? {
            phase: "not_sent",
            promptText,
            requestedAt,
            retryable: true
          }
        : null
    });
  }

  if (session) sourceTurnInterrupts.confirmManagedTransportExit(session);

  promptTransport.recordSessionFinished(sessionId, session, finalStatus, finalExitCode);
  finalizeSession(
    createSessionFinalizationCallbacks(context),
    sessionId,
    finalStatus,
    finalExitCode
  );
}
