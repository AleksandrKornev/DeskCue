import { useEffect, useRef } from "react";

import { isLoopbackHostname } from "@models/sessionPreview";
import type { SessionTab } from "@models/sessionTabs";

import { useDashboardCachedState } from "./cache";
import { useDashboardCommandHandlers } from "./commands";
import { syncAgentAttachOperationSelection } from "./commands/agentAttachOperation";
import type {
  AgentAttachOperationState,
  PromptOperationState
} from "./commands/types";
import { buildDashboardViewModel } from "./dashboardViewModel";
import {
  useDashboardBootstrap,
  useDashboardLoaders,
  useDashboardMutableRefs
} from "./data";
import { useDashboardLiveUpdates } from "./liveUpdates";
import {
  useDashboardPromptState,
  usePromptDeliveryController
} from "./prompt";
import { syncPromptOperationSelection } from "./prompt/promptOperation";
import {
  useActiveTakenOverAgentSessionController,
  useSelectedAgentSessionController,
  useSelectedManagedSessionController
} from "./selection";
import { dashboardStore } from "./store";
import { useAgentTranscriptPagination } from "./transcript";
import { useCloudMachineOverviewPolling } from "./useCloudMachineOverviewPolling";
import { useDashboardAgentSessionActions } from "./useDashboardAgentSessionActions";
import { useDashboardCacheLifecycle } from "./useDashboardCacheLifecycle";

