import { useCallback, useEffect, useMemo, useState } from "react";

import {
  acquirePendingCloudCommand,
  clearPendingCloudCommand
} from "@api/transport/pendingCommandJournal";
import { ManagedSessionActivityEntries } from "@modules/session/activity";
import {
  buildManagedSessionChatThreadState,
  useManagedSessionChatScroll,
  useMessageCopyFeedback
} from "@modules/session/chat";
import { previewReviewStore } from "@modules/session/store/previewReviewStore";
import type {
  ConversationActivity,
  ManagedSessionPanelProps
} from "@modules/session/types";
import { useDeskCueRuntime } from "@runtime";

import {
  findManagedSourceSessionSummary,
  resolveLiveSourceState
} from "./liveChat/helpers";
import { CHAT_ACTIVITY_ENTRY_RENDER_LIMIT } from "./panel/constants";
import {
  buildWaitingDetailStickKey,
  hasConfirmedExternalSourceReply,
  isTranscriptHistoryKnownIncomplete,
  resolveReplyOutcome,
  stabilizeExternalSourceComposerState
} from "./panel/helpers";
import { useStableExternalSourceReplyVisibility } from "./panel/useStableExternalSourceReplyVisibility";
import { usePreviewCandidates } from "./preview/usePreviewCandidates";
import { usePreviewTicket } from "./preview/usePreviewTicket";
import { useManagedSessionReplyState } from "./replyState";
import {
  resendRecoveredPrompt,
  resolveRecoveredPromptCommandTarget
} from "./replyState/promptRecoveryAction";
import { useManagedSessionActivityEntryHydration } from "./useManagedSessionActivityEntryHydration";
import { useManagedSessionActivityExpansion } from "./useManagedSessionActivityExpansion";
import { useManagedSessionLiveChatModel } from "./useManagedSessionLiveChatModel";
import { useManagedSessionShellViewModel } from "./useManagedSessionShellViewModel";
import { useManagedSessionTranscriptViewModel } from "./useManagedSessionTranscriptViewModel";
import { selectBackendWaitingDetailEntry } from "./waiting/selectBackendWaitingDetailEntry";

function buildExternalSourceSessionKey(
  selectedSessionId: string,
  sourceSessionId: string | null | undefined
) {
  return `${selectedSessionId}:${sourceSessionId ?? "no-source-session"}`;
}

