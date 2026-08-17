import { useCallback } from "react";
import { toast } from "sonner";

import { sessionsApi } from "@api/endpoint/sessions/endpoints";
import { isSessionCommandAccepted } from "@api/endpoint/sessions/types";
import type { SessionInterruptResponse } from "@api/endpoint/sessions/types";
import type { ApiErrorPayload } from "@api/transport/errors";
import {
  hasApiErrorPayload,
  isExternalDesktopInterruptFallback,
  isExternalDesktopInterruptUnavailable,
  readApiErrorMessage
} from "@api/transport/httpClient";
import {
  acquirePendingCloudCommand,
  clearPendingCloudCommand,
  clearPendingCloudCommandForResult
} from "@api/transport/pendingCommandJournal";
import { requestConfirmation } from "@components/ModalDialog";
import type { PendingChatPrompt } from "@models/promptDelivery";
import type { PromptOperationState } from "@modules/dashboard/model/commands/types";
import { wait } from "@modules/dashboard/model/timing";
import { getDeskCueRuntime } from "@runtime";

import { EXTERNAL_FORCE_STOP_CONFIRMATION_GRACE_MS } from "./constants";
import {
  getExternalCodexDesktopThreadUrl,
  shouldAwaitSourceInterruptConfirmation
} from "./helpers";
import { beginPromptOperation, isPromptOperationCurrent } from "./promptOperation";
import { mergeSessionUpdate } from "./sessionUpdate";
import type {
  PromptDeliveryTarget,
  PromptInterruptResult,
  UsePromptDeliveryControllerArgs
} from "./types";

