import type { SessionActionRequest } from "@deskcue/protocol";
import type { SendInputOptions } from "@models/promptDelivery";
import type { UseDashboardCommandHandlersArgs } from "@modules/dashboard/model/commands/types";
import { wait } from "@modules/dashboard/model/timing";

function scheduleRecoveredPromptReconciliation({
  loadSession,
  normalizedInstruction,
  promptDelivery,
  selectedSessionId,
  setSelectedSession,
  isOperationCurrent
}: {
  loadSession: UseDashboardCommandHandlersArgs["loadSession"];
  normalizedInstruction: string;
  promptDelivery: UseDashboardCommandHandlersArgs["promptDelivery"];
  selectedSessionId: string;
  setSelectedSession: UseDashboardCommandHandlersArgs["setSelectedSession"];
  isOperationCurrent: () => boolean;
}) {
  for (const delayMs of [10_000, 25_000, 60_000]) {
    window.setTimeout(() => {
      if (!isOperationCurrent()) {
        return;
      }
      loadSession(selectedSessionId, {
        silent: true
      })
        .then((session) => {
          if (!isOperationCurrent() || !session || session.replyState.phase !== "idle") {
            return;
          }

          const promptWasSent = session.inputHistory.some(
            (input) => input.trim() === normalizedInstruction
          );
          if (!promptWasSent) {
            return;
          }

          setSelectedSession(session);
          promptDelivery.clearPromptDeliveryState();
          promptDelivery.setIsInterruptingPrompt(false);
        })
        .catch(() => {});
    }, delayMs);
  }
}

export async function recoverAcceptedPromptAfterFailedSend({
  loadSession,
  normalizedInstruction,
  options,
  promptDelivery,
  selectedSessionId,
  selectedSourceSessionId,
  setSelectedSession,
  isOperationCurrent
}: {
  loadSession: UseDashboardCommandHandlersArgs["loadSession"];
  normalizedInstruction: string;
  options?: SendInputOptions;
  promptDelivery: UseDashboardCommandHandlersArgs["promptDelivery"];
  selectedSessionId: string;
  selectedSourceSessionId: string | null;
  setSelectedSession: UseDashboardCommandHandlersArgs["setSelectedSession"];
  isOperationCurrent: () => boolean;
}) {
  if (options?.actionDecision || !isOperationCurrent()) {
    return false;
  }

  await wait(500);
  if (!isOperationCurrent()) {
    return false;
  }

  const recoveredSession = await loadSession(selectedSessionId, {
    silent: true
  }).catch(() => null);
  if (!recoveredSession || !isOperationCurrent()) {
    return false;
  }

  const replyState = recoveredSession.replyState;
  const promptWasAccepted =
    replyState.promptText?.trim() === normalizedInstruction &&
    (replyState.phase === "sending" || replyState.phase === "waiting");
  if (promptWasAccepted) {
    setSelectedSession(recoveredSession);
    if (!selectedSourceSessionId) {
      promptDelivery.clearPromptDeliveryState();
      promptDelivery.setIsInterruptingPrompt(false);
      return true;
    }
    promptDelivery.markPromptAccepted(normalizedInstruction, {
      sessionId: recoveredSession.id,
      sourceSessionId: recoveredSession.sourceSessionId ?? selectedSourceSessionId
    }, replyState.requestedAt ?? undefined);
    promptDelivery.setIsInterruptingPrompt(false);
    scheduleRecoveredPromptReconciliation({
      loadSession,
      normalizedInstruction,
      promptDelivery,
      selectedSessionId,
      setSelectedSession,
      isOperationCurrent
    });
    return true;
  }

  const promptIsInHistory = recoveredSession.inputHistory.some(
    (input) => input.trim() === normalizedInstruction
  );
  if (promptIsInHistory) {
    setSelectedSession(recoveredSession);
    promptDelivery.clearPromptDeliveryState();
    promptDelivery.setIsInterruptingPrompt(false);
    return true;
  }

  return false;
}

export async function recoverAppliedActionDecisionAfterFailedSend({
  actionRequest,
  isOperationCurrent,
  loadSession,
  promptDelivery,
  selectedSessionId,
  setSelectedSession
}: {
  actionRequest: SessionActionRequest | null | undefined;
  isOperationCurrent: () => boolean;
  loadSession: UseDashboardCommandHandlersArgs["loadSession"];
  promptDelivery: UseDashboardCommandHandlersArgs["promptDelivery"];
  selectedSessionId: string;
  setSelectedSession: UseDashboardCommandHandlersArgs["setSelectedSession"];
}) {
  if (!actionRequest || !isOperationCurrent()) {
    return false;
  }

  await wait(500);
  if (!isOperationCurrent()) {
    return false;
  }

  const recoveredSession = await loadSession(selectedSessionId, {
    silent: true
  }).catch(() => null);
  if (!recoveredSession || !isOperationCurrent()) {
    return false;
  }

  const pendingActionRequest = recoveredSession.actionRequest;
  const originalRequestIsStillPending =
    pendingActionRequest?.kind === actionRequest.kind &&
    pendingActionRequest.requestedAt === actionRequest.requestedAt;
  if (originalRequestIsStillPending) {
    return false;
  }

  setSelectedSession(recoveredSession);
  promptDelivery.clearPromptDeliveryState();
  promptDelivery.setIsInterruptingPrompt(false);
  return true;
}