export function useManagedSessionPanelViewModel({
  activityHydrationRepository,
  activeTab,
  agentSessions,
  agentTranscriptHasMoreById,
  agentTranscriptHistoryIncompleteById,
  canSendInputWhenReadOnly = false,
  isInterruptingPrompt: isLocalInterruptingPrompt,
  immediateInterruptPrompt: persistedImmediateInterruptPrompt = null,
  hasPreview,
  isTakenOverAgentSessionLoading,
  isWaitingForChatReply,
  liveUpdatesConnection,
  managedSessions,
  onHydrateAgentSessionChanges,
  onHydrateAgentSessionTranscriptEntries,
  onLoadMoreAgentSessionTranscript,
  onSendInput,
  pendingChatPrompt,
  selectedSession,
  selectedSessionId,
  sessionLoadError,
  suppressExternalWaiting = false,
  takenOverAgentSession
}: ManagedSessionPanelProps) {
  const { copyFeedback, handleCopyMessage } = useMessageCopyFeedback(selectedSessionId);
  const previewReview = previewReviewStore;
  const runtime = useDeskCueRuntime();

  const [showModelContext, setShowModelContext] = useState(false);
  const [loadingMoreAgentTranscriptId, setLoadingMoreAgentTranscriptId] = useState("");
  const {
    isActivityExpanded,
    resetActivityExpansion,
    toggleActivityGroup
  } = useManagedSessionActivityExpansion();

  const {
    activeSelectedSession,
    debugEntries,
    isSessionShellLoading,
    selectedSessionDetail,
    sessionShell
  } = useManagedSessionShellViewModel({
    managedSessions,
    selectedSession,
    selectedSessionId,
    suppressSessionShell: Boolean(sessionLoadError)
  });
  const previewEnabled = runtime.features.preview === true && hasPreview !== false;
  const usesHostPreviewLauncher = runtime.launchSessionPreview !== undefined;
  const previewTicket = usePreviewTicket(
    selectedSessionDetail,
    previewEnabled &&
      !usesHostPreviewLauncher &&
      activeTab === "preview",
    liveUpdatesConnection.status
  );
  const previewCandidates = usePreviewCandidates(
    selectedSessionDetail,
    previewEnabled && activeTab === "preview" && !usesHostPreviewLauncher
  );
  const promptRecovery = sessionShell?.promptRecovery ?? null;

  const sourceSessionSummary = useMemo(
    () =>
      findManagedSourceSessionSummary(
        agentSessions,
        sessionShell,
        takenOverAgentSession
      ),
    [agentSessions, sessionShell, takenOverAgentSession]
  );

  const sourceTranscriptHistoryIncomplete = isTranscriptHistoryKnownIncomplete(
    agentTranscriptHistoryIncompleteById,
    takenOverAgentSession?.id
  );

  const retryRecoveredPrompt = useCallback(
    () => resendRecoveredPrompt({
      clearPendingCommand: () => {
        const promptText = promptRecovery?.promptText?.trim() ?? "";
        const commandTarget = resolveRecoveredPromptCommandTarget(
          selectedSessionId,
          selectedSessionDetail
        );
        const command = acquirePendingCloudCommand(
          commandTarget.operation,
          commandTarget.targetId,
          promptText
        );

        clearPendingCloudCommand(command);
      },
      promptRecovery,
      sendInput: onSendInput
    }),
    [onSendInput, promptRecovery, selectedSessionDetail, selectedSessionId]
  );

  const {
    activityGroups,
    chatTranscriptEntries,
    conversationTimeline,
    hasConversationContent,
    isTranscriptLoading,
    latestWaitingDetailEntry: backendLatestWaitingDetailEntry,
    sourceDiffDetailsUnavailable,
    sourceDiffParts
  } = useManagedSessionTranscriptViewModel({
    activeTab,
    isTakenOverAgentSessionLoading,
    sourceTranscriptHistoryIncomplete,
    takenOverAgentSession
  });
  const {
    activeActionRequest,
    activePromptText,
    canSendInput,
    composerPromptInFlight,
    displayedPendingChatPrompt,
    effectiveIsWaitingForChatReply,
    effectiveShellWaitingPrompt,
    hasCompletedManagedPrompt,
    hasCompletedManagedPromptWithFinalReply,
    inputUnavailableLabel,
    interruptLifecycle,
    isExternalSourceTurn,
    isInterruptingPrompt,
    isPromptQueued,
    sharedSessionHint,
    sharedViewerCount,
    shouldShowChatLoading,
    waitingReplyPrompt
  } = useManagedSessionReplyState({
    canSendInputWhenReadOnly,
    chatTranscriptEntries,
    hasConversationContent,
    isInterruptingPrompt: isLocalInterruptingPrompt,
    isSessionShellLoading,
    isTranscriptLoading,
    isWaitingForChatReply,
    pendingChatPrompt,
    selectedSessionDetail,
    selectedSessionId,
    sessionShell,
    sourceSessionSummary,
    takenOverAgentSession
  });

  const {
    assistantDisplayName,
    canLoadMoreAgentTranscript,
    contextCompactionCount,
    isMoreAgentTranscriptLoading,
    isTakenOverChat,
    liveChatAgentSessionId,
    liveChatAssetContext,
    liveChatSessionId,
    liveChatSourceSessionId,
    liveHeaderStatus,
    liveHeaderStatusLabel,
    liveSessionSubtitle,
    liveSessionTitle,
    switchableManagedSessions
  } = useManagedSessionLiveChatModel({
    agentSessions,
    agentTranscriptHasMoreById,
    hasCompletedManagedPrompt,
    isManagedPromptWaiting:
      Boolean(displayedPendingChatPrompt) ||
      effectiveIsWaitingForChatReply,
    isPromptInFlight:
      Boolean(displayedPendingChatPrompt) ||
      effectiveIsWaitingForChatReply ||
      isInterruptingPrompt,
    loadingMoreAgentTranscriptId,
    managedSessions,
    sessionShell,
    takenOverAgentSession
  });
  const {
    hydrateActivityEntries,
    readActivityHydrationErrorLabel,
    readHydratedActivityEntries
  } = useManagedSessionActivityEntryHydration({
    activityHydrationRepository,
    agentSessionId: liveChatAgentSessionId ?? null,
    onHydrateAgentSessionChanges,
    onHydrateAgentSessionTranscriptEntries
  });
  const waitingDetailSince =
    waitingReplyPrompt?.requestedAt ?? null;
  const liveExternalSourceSession = resolveLiveSourceState(
    takenOverAgentSession,
    sourceSessionSummary
  );
  const hasExternalSourceReply =
    !suppressExternalWaiting &&
    isExternalSourceTurn;
  const externalSourceSessionKey = buildExternalSourceSessionKey(
    selectedSessionId,
    sessionShell?.sourceSessionId ?? liveChatSourceSessionId
  );
  const hasConfirmedExternalReply = hasConfirmedExternalSourceReply(
    liveExternalSourceSession,
    chatTranscriptEntries,
    waitingReplyPrompt?.requestedAt ?? null
  );
  const isWaitingForExternalSourceReply =
    useStableExternalSourceReplyVisibility({
      hasExternalSourceReply,
      resetKey: externalSourceSessionKey,
      terminalConfirmed: hasConfirmedExternalReply
    });
  const isWaitingForAnySourceReply =
    effectiveIsWaitingForChatReply || isWaitingForExternalSourceReply;
  const stableComposerState = stabilizeExternalSourceComposerState({
    canSendInput,
    composerPromptInFlight,
    inputUnavailableLabel
  }, isWaitingForExternalSourceReply);

  const latestWaitingDetailEntry = useMemo(
    () =>
      isWaitingForAnySourceReply
        ? selectBackendWaitingDetailEntry(backendLatestWaitingDetailEntry, waitingDetailSince)
        : null,
    [
      backendLatestWaitingDetailEntry,
      isWaitingForAnySourceReply,
      waitingDetailSince
    ]
  );

  const bottomStickKey = [
    displayedPendingChatPrompt?.requestedAt ?? "",
    effectiveShellWaitingPrompt?.requestedAt ?? "",
    promptRecovery ? `${promptRecovery.requestedAt}:${promptRecovery.phase}` : "",
    waitingReplyPrompt?.requestedAt ?? "",
    buildWaitingDetailStickKey(latestWaitingDetailEntry),
    isWaitingForAnySourceReply ? "waiting" : "idle"
  ].join(":");
  const {
    chatComposerShellRef,
    chatSurfaceRef,
    chatThreadRef,
    chatToolbarRef,
    chatWorkspaceStyle,
    canRevealEarlierHistory,
    hiddenConversationItemCount,
    isLoadingMoreHistory,
    isCompactViewport,
    revealEarlierHistory,
    scrollChatToLatest,
    showScrollToLatest,
    visibleConversationTimeline
  } = useManagedSessionChatScroll({
    activeTab,
    bottomStickKey,
    canLoadMoreHistory:
      Boolean(liveChatAgentSessionId) &&
      Boolean(sessionShell?.sourceSessionId) &&
      canLoadMoreAgentTranscript,
    conversationTimeline,
    effectiveIsWaitingForChatReply: isWaitingForAnySourceReply,
    effectivePendingChatPrompt: displayedPendingChatPrompt,
    isLoadingMoreHistory: isMoreAgentTranscriptLoading,
    isTakenOverChat,
    liveChatSessionId,
    liveChatSourceSessionId,
    onLoadMoreHistory: async (beforeEntryId) => {
      if (!liveChatAgentSessionId) return 0;

      setLoadingMoreAgentTranscriptId(liveChatAgentSessionId);

      try {
        return await onLoadMoreAgentSessionTranscript(liveChatAgentSessionId, beforeEntryId);
      } finally {
        setLoadingMoreAgentTranscriptId((current) =>
          current === liveChatAgentSessionId ? "" : current
        );
      }
    },
    resetKey: `${selectedSessionDetail?.id ?? ""}:${takenOverAgentSession?.id ?? ""}`
  });

  useEffect(() => {
    resetActivityExpansion();
    setShowModelContext(false);
  }, [resetActivityExpansion, selectedSessionDetail?.id, takenOverAgentSession?.id]);

  const handleToggleActivityGroup = useCallback((activity: ConversationActivity) => {
    toggleActivityGroup(activity);
  }, [toggleActivityGroup]);

  const renderActivityEntries = useCallback(
    (activity: ConversationActivity) => (
      <ManagedSessionActivityEntries
        assetContext={liveChatAssetContext}
        deferEntryRender={activity.kind === "details" || activity.kind === "tools"}
        entries={readHydratedActivityEntries(activity)}
        errorLabel={readActivityHydrationErrorLabel(activity)}
        entryLimit={CHAT_ACTIVITY_ENTRY_RENDER_LIMIT[activity.kind]}
        hideCompactEntries
        loadingLabel={`Loading ${activity.kind}...`}
      />
    ),
    [liveChatAssetContext, readActivityHydrationErrorLabel, readHydratedActivityEntries]
  );

  const immediateInterruptPrompt =
    persistedImmediateInterruptPrompt &&
    (!persistedImmediateInterruptPrompt.sessionId ||
      persistedImmediateInterruptPrompt.sessionId === selectedSessionId)
      ? {
          text: persistedImmediateInterruptPrompt.text,
          requestedAt: persistedImmediateInterruptPrompt.requestedAt,
          phase:
            isInterruptingPrompt || interruptLifecycle.phase === "requested"
              ? "stopping" as const
              : "interrupted" as const
        }
      : null;
  const chatThreadState = buildManagedSessionChatThreadState({
    hasConversationContent,
    immediateInterruptPrompt,
    interruptLifecycle,
    isInterruptingPrompt,
    pendingChatPrompt: displayedPendingChatPrompt,
    promptRecovery,
    shouldShowChatLoading,
    visibleConversationTimeline,
    waiting: effectiveIsWaitingForChatReply
      ? { kind: "deskcue", detailEntry: latestWaitingDetailEntry }
      : isWaitingForExternalSourceReply
        ? { kind: "external", detailEntry: latestWaitingDetailEntry }
        : { kind: "idle" }
  });
  const sourceTerminalOutcome = hasConfirmedExternalReply && liveExternalSourceSession?.turnState
    ? liveExternalSourceSession.turnState.phase
    : null;
  const replyOutcome = resolveReplyOutcome(
    sourceTerminalOutcome === "completed" ||
      sourceTerminalOutcome === "failed" ||
      sourceTerminalOutcome === "interrupted"
      ? sourceTerminalOutcome
      : null,
    immediateInterruptPrompt?.phase,
    hasCompletedManagedPromptWithFinalReply
  );
  const liveChatThreadProps = {
    assistantDisplayName,
    assetContext: liveChatAssetContext,
    canRevealEarlierHistory,
    copyFeedback,
    hiddenConversationItemCount,
    isLoadingMoreHistory,
    isActivityExpanded,
    replyOutcome,
    renderActivityEntries,
    sessionKey: externalSourceSessionKey,
    showScrollToLatest,
    state: chatThreadState,
    threadRef: chatThreadRef,
    onCopyMessage: handleCopyMessage,
    onHydrateActivityGroup: hydrateActivityEntries,
    onRevealEarlierHistory: revealEarlierHistory,
    onRetryRecoveredPrompt: retryRecoveredPrompt,
    onScrollToLatest: scrollChatToLatest,
    onToggleActivityGroup: handleToggleActivityGroup
  };

  return {
    activeActionRequest,
    activePromptText,
    activeSelectedSession,
    activityGroups,
    canSendInput: stableComposerState.canSendInput,
    chatComposerShellRef,
    chatSurfaceRef,
    chatToolbarRef,
    chatWorkspaceStyle,
    composerPromptInFlight: stableComposerState.composerPromptInFlight,
    contextCompactionCount,
    debugEntries,
    inputUnavailableLabel: stableComposerState.inputUnavailableLabel,
    isCompactViewport,
    isActivityExpanded,
    interruptLifecycle,
    isInterruptingPrompt,
    isPromptQueued,
    isTakenOverChat,
    liveChatThreadProps,
    liveHeaderStatus,
    liveHeaderStatusLabel,
    liveSessionSubtitle,
    liveSessionTitle,
    previewReview,
    previewDocumentRevision: previewTicket.documentRevision,
    previewError: previewTicket.error,
    previewCandidates: previewCandidates.candidates,
    previewCandidatesError: previewCandidates.error,
    previewCandidatesLoading: previewCandidates.loading,
    previewLoading: previewTicket.loading,
    previewRetry: previewTicket.retry,
    previewValidate: previewTicket.validate,
    previewUrl: previewTicket.url,
    renderActivityEntries,
    selectedSessionDetail,
    sessionShell,
    sharedSessionHint,
    sharedViewerCount,
    showModelContext,
    sourceDiffDetailsUnavailable,
    sourceDiffParts,
    switchableManagedSessions,
    setShowModelContext,
    onHydrateActivityGroup: hydrateActivityEntries,
    onToggleActivityGroup: handleToggleActivityGroup
  };
}
