import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";

import type { LocalLlmChatSummary } from "@deskcue/protocol";
import { formatAgentSessionTitle } from "@models/sessionDisplay";
import type {
  AgentSessionsPanelProps
} from "@modules/agents/types";
import { LocalLlmChatPreview } from "@modules/localLlmChats";
import { SubagentSessionsSupplement } from "@modules/session/subagents";
import { AgentTranscriptPanel } from "@modules/transcript";
import { getDeskCueRuntime } from "@runtime";
import { useDeskCueLayoutMode } from "@web/layout";

import { reviewAndSelectAgentSession } from "./actions";
import { AgentSessionsAttention } from "./attention/AgentSessionsAttention";
import {
  ATTENTION_PREVIEW_LIMIT,
  MOBILE_ATTENTION_PREVIEW_LIMIT
} from "./attention/constants";
import { buildAttentionSessionGroups } from "./attention/helpers";
import { useAgentSessionsAttentionState } from "./attention/useAgentSessionsAttentionState";
import { INITIAL_PANEL_SETTLE_MS } from "./constants";
import {
  CreateLocalChatButton,
  CreateLocalChatDialog
} from "./createLocalChat";
import {
  buildCreateLocalChatRuntimeOptions,
  buildCreateLocalChatWorkspaceOptions,
  chooseDefaultLocalChatRuntime
} from "./createLocalChat/adapters";
import { AgentSessionsDesktopLayout } from "./layout/AgentSessionsDesktopLayout";
import { AgentSessionsMobileLayout } from "./layout/AgentSessionsMobileLayout";
import { CollapsedAgentSessionsPanel } from "./layout/CollapsedAgentSessionsPanel";
import { useAgentBrowserCompactFocusHandoff } from "./layout/useAgentBrowserCompactFocusHandoff";
import { AgentSessionsEmptyState } from "./list/AgentSessionsEmptyState";
import { AgentSessionsList } from "./list/AgentSessionsList";
import { AgentSessionsPanelSurface } from "./loading/AgentSessionsPanelSurface";
import { AgentSessionsSkeleton } from "./loading/AgentSessionsSkeleton";
import { mergeAttentionSessions } from "./state/attention/helpers";
import { useAttentionAgentSessionSummaries } from "./state/attention/useAttentionAgentSessionSummaries";
import { useLocalChatCreation } from "./state/localChatCreation";
import { useLocalLlmChatSummaries } from "./state/localLlm/useLocalLlmChatSummaries";
import { useLocalRuntimeChatSelection } from "./state/localRuntime/useLocalRuntimeChatSelection";
import { useAgentSessionsUnifiedListModel } from "./state/unifiedList/useAgentSessionsUnifiedListModel";
import { useAgentSessionsPanelState } from "./state/useAgentSessionsPanelState";
import styles from "./styles.module.scss";
import { AgentSessionsToolbar } from "./toolbar/AgentSessionsToolbar";

