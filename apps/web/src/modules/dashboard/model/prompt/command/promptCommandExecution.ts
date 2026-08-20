import { agentSessionsApi } from "@api/endpoint/agentSessions/endpoints";
import { sessionsApi } from "@api/endpoint/sessions/endpoints";
import { isSessionCommandAccepted } from "@api/endpoint/sessions/types";
import {
  hasApiErrorPayload,
  readApiErrorMessage
} from "@api/transport/httpClient";
import {
  acquirePendingCloudCommand,
  clearPendingCloudCommand,
  clearPendingCloudCommandForResult,
  isAmbiguousCloudCommandOutcome
} from "@api/transport/pendingCommandJournal";
import { toMessage } from "@lib/format";
import type { SendInputOptions } from "@models/promptDelivery";
import {
  confirmAmbiguousActionDecisionResend,
  confirmAmbiguousPromptResend,
  withoutReplacementInterrupt
} from "@modules/dashboard/model/prompt/confirmations/promptCommandConfirmations";
import {
  recoverAcceptedPromptAfterFailedSend,
  recoverAppliedActionDecisionAfterFailedSend
} from "@modules/dashboard/model/prompt/promptRecovery";
import { mergeSessionUpdate } from "@modules/dashboard/model/prompt/sessionUpdate";
import type { UseDashboardPromptCommandHandlerArgs } from "@modules/dashboard/model/prompt/types";

export type PromptCommandTarget = {
  adapterId: string | null;
  canRestartDetachedCodexShell: boolean;
  sourceSessionId: string | null;
};

type PromptCommandExecutionArgs = Omit<
  UseDashboardPromptCommandHandlerArgs,
  | "overview"
  | "promptOperationRef"
  | "selectedAgentSessionId"
  | "selectedSessionIdRef"
> & {
  normalizedInstruction: string;
  operationIsCurrent: () => boolean;
  options?: SendInputOptions;
  retry: (instruction: string, options?: SendInputOptions) => Promise<string | false>;
  target: PromptCommandTarget;
};

type PromptCommandTargetArgs = Pick<
  UseDashboardPromptCommandHandlerArgs,
  "overview" | "selectedAgentSessionId" | "selectedSession" | "selectedSessionId"
>;

async function executeDetachedPromptCommand({
  loadAgentSessions,
  loadSession,
  normalizedInstruction,
  operationIsCurrent,
  options,
  promptDelivery,
  retry,
  selectedSession,
  setActiveTab,
  setError,
  setSelectedSession,
  setSelectedSessionId,
  setSelectedWorkspaceId,
  target
}: PromptCommandExecutionArgs) {
  if (!target.canRestartDetachedCodexShell || !target.sourceSessionId || !target.adapterId) {
    setError(
      selectedSession?.inputBlockedReason ?? "Prompt sending is blocked for this live session"
    );
    return false;
  }

  promptDelivery.beginPromptDelivery(normalizedInstruction, "starting", {
    sourceSessionId: target.sourceSessionId
  });

  const sourceAgentSessionId = `${target.adapterId}:${target.sourceSessionId}`;
  const command = acquirePendingCloudCommand(
    "source.attach",
    sourceAgentSessionId,
    normalizedInstruction
  );
  const result = await agentSessionsApi.attach(
    sourceAgentSessionId,
    normalizedInstruction,
    command.commandId
  );
  clearPendingCloudCommandForResult(command, result);
  if (!operationIsCurrent()) return false;

  if (!result.ok || hasApiErrorPayload(result.data)) {
    if (!options?.actionDecision && isAmbiguousCloudCommandOutcome(result.data)) {
      const confirmed = await confirmAmbiguousPromptResend();
      if (!operationIsCurrent()) return false;
      if (confirmed) {
        clearPendingCloudCommand(command);
        promptDelivery.clearPromptDeliveryState();
        return retry(normalizedInstruction, withoutReplacementInterrupt(options));
      }
    }
    promptDelivery.clearPromptDeliveryState();
    setError(readApiErrorMessage(result.data, "Failed to send input"));
    return false;
  }

  const attachedSession = isSessionCommandAccepted(result.data)
    ? await loadSession(result.data.sessionId, { sessionView: "chat" })
    : result.data;
  if (!operationIsCurrent()) return false;
  if (!attachedSession || hasApiErrorPayload(attachedSession)) {
    promptDelivery.clearPromptDeliveryState();
    setError("The prompt was accepted, but DeskCue could not load the updated session.");
    return false;
  }

  setSelectedWorkspaceId(attachedSession.workspaceId);
  setSelectedSessionId(attachedSession.id);
  setSelectedSession(attachedSession);
  setActiveTab("overview");
  promptDelivery.markPromptAccepted(normalizedInstruction, {
    sessionId: attachedSession.id,
    sourceSessionId: attachedSession.sourceSessionId ?? target.sourceSessionId
  });
  loadAgentSessions({ silent: true }).catch((caughtError) => {
    if (operationIsCurrent()) setError(toMessage(caughtError));
  });
  return attachedSession.id;
}

