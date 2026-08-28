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

import { findManagedSourceSessionSummary } from "./liveChat/helpers";
import {
  CHAT_ACTIVITY_ENTRY_RENDER_LIMIT,
  EXTERNAL_WAIT_VISIBILITY_DELAY_MS
} from "./panel/constants";
import { buildWaitingDetailStickKey } from "./panel/helpers";
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

export function useManagedSessionPanelViewModel({
  activityHydrationRepository,
  activeTab,
  agentSessions,
  agentTranscriptHasMoreById,
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
  suppressExternalWaiting = false,
  takenOverAgentSession
}: ManagedSessionPanelProps) {
  const { copyFeedback, handleCopyMessage } = useMessageCopyFeedback();
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
    selectedSessionId
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
    sourceDiffParts
  } = useManagedSessionTranscriptViewModel({
    activeTab,
    isTakenOverAgentSessionLoading,
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
  const hasExternalSourceReply =
    !suppressExternalWaiting &&
    isExternalSourceTurn;
  const [isExternalSourceReplyVisible, setIsExternalSourceReplyVisible] = useState(false);

  useEffect(() => {
    if (!hasExternalSourceReply) {
      setIsExternalSourceReplyVisible(false);
      return;
    }

    const timer = window.setTimeout(
      () => setIsExternalSourceReplyVisible(true),
      EXTERNAL_WAIT_VISIBILITY_DELAY_MS
    );

    return () => window.clearTimeout(timer);
  }, [hasExternalSourceReply]);

  const isWaitingForExternalSourceReply =
    hasExternalSourceReply && isExternalSourceReplyVisible;
  const isWaitingForAnySourceReply =
    effectiveIsWaitingForChatReply || isWaitingForExternalSourceReply;

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
        deferEntryRender={activity.kind === "details" || activity.kind === "tools"}
        entries={readHydratedActivityEntries(activity)}
        errorLabel={readActivityHydrationErrorLabel(activity)}
        entryLimit={CHAT_ACTIVITY_ENTRY_RENDER_LIMIT[activity.kind]}
        hideCompactEntries
        loadingLabel={`Loading ${activity.kind}...`}
      />
    ),
    [readActivityHydrationErrorLabel, readHydratedActivityEntries]
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
  const liveChatThreadProps = {
    assistantDisplayName,
    assetContext: liveChatAssetContext,
    canRevealEarlierHistory,
    copyFeedback,
    hiddenConversationItemCount,
    isLoadingMoreHistory,
    isActivityExpanded,
    renderActivityEntries,
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
    canSendInput,
    chatComposerShellRef,
    chatSurfaceRef,
    chatToolbarRef,
    chatWorkspaceStyle,
    composerPromptInFlight,
    contextCompactionCount,
    debugEntries,
    inputUnavailableLabel,
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
    previewUrl: previewTicket.url,
    renderActivityEntries,
    selectedSessionDetail,
    sessionShell,
    sharedSessionHint,
    sharedViewerCount,
    showModelContext,
    sourceDiffParts,
    switchableManagedSessions,
    setShowModelContext,
    onHydrateActivityGroup: hydrateActivityEntries,
    onToggleActivityGroup: handleToggleActivityGroup
  };
}