export function AgentSessionsPanel(props: AgentSessionsPanelProps) {
  const { features } = getDeskCueRuntime();
  const layoutMode = useDeskCueLayoutMode();
  const {
    totalAgentSessionsCount,
    agentSessions,
    agentSessionsHasMore,
    agentSessionsLoadState,
    runtimes,
    workspaces,
    managedSessions,
    sourceCards,
    selectedSourceId,
    selectedAgentSessionId,
    selectedAgentSession,
    selectedAgentSessionLoadError,
    readyForReviewAgentSessionIds,
    isAgentSessionLoading,
    attaching,
    attachedManagedSessionId,
    attachedManagedSessionInfo,
    defaultCollapsed = false,
    isBootstrapping,
    pendingChatPrompt,
    secondaryAction,
    onAttachAgentSession,
    onBackToParentAgentSession,
    onMarkAgentSessionReviewed,
    onOpenManagedSession,
    onOpenSubagentSession,
    onOpenLocalLlmChat,
    onReloadAgentSessions,
    onRetrySelectedAgentSession
  } = props;

  const defaultLocalChatRuntime = useMemo(
    () => chooseDefaultLocalChatRuntime(runtimes),
    [runtimes]
  );

  const handleLocalChatCreated = useCallback(
    (chat: LocalLlmChatSummary) => {
      onOpenLocalLlmChat(chat.id);
    },
    [onOpenLocalLlmChat]
  );

  const localChatCreation = useLocalChatCreation({
    defaultRuntimeId: defaultLocalChatRuntime,
    onCreated: handleLocalChatCreated
  });

  const createLocalChatRuntimes = useMemo(
    () => buildCreateLocalChatRuntimeOptions(
      localChatCreation.catalog.runtime
        ? runtimes.map((runtime) => runtime.id === localChatCreation.catalog.runtime?.id
          ? localChatCreation.catalog.runtime
          : runtime)
        : runtimes
    ).map((runtime) =>
      runtime.id === localChatCreation.runtimeId &&
      localChatCreation.catalog.status === "starting_runtime"
        ? { ...runtime, status: "loading" as const, statusText: `Starting ${runtime.label}…` }
        : runtime
    ),
    [
      localChatCreation.catalog,
      localChatCreation.runtimeId,
      runtimes
    ]
  );

  const createLocalChatWorkspaces = useMemo(
    () => buildCreateLocalChatWorkspaceOptions(workspaces),
    [workspaces]
  );

  const { chats: localLlmChats } = useLocalLlmChatSummaries();
  const {
    canShowFewerSessions,
    canLoadMoreSessions,
    collapsed,
    filteredByQuery,
    hasSelectedAgentSession,
    hiddenSessionsCount,
    isCompactViewport,
    isLoadingMoreSessions,
    isMobileViewport,
    isSearchLoading,
    isSelectedAgentSessionSettling,
    isSourceSwitching,
    query,
    selectedAgentSessionDisplay,
    selectedAgentSessionSummary,
    showFocusedMobileDetail,
    visibleSessions,
    setCollapsed,
    setQuery,
    showFewerSessions,
    showMoreSessions,
    handleClearAgentSessionSelection,
    handleSelectSource,
    handleSelectAgentSession
  } = useAgentSessionsPanelState(props);
  const {
    hasLoaded: hasLoadedAttentionAgentSessions,
    hasMore: hasMoreAttentionAgentSessions,
    sessions: loadedAttentionAgentSessions
  } = useAttentionAgentSessionSummaries(!collapsed, selectedSourceId);

  const filteredAttentionAgentSessions = useMemo(
    () => selectedSourceId === "all"
      ? loadedAttentionAgentSessions
      : loadedAttentionAgentSessions.filter((session) => session.agentId === selectedSourceId),
    [loadedAttentionAgentSessions, selectedSourceId]
  );

  const availableAttentionAgentSessions = useMemo(
    () => mergeAttentionSessions(agentSessions, filteredAttentionAgentSessions),
    [agentSessions, filteredAttentionAgentSessions]
  );

  const {
    clearSelectedChat: clearSelectedLocalLlmChat,
    filteredChats: filteredLocalLlmChats,
    openChat: setSelectedLocalLlmChat,
    queryMatchedChatsCount: queryMatchedLocalLlmChatsCount,
    runtimeTabs: localRuntimeTabs,
    selectedChat: selectedLocalLlmChat,
    selectedRuntime: selectedLocalRuntime,
    selectRuntime: handleSelectLocalRuntime,
    selectSource: handleToolbarSourceSelection
  } = useLocalRuntimeChatSelection({
    chats: localLlmChats,
    onSelectSource: handleSelectSource,
    query,
    selectedSourceId
  });

  const attentionState = useAgentSessionsAttentionState({
    agentSessions: availableAttentionAgentSessions,
    cacheScopeKey: selectedSourceId,
    enabled: !collapsed,
    managedSessions,
    pendingChatPrompt,
    readyForReviewAgentSessionIds
  });
  const {
    approvalRequestedSourceSessionKeys,
    attentionSessions,
    effectiveReadyForReviewAgentSessionIds,
    workIndicatorsBySourceSessionKey
  } = attentionState;
  const shouldShowAttention = !isSourceSwitching && !query.trim() && selectedLocalRuntime === null;
  const attentionPreviewLimit = isMobileViewport
    ? MOBILE_ATTENTION_PREVIEW_LIMIT
    : ATTENTION_PREVIEW_LIMIT;

  const attentionGroups = useMemo(
    () => buildAttentionSessionGroups({
      approvalRequestedSourceSessionKeys,
      readyForReviewAgentSessionIds: effectiveReadyForReviewAgentSessionIds,
      sessions: attentionSessions,
      workIndicatorsBySourceSessionKey
    }),
    [
      approvalRequestedSourceSessionKeys,
      attentionSessions,
      effectiveReadyForReviewAgentSessionIds,
      workIndicatorsBySourceSessionKey
    ]
  );

  const attentionSessionIds = useMemo(
    () => shouldShowAttention
      ? new Set([
          ...attentionGroups.approvalRequests.slice(0, attentionPreviewLimit),
          ...attentionGroups.newResults.slice(0, attentionPreviewLimit),
          ...attentionGroups.activeAgents.slice(0, attentionPreviewLimit)
        ].map((session) => session.id))
      : new Set<string>(),
    [attentionGroups, attentionPreviewLimit, shouldShowAttention]
  );

  const recentVisibleSessions = useMemo(
    () => visibleSessions.filter((session) => !attentionSessionIds.has(session.id)),
    [attentionSessionIds, visibleSessions]
  );

  const {
    allChatsCount,
    attachedSourceSessionKeys,
    canLoadMoreSessions: canLoadMoreUnifiedSessions,
    canShowFewerSessions: canShowFewerUnifiedSessions,
    filteredSessionsCount,
    hasMoreSessions,
    hiddenSessionsCount: combinedHiddenSessionsCount,
    isListLoading,
    isListUnavailable,
    selectedSourceSessionsCount
  } = useAgentSessionsUnifiedListModel({
    agentSessionsCount: agentSessions.length,
    agentSessionsHasMore,
    agentSessionsLoadState,
    canLoadMoreSessions,
    canShowFewerSessions,
    filteredAgentSessionsCount: filteredByQuery.length,
    filteredLocalChats: filteredLocalLlmChats,
    hiddenAgentSessionsCount: hiddenSessionsCount,
    isLoadingMoreSessions,
    isSearchLoading,
    isSourceSwitching,
    localChats: localLlmChats,
    queryMatchedLocalChatsCount: queryMatchedLocalLlmChatsCount,
    managedSessions,
    query,
    selectedLocalRuntime,
    selectedSourceId,
    sourceCards,
    totalAgentSessionsCount
  });
  const [initialPanelReady, setInitialPanelReady] = useState(false);

  useEffect(() => {
    if (
      initialPanelReady ||
      isBootstrapping ||
      isListLoading ||
      (isCompactViewport && !hasLoadedAttentionAgentSessions)
    ) {
      return;
    }

    const timerId = window.setTimeout(() => {
      setInitialPanelReady(true);
    }, INITIAL_PANEL_SETTLE_MS);

    return () => window.clearTimeout(timerId);
  }, [
    hasLoadedAttentionAgentSessions,
    initialPanelReady,
    isBootstrapping,
    isCompactViewport,
    isListLoading
  ]);

  const sessionsList = (
    <AgentSessionsList
      canShowFewerSessions={canShowFewerUnifiedSessions}
      canLoadMoreSessions={canLoadMoreUnifiedSessions}
      hasMoreSessions={hasMoreSessions}
      filteredSessionsCount={filteredSessionsCount}
      hiddenSessionsCount={combinedHiddenSessionsCount}
      isLoading={isListLoading}
      isLoadingMoreSessions={isLoadingMoreSessions}
      totalSessionsCountLabel={selectedSourceSessionsCount}
      attachedSourceSessionKeys={attachedSourceSessionKeys}
      readyForReviewAgentSessionIds={effectiveReadyForReviewAgentSessionIds}
      workIndicatorsBySourceSessionKey={workIndicatorsBySourceSessionKey}
      query={query}
      selectedAgentSessionId={selectedLocalLlmChat ? "" : selectedAgentSessionId}
      selectedLocalLlmChatId={selectedLocalLlmChat?.id}
      sessions={selectedLocalRuntime ? [] : recentVisibleSessions}
      localLlmChats={filteredLocalLlmChats}
      showAllLocalLlmChats={Boolean(selectedLocalRuntime) || Boolean(query.trim())}
      title={shouldShowAttention ? "Recent work" : undefined}
      onSelectAgentSession={(sessionId) => reviewAndSelectAgentSession(
        sessionId,
        isCompactViewport && layoutMode === "viewport",
        clearSelectedLocalLlmChat,
        handleSelectAgentSession
      )}
      onOpenLocalLlmChat={setSelectedLocalLlmChat}
      onShowFewerSessions={showFewerSessions}
      onShowMoreSessions={showMoreSessions}
    />
  );

  const attentionSections = shouldShowAttention ? (
    <AgentSessionsAttention
      approvalRequestedSourceSessionKeys={approvalRequestedSourceSessionKeys}
      countIsLowerBound={hasMoreAttentionAgentSessions || agentSessionsHasMore}
      readyForReviewAgentSessionIds={effectiveReadyForReviewAgentSessionIds}
      previewLimit={attentionPreviewLimit}
      selectedAgentSessionId={selectedAgentSessionId}
      sessions={attentionSessions}
      workIndicatorsBySourceSessionKey={workIndicatorsBySourceSessionKey}
      onSelectAgentSession={(sessionId) => reviewAndSelectAgentSession(
        sessionId,
        isCompactViewport && layoutMode === "viewport",
        clearSelectedLocalLlmChat,
        handleSelectAgentSession
      )}
    />
  ) : null;
  const parentAgentSessionId = selectedAgentSessionSummary?.subagent?.parentSessionId ??
    selectedAgentSession?.subagent?.parentSessionId ??
    null;

  const transcriptPanel = hasSelectedAgentSession ? (
    <AgentTranscriptPanel
      attachedManagedSessionId={attachedManagedSessionId}
      attachedManagedSessionInfo={attachedManagedSessionInfo}
      attaching={attaching}
      onAttach={onAttachAgentSession}
      onMarkReviewed={onMarkAgentSessionReviewed}
      onOpenManagedSession={onOpenManagedSession}
      parentAgentSessionId={parentAgentSessionId}
      previewItems={isCompactViewport ? 2 : undefined}
      readyForReviewAgentSessionIds={effectiveReadyForReviewAgentSessionIds}
      selectedSessionId={selectedAgentSessionId}
      session={selectedAgentSession}
      sessionSummary={selectedAgentSessionSummary}
      subagentSupplement={
        <SubagentSessionsSupplement
          knownSessions={agentSessions}
          parentSessionId={selectedAgentSessionId || null}
          onOpenSubagentSession={onOpenSubagentSession}
        />
      }

      isLoading={isAgentSessionLoading || isSelectedAgentSessionSettling}
      loadError={selectedAgentSessionLoadError}
      onRetryLoad={onRetrySelectedAgentSession}
    />
  ) : null;

  const localLlmChatPanel = selectedLocalLlmChat ? (
    <LocalLlmChatPreview
      chat={selectedLocalLlmChat}
      runtime={
        runtimes.find((runtime) => runtime.id === selectedLocalLlmChat.runtimeId) ?? null
      }
    />
  ) : null;
  const activeTranscriptPanel = localLlmChatPanel ?? transcriptPanel;
  const showActiveMobileDetail = Boolean(localLlmChatPanel) || showFocusedMobileDetail;
  const activeSessionFocusTargetId = selectedLocalLlmChat?.id ?? selectedAgentSessionId;
  const showUnavailableListState =
    !showActiveMobileDetail &&
    !localLlmChatPanel &&
    isListUnavailable &&
    filteredLocalLlmChats.length === 0;
  const showEmptyListState =
    !showActiveMobileDetail &&
    !localLlmChatPanel &&
    filteredByQuery.length === 0 &&
    filteredLocalLlmChats.length === 0 &&
    !isListLoading;
  const focusSurfaceKey = collapsed
    ? "collapsed"
    : showActiveMobileDetail
      ? "detail"
      : showUnavailableListState
        ? "unavailable"
        : isListLoading
          ? "loading"
          : showEmptyListState ? "empty" : "list";

  useAgentBrowserCompactFocusHandoff({
    focusTargetId: activeSessionFocusTargetId,
    focusSurfaceKey,
    isCompactViewport,
    showFocusedDetail: !collapsed && showActiveMobileDetail
  });

  const mobileLayout = isCompactViewport ? (
    <AgentSessionsMobileLayout
      agentSessionId={selectedLocalLlmChat?.id ?? selectedAgentSessionId}
      agentSessionLabel={
        selectedLocalLlmChat?.title ?? formatAgentSessionTitle(selectedAgentSessionDisplay)
      }

      parentSessionId={parentAgentSessionId}
      sessionsList={sessionsList}
      showFocusedDetail={showActiveMobileDetail}
      transcriptPanel={activeTranscriptPanel}
      onBackToParent={parentAgentSessionId
        ? () => onBackToParentAgentSession(parentAgentSessionId, selectedAgentSessionId)
        : undefined}
      onBackToChats={
        selectedLocalLlmChat ? clearSelectedLocalLlmChat : handleClearAgentSessionSelection
      }
    />
  ) : null;

  const panelBody =
    isCompactViewport && showActiveMobileDetail ? (
      mobileLayout
    ) : showUnavailableListState ? (
      <AgentSessionsEmptyState
        hasSearchQuery={false}
        hasSourceSessions={false}
        isUnavailable
        onRetry={() => {
          void onReloadAgentSessions({ sourceId: selectedSourceId });
        }}
      />
    ) : showEmptyListState ? (
      <AgentSessionsEmptyState
        hasSearchQuery={Boolean(query.trim())}
        hasSourceSessions={agentSessions.length > 0}
      />
    ) : isCompactViewport ? (
      mobileLayout
    ) : (
      <AgentSessionsDesktopLayout
        sessionsList={sessionsList}
        transcriptPanel={activeTranscriptPanel}
      />
    );

  if (collapsed) {
    return (
      <div className={styles.agentBrowserFocusRoot} data-agent-browser-focus-root="">
        <CollapsedAgentSessionsPanel
          selectedAgentSession={selectedAgentSession}
          onExpand={() => setCollapsed(false)}
        />
      </div>
    );
  }

  return (
    <div className={styles.agentBrowserFocusRoot} data-agent-browser-focus-root="">
      <AgentSessionsPanelSurface
        action={(
          <div className={styles.panelActions}>
            {secondaryAction}
            {features.localLlmChats ? (
              <CreateLocalChatButton onClick={localChatCreation.open} />
            ) : null}
          </div>
        )}
        focusedDetail={isCompactViewport && showActiveMobileDetail}
      >
        {defaultCollapsed ? (
        <div className={styles.panelToolbar}>
          <button
            className={clsx(styles.button, styles.ghostButton)}
            data-chat-list-focus-owner=""
            onClick={() => setCollapsed(true)}
            type="button"
          >
            Hide chat browser
          </button>
        </div>
      ) : null}

        {!initialPanelReady ? (
        <AgentSessionsSkeleton />
      ) : (
        <div className={clsx(
          styles.mobileFlow,
          layoutMode === "embedded" ? styles.mobileFlowEmbedded : null
        )}>
          {showActiveMobileDetail ? null : attentionSections}

          {showActiveMobileDetail ? null : (
            <>
              <AgentSessionsToolbar
                isSearchLoading={isSearchLoading}
                localRuntimeTabs={localRuntimeTabs}
                query={query}
                selectedLocalRuntime={selectedLocalRuntime}
                selectedSourceId={selectedSourceId}
                sourceCards={isListUnavailable ? [] : sourceCards}
                sourceCountsUnavailable={isListUnavailable}
                totalAgentSessionsCount={allChatsCount}
                onQueryChange={setQuery}
                onSelectLocalRuntime={handleSelectLocalRuntime}
                onSelectSource={handleToolbarSourceSelection}
              />
            </>
          )}

          {panelBody}
        </div>
      )}
      </AgentSessionsPanelSurface>
      {features.localLlmChats ? <CreateLocalChatDialog
        errorMessage={localChatCreation.error}
        isOpen={localChatCreation.isOpen}
        isSubmitting={localChatCreation.submitting}
        modelErrorMessage={localChatCreation.catalog.error}
        models={localChatCreation.catalog.models.map((model) => ({
          id: model.modelKey,
          label: model.displayName
        }))}
        modelsLoadState={
          localChatCreation.catalog.status === "starting_runtime" ||
          localChatCreation.catalog.status === "loading_models"
            ? "loading"
            : localChatCreation.catalog.status
        }

        runtimes={createLocalChatRuntimes}
        selectedModelId={localChatCreation.selectedModelKey}
        selectedRuntimeId={localChatCreation.runtimeId}
        selectedWorkspaceId={localChatCreation.workspaceId}
        workspaces={createLocalChatWorkspaces}
        onClose={localChatCreation.close}
        onCreate={() => {
          void localChatCreation.create();
        }}
        onModelChange={localChatCreation.setSelectedModelKey}
        onRetryModels={localChatCreation.retryCatalog}
        onRuntimeChange={localChatCreation.setRuntimeId}
        onWorkspaceChange={localChatCreation.setWorkspaceId}
      /> : null}
    </div>
  );
}