async function executeManagedPromptCommand({
  loadSession,
  normalizedInstruction,
  operationIsCurrent,
  options,
  promptDelivery,
  retry,
  selectedSession,
  selectedSessionId,
  selectedSessionRef,
  setActiveTab,
  setError,
  setSelectedSession,
  setSelectedSessionId,
  setSelectedWorkspaceId,
  target
}: PromptCommandExecutionArgs) {
  if (target.sourceSessionId && !options?.actionDecision) {
    promptDelivery.beginPromptDelivery(
      normalizedInstruction,
      selectedSession?.status === "running" ? "sending" : "starting",
      {
        sessionId: selectedSessionId,
        sourceSessionId: target.sourceSessionId
      }
    );
  }

  const command = acquirePendingCloudCommand(
    "managed.input",
    selectedSessionId,
    normalizedInstruction
  );
  const result = await sessionsApi.sendInput(selectedSessionId, normalizedInstruction, {
    commandId: command.commandId,
    compact: true
  });
  clearPendingCloudCommandForResult(command, result);
  if (!operationIsCurrent()) return false;

  if (!result.ok || hasApiErrorPayload(result.data)) {
    const acceptedAfterFailure = options?.actionDecision
      ? await recoverAppliedActionDecisionAfterFailedSend({
          actionRequest: selectedSession?.actionRequest,
          isOperationCurrent: operationIsCurrent,
          loadSession,
          promptDelivery,
          selectedSessionId,
          setSelectedSession
        })
      : await recoverAcceptedPromptAfterFailedSend({
          loadSession,
          normalizedInstruction,
          promptDelivery,
          selectedSessionId,
          selectedSourceSessionId: target.sourceSessionId,
          setSelectedSession,
          isOperationCurrent: operationIsCurrent,
          options
        });
    if (acceptedAfterFailure) {
      clearPendingCloudCommand(command);
      return selectedSessionId;
    }

    if (isAmbiguousCloudCommandOutcome(result.data)) {
      const confirmed = options?.actionDecision
        ? await confirmAmbiguousActionDecisionResend(options.actionDecision)
        : await confirmAmbiguousPromptResend();
      if (!operationIsCurrent()) return false;
      if (confirmed) {
        clearPendingCloudCommand(command);
        promptDelivery.clearPromptDeliveryState();
        promptDelivery.setIsInterruptingPrompt(false);
        return retry(normalizedInstruction, withoutReplacementInterrupt(options));
      }
    }

    promptDelivery.clearPromptDeliveryState();
    promptDelivery.setIsInterruptingPrompt(false);
    setError(readApiErrorMessage(result.data, "Failed to send input"));
    return false;
  }

  const updatedSession = isSessionCommandAccepted(result.data)
    ? await loadSession(result.data.sessionId, { sessionView: "chat" })
    : result.data;
  if (!operationIsCurrent()) return false;
  if (!updatedSession) {
    promptDelivery.clearPromptDeliveryState();
    promptDelivery.setIsInterruptingPrompt(false);
    setError("The prompt was accepted, but DeskCue could not load the updated session.");
    return false;
  }

  const nextSelectedSession = mergeSessionUpdate(selectedSessionRef.current, updatedSession);
  setSelectedSession(nextSelectedSession);
  if (updatedSession.id !== selectedSessionId) {
    setSelectedSessionId(updatedSession.id);
    setSelectedWorkspaceId(updatedSession.workspaceId);
    setActiveTab("overview");
  }
  if (target.sourceSessionId && !options?.actionDecision) {
    promptDelivery.markPromptAccepted(normalizedInstruction, {
      sessionId: updatedSession.id,
      sourceSessionId: updatedSession.sourceSessionId ?? target.sourceSessionId
    });
  }
  return updatedSession.id;
}

export function resolvePromptCommandTarget({
  overview,
  selectedAgentSessionId,
  selectedSession,
  selectedSessionId
}: PromptCommandTargetArgs): PromptCommandTarget {
  const selectedSessionSummary = overview.sessions.find(
    (session) => session.id === selectedSessionId
  );
  const separatorIndex = selectedAgentSessionId.indexOf(":");
  const agentAdapterId =
    separatorIndex > 0 ? selectedAgentSessionId.slice(0, separatorIndex) : null;
  const agentSourceSessionId =
    separatorIndex > 0
      ? selectedAgentSessionId.slice(separatorIndex + 1)
      : selectedAgentSessionId || null;
  const sourceSessionId =
    selectedSession?.sourceSessionId ??
    selectedSessionSummary?.sourceSessionId ??
    agentSourceSessionId;
  const adapterId =
    selectedSession?.adapterId ?? selectedSessionSummary?.adapterId ?? agentAdapterId;

  return {
    adapterId,
    canRestartDetachedCodexShell: adapterId === "codex" && Boolean(sourceSessionId),
    sourceSessionId
  };
}

export async function executePromptCommand(args: PromptCommandExecutionArgs) {
  return args.selectedSession?.canSendInput === false
    ? executeDetachedPromptCommand(args)
    : executeManagedPromptCommand(args);
}
