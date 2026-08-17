import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";

import type { LocalLlmChatSummary } from "@deskcue/protocol";
import type {
  AgentSessionsPanelProps
} from "@modules/agents/types";
import { rememberAgentBrowserListScrollTop } from "@modules/dashboard/shell/route/agentBrowserListScrollMemory";
import { LocalLlmChatPreview } from "@modules/localLlmChats";
import { AgentTranscriptPanel } from "@modules/transcript";
import { getDeskCueRuntime } from "@runtime";
import { useDeskCueLayoutMode } from "@web/layout";

import { AgentSessionsAttention } from "./attention/AgentSessionsAttention";
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
import { AgentSessionsEmptyState } from "./list/AgentSessionsEmptyState";
import { AgentSessionsList } from "./list/AgentSessionsList";
import { AgentSessionsPanelSurface } from "./loading/AgentSessionsPanelSurface";
import { AgentSessionsSkeleton } from "./loading/AgentSessionsSkeleton";
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
    readyForReviewAgentSessionIds,
    isAgentSessionLoading,
    attaching,
    attachedManagedSessionId,
    attachedManagedSessionInfo,
    defaultCollapsed = false,
    isBootstrapping,
    pendingChatPrompt,
    onAttachAgentSession,
    onMarkAgentSessionReviewed,
    onOpenManagedSession,
    onOpenLocalLlmChat,
    onReloadAgentSessions
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
    sessions: loadedAttentionAgentSessions
  } = useAttentionAgentSessionSummaries(isCompactViewport && !collapsed);
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

  const listAttention = useAgentSessionsAttentionState({
    agentSessions,
    managedSessions,
    pendingChatPrompt,
    readyForReviewAgentSessionIds
  });
  const {
    approvalRequestedSourceSessionIds,
    attentionSessions,
    effectiveReadyForReviewAgentSessionIds,
    workIndicatorsBySourceSessionId
  } = useAgentSessionsAttentionState({
    agentSessions: loadedAttentionAgentSessions,
    managedSessions,
    pendingChatPrompt,
    readyForReviewAgentSessionIds
  });
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

  function handleReviewAndSelectAgentSession(sessionId: string) {
    if (isCompactViewport && layoutMode === "viewport") {
      rememberAgentBrowserListScrollTop(window.scrollY);
    }
    clearSelectedLocalLlmChat();
    if (features.sessionCommands) onMarkAgentSessionReviewed(sessionId);
    handleSelectAgentSession(sessionId);
  }

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
      readyForReviewAgentSessionIds={listAttention.effectiveReadyForReviewAgentSessionIds}
      workIndicatorsBySourceSessionId={listAttention.workIndicatorsBySourceSessionId}
      query={query}
      selectedAgentSessionId={selectedLocalLlmChat ? "" : selectedAgentSessionId}
      selectedLocalLlmChatId={selectedLocalLlmChat?.id}
      sessions={selectedLocalRuntime ? [] : visibleSessions}
      localLlmChats={filteredLocalLlmChats}
      showAllLocalLlmChats={Boolean(selectedLocalRuntime) || Boolean(query.trim())}
      onSelectAgentSession={handleReviewAndSelectAgentSession}
      onOpenLocalLlmChat={setSelectedLocalLlmChat}
      onShowFewerSessions={showFewerSessions}
      onShowMoreSessions={showMoreSessions}
    />
  );

  const attentionSections = isCompactViewport ? (
    <AgentSessionsAttention
      approvalRequestedSourceSessionIds={approvalRequestedSourceSessionIds}
      readyForReviewAgentSessionIds={effectiveReadyForReviewAgentSessionIds}
      selectedAgentSessionId={selectedAgentSessionId}
      sessions={attentionSessions}
      workIndicatorsBySourceSessionId={workIndicatorsBySourceSessionId}
      onSelectAgentSession={handleReviewAndSelectAgentSession}
    />
  ) : null;

  const transcriptPanel = hasSelectedAgentSession ? (
    <AgentTranscriptPanel
      attachedManagedSessionId={attachedManagedSessionId}
      attachedManagedSessionInfo={attachedManagedSessionInfo}
      attaching={attaching}
      onAttach={onAttachAgentSession}
      onOpenManagedSession={onOpenManagedSession}
      previewItems={isCompactViewport ? 2 : undefined}
      session={selectedAgentSession}
      sessionSummary={selectedAgentSessionSummary}
      isLoading={isAgentSessionLoading || isSelectedAgentSessionSettling}
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

  const panelBody =
    !localLlmChatPanel && isListUnavailable && filteredLocalLlmChats.length === 0 ? (
      <AgentSessionsEmptyState
        hasSearchQuery={false}
        hasSourceSessions={false}
        isUnavailable
        onRetry={() => {
          void onReloadAgentSessions({ sourceId: selectedSourceId });
        }}
      />
    ) : !localLlmChatPanel && filteredByQuery.length === 0 && filteredLocalLlmChats.length === 0 && !isListLoading ? (
      <AgentSessionsEmptyState
        hasSearchQuery={Boolean(query.trim())}
        hasSourceSessions={agentSessions.length > 0}
      />
    ) : isCompactViewport ? (
      <AgentSessionsMobileLayout
        agentSessionId={selectedLocalLlmChat?.id ?? selectedAgentSessionId}
        agentSessionLabel={
          selectedLocalLlmChat?.title ?? selectedAgentSessionDisplay?.title ?? ""
        }
        sessionsList={sessionsList}
        showFocusedDetail={showActiveMobileDetail}
        transcriptPanel={activeTranscriptPanel}
        onBackToChats={selectedLocalLlmChat ? clearSelectedLocalLlmChat : handleClearAgentSessionSelection}
      />
    ) : (
      <AgentSessionsDesktopLayout
        sessionsList={sessionsList}
        transcriptPanel={activeTranscriptPanel}
      />
    );

  if (collapsed) {
    return (
      <CollapsedAgentSessionsPanel
        selectedAgentSession={selectedAgentSession}
        onExpand={() => setCollapsed(false)}
      />
    );
  }

  return (
    <>
      <AgentSessionsPanelSurface
        action={features.localLlmChats ? (
          <CreateLocalChatButton onClick={localChatCreation.open} />
        ) : null}
      >
        {defaultCollapsed ? (
        <div className={styles.panelToolbar}>
          <button
            className={clsx(styles.button, styles.ghostButton)}
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
    </>
  );
}
