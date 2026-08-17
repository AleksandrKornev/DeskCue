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
} from "./confirmations/promptCommandConfirmations";
import { beginPromptOperation, isPromptOperationCurrent } from "./promptOperation";
import {
  recoverAcceptedPromptAfterFailedSend,
  recoverAppliedActionDecisionAfterFailedSend
} from "./promptRecovery";
import { mergeSessionUpdate } from "./sessionUpdate";
import type { UseDashboardPromptCommandHandlerArgs } from "./types";

export function useDashboardPromptCommandHandler({
  overview,
  selectedAgentSessionId,
  selectedSessionId,
  selectedSession,
  selectedSessionIdRef,
  selectedSessionRef,
  promptOperationRef,
  promptDelivery,
  setSelectedWorkspaceId,
  setSelectedSessionId,
  setSelectedSession,
  setActiveTab,
  setError,
  loadAgentSessions,
  loadSession
}: UseDashboardPromptCommandHandlerArgs) {
  return async function handleSendInput(
    nextInstruction: string,
    options?: SendInputOptions
  ): Promise<string | false> {
    const normalizedInstruction = nextInstruction.trim();
    if (!selectedSessionId || !normalizedInstruction) return false;
    const operation = beginPromptOperation(promptOperationRef, selectedSessionId);
    const operationIsCurrent = () => isPromptOperationCurrent(
      promptOperationRef,
      selectedSessionIdRef,
      operation
    );

    setError("");

    const selectedSessionSummary = overview.sessions.find(
      (session) => session.id === selectedSessionId
    );

    const selectedAgentSessionSeparatorIndex = selectedAgentSessionId.indexOf(":");
    const selectedAgentAdapterId =
      selectedAgentSessionSeparatorIndex > 0
        ? selectedAgentSessionId.slice(0, selectedAgentSessionSeparatorIndex)
        : null;

    const selectedAgentSourceSessionId =
      selectedAgentSessionSeparatorIndex > 0
        ? selectedAgentSessionId.slice(selectedAgentSessionSeparatorIndex + 1)
        : selectedAgentSessionId || null;

    const selectedSourceSessionId =
      selectedSession?.sourceSessionId ??
      selectedSessionSummary?.sourceSessionId ??
      selectedAgentSourceSessionId;

    const selectedAdapterId =
      selectedSession?.adapterId ?? selectedSessionSummary?.adapterId ?? selectedAgentAdapterId;

    const canRestartDetachedCodexShell =
      selectedAdapterId === "codex" && Boolean(selectedSourceSessionId);

    if (selectedSession?.canSendInput === false) {
      if (!canRestartDetachedCodexShell || !selectedSourceSessionId || !selectedAdapterId) {
        setError(
          selectedSession.inputBlockedReason ?? "Prompt sending is blocked for this live session"
        );
        return false;
      }

      promptDelivery.beginPromptDelivery(normalizedInstruction, "starting", {
        sourceSessionId: selectedSourceSessionId
      });

      const sourceAgentSessionId = `${selectedAdapterId}:${selectedSourceSessionId}`;
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
            return handleSendInput(
              normalizedInstruction,
              withoutReplacementInterrupt(options)
            );
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
        sourceSessionId: attachedSession.sourceSessionId ?? selectedSourceSessionId
      });
      loadAgentSessions({ silent: true }).catch((caughtError) => {
        if (operationIsCurrent()) setError(toMessage(caughtError));
      });
      return attachedSession.id;
    }

    if (options?.replaceRunningPrompt) {
      const interrupted =
        await promptDelivery.interruptPromptBeforeSendingReplacement(selectedSessionId, operation);

      if (!interrupted || !operationIsCurrent()) return false;
    } else {
      promptDelivery.setIsInterruptingPrompt(false);
    }

    if (selectedSourceSessionId && !options?.actionDecision) {
      promptDelivery.beginPromptDelivery(
        normalizedInstruction,
        selectedSession?.status === "running" ? "sending" : "starting",
        {
          sessionId: selectedSessionId,
          sourceSessionId: selectedSourceSessionId
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
            selectedSourceSessionId,
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
          return handleSendInput(
            normalizedInstruction,
            withoutReplacementInterrupt(options)
          );
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
    if (selectedSourceSessionId && !options?.actionDecision) {
      promptDelivery.markPromptAccepted(normalizedInstruction, {
        sessionId: updatedSession.id,
        sourceSessionId: updatedSession.sourceSessionId ?? selectedSourceSessionId
      });
    }
    return updatedSession.id;
  };
}
