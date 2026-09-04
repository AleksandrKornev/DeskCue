import { useMemo } from "react";

import type {
  AgentSessionDetail,
  AgentSessionSummary,
  SessionDetail,
  SessionSummary
} from "@deskcue/protocol";
import type { PendingChatPrompt } from "@models/promptDelivery";
import {
  getSessionInterruptLifecycle,
  isInterruptLifecycleWaitingSuppressed
} from "@models/sessionInterruptLifecycle";
import { resolveLiveSourceState } from "@modules/session/model/liveChat/helpers";
import type { ChatTranscriptEntry } from "@modules/session/types";

import {
  hasAssistantReplyAfterPrompt,
  hasShellWaitingPromptCompleted,
  isConfirmedDeskCuePendingPrompt,
  isManagedSourceReplyWaiting,
  isManagedSourceSessionWorking,
  isSourceTurnOutsideDeskCue,
  resolveInputAvailability,
  resolveInputUnavailableLabel,
  resolvePendingChatPrompt,
  resolvePromptInFlight,
  resolveShellWaitingPrompt,
  shouldShowManagedSessionChatLoading
} from "./helpers";
import { useReplyCompletionBridge } from "./useReplyCompletionBridge";

export function useManagedSessionReplyState({
  canSendInputWhenReadOnly = false,
  chatTranscriptEntries,
  hasConversationContent,
  isInterruptingPrompt,
  isSessionShellLoading,
  isTranscriptLoading,
  isWaitingForChatReply,
  pendingChatPrompt,
  selectedSessionDetail,
  selectedSessionId,
  sessionShell,
  sourceSessionSummary,
  takenOverAgentSession
}: {
  canSendInputWhenReadOnly?: boolean;
  chatTranscriptEntries: ChatTranscriptEntry[];
  hasConversationContent: boolean;
  isInterruptingPrompt: boolean;
  isSessionShellLoading: boolean;
  isTranscriptLoading: boolean;
  isWaitingForChatReply: boolean;
  pendingChatPrompt: PendingChatPrompt | null;
  selectedSessionDetail: SessionDetail | null;
  selectedSessionId: string;
  sessionShell: SessionDetail | SessionSummary | null;
  sourceSessionSummary: AgentSessionSummary | null;
  takenOverAgentSession: AgentSessionDetail | null;
}) {
  const isPromptTrackableSessionShell =
    Boolean(sessionShell?.sourceSessionId) &&
    (sessionShell?.status === "running" || sessionShell?.status === "read_only");
  const isSourceSessionWorking =
    isManagedSourceSessionWorking(
      sessionShell,
      takenOverAgentSession,
      sourceSessionSummary
    );
  const liveSourceState = resolveLiveSourceState(
    takenOverAgentSession,
    sourceSessionSummary
  );
  const interruptLifecycle = getSessionInterruptLifecycle(liveSourceState);
  const isServerInterruptRequested = interruptLifecycle.phase === "requested";
  const isEffectiveInterruptingPrompt = isInterruptingPrompt || isServerInterruptRequested;
  const isPromptInterruptibleSessionShell =
    sessionShell?.status === "running" ||
    sessionShell?.status === "read_only" ||
    isSourceSessionWorking;
  const {
    displayedPendingChatPrompt,
    isRawPendingPromptCompleted,
    rawPendingChatPrompt
  } = resolvePendingChatPrompt({
    chatTranscriptEntries,
    isPromptTrackableSessionShell,
    pendingChatPrompt,
    selectedSessionDetail,
    selectedSessionId,
    sessionShell
  });
  const effectiveShellWaitingPrompt = resolveShellWaitingPrompt({
    isPromptTrackableSessionShell,
    sessionShell
  });
  const currentManagedPromptRequestedAt =
    effectiveShellWaitingPrompt?.requestedAt ??
    rawPendingChatPrompt?.requestedAt ??
    displayedPendingChatPrompt?.requestedAt ??
    null;
  const suppressWaitingForInterruptLifecycle = isInterruptLifecycleWaitingSuppressed(
    interruptLifecycle,
    currentManagedPromptRequestedAt
  );
  const hasConfirmedRawPendingPrompt = isConfirmedDeskCuePendingPrompt(rawPendingChatPrompt);
  const promptRecovery = sessionShell?.promptRecovery ?? null;
  const isExternalSourceTurn = isSourceTurnOutsideDeskCue(
    sessionShell,
    liveSourceState,
    {
      hasDeskCuePrompt: hasConfirmedRawPendingPrompt,
      hasPromptRecovery: Boolean(promptRecovery),
      hasWaitingPrompt: Boolean(effectiveShellWaitingPrompt),
      isSourceSessionWorking
    }
  );

  const isShellWaitingPromptCompleted = hasShellWaitingPromptCompleted(
    takenOverAgentSession,
    effectiveShellWaitingPrompt
  );
  const hasCompletedManagedPrompt =
    isRawPendingPromptCompleted || isShellWaitingPromptCompleted;

  const isManagedSourceWaiting = isManagedSourceReplyWaiting(sessionShell);
  const hasUnfinishedRawPendingPrompt =
    rawPendingChatPrompt !== null && !isRawPendingPromptCompleted;
  const isLocalPendingPromptWaiting =
    isPromptInterruptibleSessionShell &&
    isWaitingForChatReply &&
    hasUnfinishedRawPendingPrompt;
  const isShellPromptWaiting =
    effectiveShellWaitingPrompt !== null && !isShellWaitingPromptCompleted;
  const isConfirmedPendingPromptWaiting =
    hasUnfinishedRawPendingPrompt && rawPendingChatPrompt?.status !== "not_confirmed";
  const isCrossClientPromptWaiting =
    isManagedSourceWaiting && !hasCompletedManagedPrompt;
  const shouldShowManagedPromptWaiting =
    isLocalPendingPromptWaiting ||
    isShellPromptWaiting ||
    isConfirmedPendingPromptWaiting ||
    isCrossClientPromptWaiting;
  const currentWaitingPrompt =
    effectiveShellWaitingPrompt ?? rawPendingChatPrompt ?? displayedPendingChatPrompt;

  const hasCurrentWaitingPromptAssistantReply = useMemo(
    () =>
      currentWaitingPrompt
        ? hasAssistantReplyAfterPrompt(chatTranscriptEntries, currentWaitingPrompt)
        : false,
    [chatTranscriptEntries, currentWaitingPrompt]
  );

  const {
    isReplyCompletionBridgeActive,
    replyCompletionBridgePrompt
  } = useReplyCompletionBridge({
    baseIsWaitingForChatReply: shouldShowManagedPromptWaiting,
    chatTranscriptEntries,
    currentWaitingPrompt,
    hasCurrentWaitingPromptAssistantReply,
    isInterruptingPrompt: isEffectiveInterruptingPrompt
  });

  const effectiveIsWaitingForChatReply =
    !suppressWaitingForInterruptLifecycle &&
    (shouldShowManagedPromptWaiting || isReplyCompletionBridgeActive);
  const waitingReplyPrompt =
    displayedPendingChatPrompt ?? effectiveShellWaitingPrompt ?? replyCompletionBridgePrompt;

  const isTranscriptSyncing =
    Boolean(sessionShell?.sourceSessionId) &&
    sessionShell?.status === "running" &&
    !hasConversationContent &&
    !displayedPendingChatPrompt &&
    !effectiveIsWaitingForChatReply &&
    !isEffectiveInterruptingPrompt &&
    !suppressWaitingForInterruptLifecycle;

  const hasActivePendingPrompt =
    displayedPendingChatPrompt?.status !== "not_confirmed" && Boolean(displayedPendingChatPrompt);

  const activeActionRequest = sessionShell?.actionRequest ?? null;
  const activePromptText = sessionShell?.replyState.promptText ?? null;
  const isPromptInFlight = resolvePromptInFlight({
    hasActivePendingPrompt,
    isInterruptingPrompt: isEffectiveInterruptingPrompt,
    isSourceSessionWorking: isSourceSessionWorking && !hasCompletedManagedPrompt,
    isWaitingForChatReply: effectiveIsWaitingForChatReply,
    suppressWaitingForInterruptLifecycle
  });
  const isPromptQueued = sessionShell?.replyState.phase === "queued";
  const composerPromptInFlight =
    activeActionRequest || isExternalSourceTurn || promptRecovery
      ? false
      : isPromptInFlight;

  const shouldShowChatLoading = shouldShowManagedSessionChatLoading({
    hasConversationContent,
    hasPendingPrompt: Boolean(displayedPendingChatPrompt),
    isInterruptingPrompt: isEffectiveInterruptingPrompt,
    isSessionShellLoading,
    isTranscriptLoading,
    isTranscriptSyncing,
    isWaitingForChatReply: effectiveIsWaitingForChatReply,
    suppressWaitingForInterruptLifecycle
  });

  const { canSendInput } = resolveInputAvailability(sessionShell, {
    blockExternalSourceInput: isExternalSourceTurn || Boolean(promptRecovery),
    canSendInputWhenReadOnly
  });
  const inputUnavailableLabel = resolveInputUnavailableLabel({
    canSendInput,
    inputBlockedReason: sessionShell?.inputBlockedReason,
    isExternalSourceTurn,
    promptRecovery,
    sourceSessionId: sessionShell?.sourceSessionId
  });

  const sharedViewerCount = sessionShell?.viewerCount ?? 0;
  const sharedSessionHint = promptRecovery
    ? "DeskCue will not resend this prompt automatically"
    : isExternalSourceTurn
      ? "This turn is running outside DeskCue. Finish or stop it in the controlling client before sending a follow-up"
      : !canSendInput && sessionShell?.inputBlockedReason
        ? sessionShell.inputBlockedReason
        : sharedViewerCount > 1 && composerPromptInFlight
          ? `This live session is open in ${sharedViewerCount} DeskCue clients. Sending a new prompt from here will interrupt the current run first`
          : null;

  return {
    activeActionRequest,
    activePromptText,
    canSendInput,
    composerPromptInFlight,
    displayedPendingChatPrompt: suppressWaitingForInterruptLifecycle ? null : displayedPendingChatPrompt,
    effectiveIsWaitingForChatReply,
    effectiveShellWaitingPrompt,
    hasCompletedManagedPrompt,
    hasCompletedManagedPromptWithFinalReply:
      hasCompletedManagedPrompt && hasCurrentWaitingPromptAssistantReply,
    inputUnavailableLabel,
    isExternalSourceTurn,
    isPromptQueued,
    interruptLifecycle,
    isInterruptingPrompt: isEffectiveInterruptingPrompt,
    sharedSessionHint,
    sharedViewerCount,
    shouldShowChatLoading,
    waitingReplyPrompt
  };
}