export function usePromptDeliveryController({
  selectedSessionId,
  selectedSession,
  selectedSessionIdRef,
  selectedSessionRef,
  promptOperationRef,
  activeTakenOverAgentSession,
  pendingChatPrompt,
  setSelectedSession,
  setError,
  setPendingChatPrompt,
  setAwaitingChatReplySince,
  setIsWaitingForChatReply,
  setIsInterruptingPrompt,
  loadOverview,
  loadSession,
  refreshActiveTakenOverAgentSession
}: UsePromptDeliveryControllerArgs) {
  const clearPromptDeliveryState = useCallback(() => {
    setPendingChatPrompt(null);
    setAwaitingChatReplySince(null);
    setIsWaitingForChatReply(false);
  }, [setAwaitingChatReplySince, setIsWaitingForChatReply, setPendingChatPrompt]);

  const beginPromptDelivery = useCallback((
    text: string,
    status: PendingChatPrompt["status"] = "sending",
    target: PromptDeliveryTarget = {}
  ) => {
    const requestedAt = new Date().toISOString();
    setPendingChatPrompt({ text, requestedAt, status, ...target });
    setAwaitingChatReplySince(null);
    setIsWaitingForChatReply(false);
  }, [setAwaitingChatReplySince, setIsWaitingForChatReply, setPendingChatPrompt]);

  const markPromptAccepted = useCallback((
    text: string,
    target: PromptDeliveryTarget = {},
    requestedAt = new Date().toISOString()
  ) => {
    setPendingChatPrompt({
      text,
      requestedAt,
      status: "sending",
      ...target
    });
    setAwaitingChatReplySince(null);
    setIsWaitingForChatReply(false);
  }, [setAwaitingChatReplySince, setIsWaitingForChatReply, setPendingChatPrompt]);

  const interruptSessionPrompt = useCallback(async (
    sessionId: string,
    operation: PromptOperationState
  ): Promise<PromptInterruptResult | null> => {
    const operationIsCurrent = () => isPromptOperationCurrent(
      promptOperationRef,
      selectedSessionIdRef,
      operation
    );
    const isDeskCuePromptInFlight =
      pendingChatPrompt?.sessionId === sessionId ||
      (!pendingChatPrompt?.sessionId &&
        Boolean(pendingChatPrompt?.sourceSessionId) &&
        pendingChatPrompt?.sourceSessionId === selectedSession?.sourceSessionId);
    // Always give the DeskCue-owned transport the first chance to stop. Claude
    // can have a discoverable source process at the same time; treating that
    // process as external first turns an ordinary managed stop into a needless
    // destructive confirmation dialog.
    const command = acquirePendingCloudCommand("managed.interrupt", sessionId);
    const managedResult = await sessionsApi.interrupt(sessionId, command.commandId);
    clearPendingCloudCommandForResult(command, managedResult);
    if (!operationIsCurrent()) {
      return null;
    }
    let managedData: Exclude<SessionInterruptResponse, { accepted: true }> | ApiErrorPayload;
    if (managedResult.ok && isSessionCommandAccepted(managedResult.data)) {
      clearPendingCloudCommand(command);
      const hydratedSession = await loadSession(managedResult.data.sessionId, {
        sessionView: "chat"
      });
      if (!operationIsCurrent()) return null;
      if (!hydratedSession) {
        setError("The stop request was accepted, but DeskCue could not load the updated session.");
        return null;
      }
      managedData = hydratedSession;
    } else {
      if (isSessionCommandAccepted(managedResult.data)) {
        setError("DeskCue returned an invalid stop response.");
        return null;
      }
      managedData = managedResult.data;
    }
    const isDesktopFallback =
      isExternalDesktopInterruptFallback(managedData) ||
      isExternalDesktopInterruptUnavailable(managedData);
    if (
      (managedResult.ok && !hasApiErrorPayload(managedData)) ||
      isDesktopFallback
    ) {
      clearPendingCloudCommand(command);
    }
    if (
      managedResult.ok &&
      !hasApiErrorPayload(managedData) &&
      !isExternalDesktopInterruptFallback(managedData)
    ) {
      return {
        externalStop: null,
        session: managedData
      };
    }

    if (!getDeskCueRuntime().features.externalHostProcessControls) {
      setError(
        "DeskCue Cloud could not stop this turn through the managed session. Stop it on the connected computer."
      );
      return null;
    }

    const codexDesktopThreadUrl = getExternalCodexDesktopThreadUrl(
      selectedSession,
      activeTakenOverAgentSession
    );
    if (isDesktopFallback) {
      if (!codexDesktopThreadUrl) {
        setError(readApiErrorMessage(managedData, "Failed to interrupt prompt"));
        return null;
      }

      const confirmed = await requestConfirmation({
        cancelLabel: "Cancel",
        confirmLabel: "Open chat on computer",
        description: "DeskCue could not stop this Codex Desktop turn directly. Open the exact chat on the DeskCue computer to stop it there.",
        title: "Stop in Codex Desktop"
      });
      if (!confirmed || !operationIsCurrent()) {
        return null;
      }

      const openResult = await sessionsApi.openExternalCodexDesktopChat(sessionId);
      if (!operationIsCurrent()) {
        return null;
      }
      if (!openResult.ok || hasApiErrorPayload(openResult.data)) {
        setError(readApiErrorMessage(openResult.data, "Failed to show the Codex Desktop chat."));
      } else {
        toast.success("Open request sent to the DeskCue computer.");
      }
      return null;
    }

    if (selectedSession?.adapterId === "claude-code") {
      try {
        const claudeCapability = await sessionsApi.getExternalClaudeBackgroundStopCapability(sessionId);
        if (!operationIsCurrent()) {
          return null;
        }
        if (claudeCapability?.kind === "available") {
          if (!isDeskCuePromptInFlight) {
            const confirmed = await requestConfirmation({
              confirmLabel: "Stop background job",
              description: `DeskCue will ask Claude Code to stop verified background job ${claudeCapability.jobId}.`,
              title: "Stop external Claude background job?",
              tone: "danger"
            });
            if (!confirmed || !operationIsCurrent()) {
              return null;
            }
          }

          const result = await sessionsApi.stopExternalClaudeBackground(sessionId);
          if (!operationIsCurrent()) {
            return null;
          }
          if (!result.ok || hasApiErrorPayload(result.data)) {
            setError(readApiErrorMessage(result.data, "Failed to stop Claude background job"));
            return null;
          }

          return {
            externalStop: "claude_background",
            session: result.data
          };
        }
      } catch {
        // A verified external process can still be force-stopped below.
      }
    }

    try {
      const processCapability = await sessionsApi.getExternalForceStopCapability(sessionId);
      if (!operationIsCurrent()) {
        return null;
      }
      if (processCapability?.kind === "available") {
        const agentLabel = selectedSession?.adapterId === "claude-code" ? "Claude Code" : "Codex";
        if (!isDeskCuePromptInFlight) {
          const confirmed = await requestConfirmation({
            confirmLabel: "Force stop process",
            description: `DeskCue will terminate external ${agentLabel} process ${processCapability.processId} and its child processes. Partial work may remain.`,
            title: `Force stop external ${agentLabel}?`,
            tone: "danger"
          });
          if (!confirmed || !operationIsCurrent()) {
            return null;
          }
        }

        const result = await sessionsApi.forceStopExternalProcess(sessionId, processCapability);
        if (!operationIsCurrent()) {
          return null;
        }
        if (!result.ok || hasApiErrorPayload(result.data)) {
          setError(readApiErrorMessage(result.data, "Failed to force stop external process"));
          return null;
        }

        return {
          externalStop: "agent_process",
          session: result.data
        };
      }
    } catch {
      // External process detection is advisory; managed interrupt remains available below.
    }

    setError(readApiErrorMessage(managedData, "Failed to interrupt prompt"));
    return null;
  }, [
    activeTakenOverAgentSession,
    loadSession,
    pendingChatPrompt,
    promptOperationRef,
    selectedSession,
    selectedSessionIdRef,
    setError
  ]);

  const interruptPromptBeforeSendingReplacement = useCallback(async (
    sessionId: string,
    operation: PromptOperationState
  ) => {
    const operationIsCurrent = () => isPromptOperationCurrent(
      promptOperationRef,
      selectedSessionIdRef,
      operation
    );
    setError("");
    setIsInterruptingPrompt(true);

    try {
      const result = await interruptSessionPrompt(sessionId, operation);
      if (!result || !operationIsCurrent()) {
        return false;
      }

      clearPromptDeliveryState();
      setSelectedSession(mergeSessionUpdate(selectedSessionRef.current, result.session));
      await refreshActiveTakenOverAgentSession();
      if (!operationIsCurrent()) {
        return false;
      }
      if (result.externalStop) {
        void wait(EXTERNAL_FORCE_STOP_CONFIRMATION_GRACE_MS)
          .then(() => {
            if (operationIsCurrent()) {
              return refreshActiveTakenOverAgentSession();
            }
          });
      }
      await Promise.all([
        loadSession(sessionId, {
          sessionView: "chat"
        }),
        loadOverview(),
        wait(450)
      ]);
      return operationIsCurrent();
    } finally {
      if (operationIsCurrent()) {
        setIsInterruptingPrompt(false);
      }
    }
  }, [
    clearPromptDeliveryState,
    loadOverview,
    loadSession,
    setError,
    setIsInterruptingPrompt,
    setSelectedSession,
    selectedSessionIdRef,
    selectedSessionRef,
    promptOperationRef,
    interruptSessionPrompt,
    refreshActiveTakenOverAgentSession
  ]);

  const handleInterruptPrompt = useCallback(async () => {
    if (!selectedSessionId) {
      return;
    }

    const canAttemptExternalStop =
      (selectedSession?.adapterId === "codex" || selectedSession?.adapterId === "claude-code") &&
      Boolean(selectedSession.sourceSessionId);
    if (selectedSession?.canSendInput === false && !canAttemptExternalStop) {
      setError(
        selectedSession.inputBlockedReason ?? "Prompt sending is blocked for this live session"
      );
      return;
    }

    setError("");
    setIsInterruptingPrompt(true);
    let shouldAwaitSourceConfirmation = false;
    const wasCancellingQueuedPrompt = selectedSession?.replyState.phase === "queued";
    const operation = beginPromptOperation(promptOperationRef, selectedSessionId);
    const operationIsCurrent = () => isPromptOperationCurrent(
      promptOperationRef,
      selectedSessionIdRef,
      operation
    );

    try {
      const result = await interruptSessionPrompt(selectedSessionId, operation);
      if (!result || !operationIsCurrent()) {
        return;
      }

      shouldAwaitSourceConfirmation = shouldAwaitSourceInterruptConfirmation(
        selectedSession?.sourceSessionId,
        result.session,
        { wasQueuedPrompt: wasCancellingQueuedPrompt }
      );

      clearPromptDeliveryState();
      setSelectedSession(mergeSessionUpdate(selectedSessionRef.current, result.session));
      await refreshActiveTakenOverAgentSession();
      if (!operationIsCurrent()) {
        return;
      }
      if (result.externalStop) {
        void wait(EXTERNAL_FORCE_STOP_CONFIRMATION_GRACE_MS)
          .then(() => {
            if (operationIsCurrent()) {
              return refreshActiveTakenOverAgentSession();
            }
          });
      }
      await Promise.all([
        loadSession(selectedSessionId, {
          sessionView: "chat"
        }),
        loadOverview(),
        wait(450)
      ]);
    } finally {
      if (!shouldAwaitSourceConfirmation && operationIsCurrent()) {
        setIsInterruptingPrompt(false);
      }
    }
  }, [
    selectedSession,
    selectedSessionId,
    selectedSessionIdRef,
    selectedSessionRef,
    promptOperationRef,
    clearPromptDeliveryState,
    loadOverview,
    loadSession,
    setError,
    setIsInterruptingPrompt,
    setSelectedSession,
    interruptSessionPrompt,
    refreshActiveTakenOverAgentSession
  ]);

  return {
    beginPromptDelivery,
    markPromptAccepted,
    clearPromptDeliveryState,
    interruptPromptBeforeSendingReplacement,
    handleInterruptPrompt,
    setIsInterruptingPrompt
  };
}
