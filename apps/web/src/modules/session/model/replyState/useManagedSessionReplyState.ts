import { useMemo } from "react";

import type {
  AgentSessionDetail,
  SessionDetail,
  SessionSummary
} from "@deskcue/protocol";
import { isActiveSourceTurn } from "@models/agentChatWorkState";
import type { PendingChatPrompt } from "@models/promptDelivery";
import {
  getSessionInterruptLifecycle,
  isInterruptLifecycleWaitingSuppressed
} from "@models/sessionInterruptLifecycle";
import type { ChatTranscriptEntry } from "@modules/session/types";

import {
  hasAssistantReplyAfterPrompt,
  hasShellWaitingPromptCompleted,
  resolveInputAvailability,
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
  takenOverAgentSession: AgentSessionDetail | null;
}) {
  const isPromptTrackableSessionShell =
    Boolean(sessionShell?.sourceSessionId) &&
    (sessionShell?.status === "running" || sessionShell?.status === "read_only");
  const isSourceSessionWorking =
    Boolean(sessionShell?.sourceSessionId) && isActiveSourceTurn(takenOverAgentSession);
  const interruptLifecycle = getSessionInterruptLifecycle(takenOverAgentSession);
  const isServerInterruptRequested = interruptLifecycle.phase === "requested";
  const isEffectiveInterruptingPrompt = isInterruptingPrompt || isServerInterruptRequested;
  const suppressWaitingForInterruptLifecycle =
    isInterruptLifecycleWaitingSuppressed(interruptLifecycle);
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
  const isShellWaitingPromptCompleted = hasShellWaitingPromptCompleted(
    takenOverAgentSession,
    effectiveShellWaitingPrompt
  );
  const activeActionRequest = sessionShell?.actionRequest ?? null;

  const baseEffectiveIsWaitingForChatReply =
    (isPromptInterruptibleSessionShell &&
      isWaitingForChatReply &&
      Boolean(rawPendingChatPrompt) &&
      !isRawPendingPromptCompleted) ||
    Boolean(effectiveShellWaitingPrompt && !isShellWaitingPromptCompleted) ||
    // The source turn may be observed before the refreshed shell reply state
    // reaches the browser. A pending prompt scoped to this DeskCue session is
    // still owned by DeskCue, never an external turn.
    Boolean(
      rawPendingChatPrompt &&
      rawPendingChatPrompt.status !== "not_confirmed" &&
      !isRawPendingPromptCompleted
    );
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
    baseIsWaitingForChatReply: baseEffectiveIsWaitingForChatReply,
    chatTranscriptEntries,
    currentWaitingPrompt,
    hasCurrentWaitingPromptAssistantReply,
    isInterruptingPrompt: isEffectiveInterruptingPrompt
  });

  const effectiveIsWaitingForChatReply =
    !suppressWaitingForInterruptLifecycle &&
    (baseEffectiveIsWaitingForChatReply || isReplyCompletionBridgeActive);
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

  const activePromptText = sessionShell?.replyState.promptText ?? null;
  const isPromptInFlight = resolvePromptInFlight({
    hasActivePendingPrompt,
    isInterruptingPrompt: isEffectiveInterruptingPrompt,
    isSourceSessionWorking,
    isWaitingForChatReply: effectiveIsWaitingForChatReply,
    suppressWaitingForInterruptLifecycle
  });
  const isPromptQueued = sessionShell?.replyState.phase === "queued";
  const composerPromptInFlight = activeActionRequest ? false : isPromptInFlight;
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

  const { canSendInput } = resolveInputAvailability(sessionShell, { canSendInputWhenReadOnly });

  const sharedViewerCount = sessionShell?.viewerCount ?? 0;
  const sharedSessionHint =
    sharedViewerCount > 1 && composerPromptInFlight
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
    isSourceSessionWorking,
    isPromptQueued,
    interruptLifecycle,
    isInterruptingPrompt: isEffectiveInterruptingPrompt,
    sharedSessionHint,
    sharedViewerCount,
    shouldShowChatLoading,
    waitingReplyPrompt
  };
}