export function useDeskCueDashboard(options?: {
  initialActiveTab?: SessionTab;
  initialManagedSessionId?: string;
  suppressAgentSessionAutoSelect?: boolean;
  suppressManagedSessionAutoSelect?: boolean;
}) {
  const store = dashboardStore;
  const cachedState = useDashboardCachedState(store, options);
  const {
    overview,
    agentSessions,
    agentSessionsHasMore,
    agentSessionsLoadState,
    agentSessionsQuery,
    runtimes,
    selectedSourceId,
    selectedAgentSessionId,
    selectedAgentSession,
    readyForReviewAgentSessionIds,
    isAgentSessionLoading,
    selectedAgentSessionRefreshNonce,
    activeTakenOverAgentSession,
    isActiveTakenOverAgentSessionLoading,
    selectedWorkspaceId,
    selectedSessionId,
    selectedSession,
    activeTab,
    workspacePath,
    command,
    previewPort,
    error,
    loading,
    pickingWorkspace,
    attachingAgentSessionId,
    eventStreamAttempt,
    isBootstrapping,
    liveUpdatesConnection
  } = store;

  const {
    captureOverviewRevision,
    incrementSelectedAgentSessionRefreshNonce,
    setOverview,
    updateOverview,
    setAgentSessionsPage,
    setAgentSessionsLoadState,
    appendAgentSessionsPage,
    setRuntimes,
    setSelectedSourceId,
    setSelectedAgentSessionId,
    setSelectedAgentSession,
    clearAgentSessionReadyForReview,
    updateSelectedAgentSession,
    setIsAgentSessionLoading,
    setActiveTakenOverAgentSession,
    updateActiveTakenOverAgentSession,
    setIsActiveTakenOverAgentSessionLoading,
    setSelectedWorkspaceId,
    setSelectedSessionId,
    setSelectedSession,
    mergeSelectedSessionView,
    setActiveTab,
    setWorkspacePath,
    setCommand,
    setPreviewPort,
    setError,
    setErrorIfEmpty,
    setLoading,
    setPickingWorkspace,
    setAttachingAgentSessionId,
    setIsBootstrapping
  } = store;

  const {
    agentTranscriptHasMoreById,
    hydrateAgentSessionChanges,
    hydrateAgentSessionTranscriptEntries,
    loadMoreAgentSessionTranscript
  } = useAgentTranscriptPagination(store);
  const {
    activeTabRef,
    agentSessionsRef,
    hydratedSelectedAgentSessionIdRef,
    overviewRef,
    runtimesRef,
    selectedAgentSessionIdRef,
    selectedAgentSessionRef,
    selectedSessionIdRef,
    selectedSessionSelectionEpochRef,
    selectedSessionRef
  } = useDashboardMutableRefs({
    activeTab,
    agentSessions,
    overview,
    runtimes,
    selectedAgentSession,
    selectedAgentSessionId,
    selectedSession,
    selectedSessionId
  });
  const {
    pendingChatPrompt,
    awaitingChatReplySince,
    isWaitingForChatReply,
    isInterruptingPrompt,
    immediateInterruptPrompt,
    effectivePendingChatPrompt,
    effectiveIsWaitingForChatReply,
    setPendingChatPrompt,
    setAwaitingChatReplySince,
    setIsWaitingForChatReply,
    setIsInterruptingPrompt,
  } = useDashboardPromptState(
    selectedSessionId,
    selectedSession,
    activeTakenOverAgentSession,
    cachedState
  );

  const {
    loadOverview,
    loadAgentSessions,
    loadMoreAgentSessions,
    searchAgentSessions,
    loadRuntimes,
    loadSession,
    loadSessionWithOutcome
  } = useDashboardLoaders({
    captureOverviewRevision,
    overviewRef,
    agentSessionsRef,
    runtimesRef,
    selectedSessionIdRef,
    selectedSessionSelectionEpochRef,
    selectedSessionRef,
    setOverview,
    setAgentSessionsPage,
    setAgentSessionsLoadState,
    appendAgentSessionsPage,
    setRuntimes,
    setSelectedSession,
    mergeSelectedSessionView,
    setErrorIfEmpty
  });

  useCloudMachineOverviewPolling({
    agentSessionsQuery,
    loadAgentSessions,
    loadOverview,
    searchAgentSessions,
    selectedSourceId
  });

  const {
    initialManagedSessionLoadState,
    retryInitialManagedSessionLoad
  } = useDashboardBootstrap({
    initialManagedSessionId: options?.initialManagedSessionId,
    suppressManagedSessionAutoSelect: options?.suppressManagedSessionAutoSelect,
    selectedSessionIdRef,
    loadOverview,
    loadAgentSessions,
    loadRuntimes,
    loadSession,
    loadSessionWithOutcome,
    setSelectedSessionId,
    setIsBootstrapping
  });

  useDashboardCacheLifecycle(store, {
    activeTakenOverAgentSession,
    agentSessions,
    awaitingChatReplySince,
    isWaitingForChatReply,
    overview,
    pendingChatPrompt,
    readyForReviewAgentSessionIds,
    runtimes,
    selectedAgentSession,
    selectedAgentSessionId,
    selectedSession,
    selectedSessionId,
    selectedSourceId,
    selectedWorkspaceId
  });
  const promptOperationRef = useRef<PromptOperationState>({
    epoch: 0,
    targetSessionId: ""
  });
  const agentAttachOperationRef = useRef<AgentAttachOperationState>({
    epoch: 0,
    targetSessionId: ""
  });
  useEffect(() => {
    syncPromptOperationSelection(promptOperationRef, selectedSessionId);
  }, [selectedSessionId]);
  useEffect(() => {
    syncAgentAttachOperationSelection(agentAttachOperationRef, selectedAgentSessionId);
  }, [selectedAgentSessionId]);

  const filteredAgentSessions = store.filteredAgentSessions;
  const activeTakenOverAgentSessionSummaryId = store.activeTakenOverAgentSessionSummaryId;

  useSelectedManagedSessionController({
    suppressManagedSessionAutoSelect: options?.suppressManagedSessionAutoSelect,
    overview,
    isBootstrapping,
    activeTab,
    selectedWorkspaceId,
    selectedAgentSessionId,
    selectedSessionId,
    selectedSession,
    selectedSessionIdRef,
    setSelectedWorkspaceId,
    setSelectedSessionId,
    setSelectedSession,
    loadSession
  });

  const refreshSelectedAgentSession = useSelectedAgentSessionController({
    suppressAgentSessionAutoSelect: options?.suppressAgentSessionAutoSelect,
    activeTab,
    isBootstrapping,
    agentSessions,
    filteredAgentSessions,
    selectedAgentSessionId,
    selectedAgentSession,
    selectedAgentSessionRefreshNonce,
    selectedSession,
    hydratedSelectedAgentSessionIdRef,
    selectedAgentSessionRef,
    incrementSelectedAgentSessionRefreshNonce,
    setSelectedAgentSessionId,
    setSelectedAgentSession,
    updateSelectedAgentSession,
    setIsAgentSessionLoading,
  });

  useActiveTakenOverAgentSessionController({
    enabled: !options?.suppressManagedSessionAutoSelect,
    isBootstrapping,
    activeTab,
    activeTakenOverAgentSession,
    activeTakenOverAgentSessionSummaryId,
    setActiveTakenOverAgentSession,
    updateActiveTakenOverAgentSession,
    setIsActiveTakenOverAgentSessionLoading
  });

  useDashboardLiveUpdates({
    store,
    eventStreamAttempt,
    activeTab,
    activeTabRef,
    selectedSessionId,
    selectedSession,
    selectedAgentSessionId,
    selectedSessionIdRef,
    selectedAgentSessionIdRef,
    selectedAgentSessionRef,
    selectedSessionRef,
    activeTakenOverAgentSessionSummaryId: activeTakenOverAgentSessionSummaryId || null,
    activeTakenOverAgentSession,
    pendingChatPrompt: effectivePendingChatPrompt,
    loadSession
  });

  const managedSessions = store.managedSessions;
  const runningCount = store.runningCount;
  const sourceCards = store.sourceCards;
  const agentSessionsTotalCountLabel = store.agentSessionsTotalCountLabel;
  const visibleRuntimes = store.visibleRuntimes;
  const canOpenNativeDialogs =
    overview.clientContext.canOpenNativeDialogs &&
    isLoopbackHostname(window.location.hostname || "localhost");
  const {
    markAgentSessionReviewed,
    refreshActiveTakenOverAgentSession
  } = useDashboardAgentSessionActions({
    activeTakenOverAgentSessionSummaryId:
      activeTakenOverAgentSessionSummaryId || null,
    clearReadyForReview: clearAgentSessionReadyForReview,
    setErrorIfEmpty,
    store
  });

  const promptDelivery = usePromptDeliveryController({
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
  });

  const {
    handleAddWorkspace,
    handlePickWorkspace,
    handleStartSession,
    handleAttachAgentSession,
    handleSendInput,
    handleStopSession,
    handleChangePreviewNetworkMode,
    handleRefreshGit,
    handleSetPreview,
    handleStopPreview
  } = useDashboardCommandHandlers({
    overview,
    agentSessions,
    workspacePath,
    selectedWorkspaceId,
    command,
    selectedAgentSessionId,
    selectedAgentSessionIdRef,
    agentAttachOperationRef,
    selectedSessionId,
    selectedSession,
    selectedSessionIdRef,
    selectedSessionSelectionEpochRef,
    selectedSessionRef,
    promptOperationRef,
    previewPort,
    promptDelivery,
    setWorkspacePath,
    updateOverview,
    setSelectedWorkspaceId,
    setSelectedSessionId,
    setSelectedSession,
    setActiveTab,
    setError,
    setLoading,
    setPickingWorkspace,
    setAttachingAgentSessionId,
    loadOverview,
    loadAgentSessions,
    loadSession
  });

  const overviewState = {
    overview,
    runningCount,
    sourceCards,
    visibleRuntimes,
    canOpenNativeDialogs,
    isBootstrapping,
    initialManagedSessionLoadState,
    error
  };
  const agentBrowserState = {
    agentSessions,
    agentSessionsTotalCountLabel,
    agentSessionsHasMore,
    agentSessionsLoadState,
    agentSessionsQuery,
    selectedSourceId,
    filteredAgentSessions,
    selectedAgentSessionId,
    selectedAgentSession,
    readyForReviewAgentSessionIds,
    isAgentSessionLoading,
    activeTakenOverAgentSession,
    agentTranscriptHasMoreById,
    isActiveTakenOverAgentSessionLoading,
    attachingAgentSessionId
  };
  const managedSessionState = {
    selectedSessionId,
    selectedSession,
    activeTab,
    managedSessions,
    previewPort,
    liveUpdatesConnection
  };
  const manualRunnerState = {
    loading,
    pickingWorkspace,
    workspacePath,
    selectedWorkspaceId,
    command
  };
  const promptState = {
    pendingChatPrompt: effectivePendingChatPrompt,
    isWaitingForChatReply: effectiveIsWaitingForChatReply,
    isInterruptingPrompt,
    immediateInterruptPrompt
  };
  const agentBrowserActions = {
    hydrateAgentSessionChanges,
    hydrateAgentSessionTranscriptEntries,
    loadMoreAgentSessionTranscript,
    setSelectedSourceId,
    setSelectedAgentSessionId,
    refreshSelectedAgentSession,
    setSelectedAgentSession,
    markAgentSessionReviewed
  };
  const managedSessionActions = {
    setSelectedSessionId,
    setSelectedSession,
    setActiveTab,
    setPreviewPort,
    handleChangePreviewNetworkMode,
    retryInitialManagedSessionLoad,
    handleSendInput,
    handleInterruptPrompt: promptDelivery.handleInterruptPrompt,
    handleStopSession,
    handleRefreshGit,
    handleSetPreview,
    handleStopPreview
  };
  const manualRunnerActions = {
    setWorkspacePath,
    setSelectedWorkspaceId,
    setCommand,
    handleAddWorkspace,
    handlePickWorkspace,
    handleStartSession,
    handleAttachAgentSession,
  };
  const agentBrowserLoaders = {
    loadAgentSessions,
    loadMoreAgentSessions,
    searchAgentSessions
  };

  return buildDashboardViewModel({
    overview: overviewState,
    agentBrowser: agentBrowserState,
    managedSession: managedSessionState,
    manualRunner: manualRunnerState,
    prompt: promptState,
    agentBrowserActions,
    managedSessionActions,
    manualRunnerActions,
    agentBrowserLoaders
  });
}
