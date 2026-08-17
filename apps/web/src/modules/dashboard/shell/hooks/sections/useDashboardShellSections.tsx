import { Suspense } from "react";

import { AgentSessionsPanelLoading } from "@modules/agents";
import { DashboardHomeTabs } from "@modules/dashboard/shell/DashboardHomeTabs";
import {
  ManagedSessionShell
} from "@modules/dashboard/shell/ManagedSessionShell";
import { SecondaryToolsShell } from "@modules/dashboard/shell/SecondaryToolsShell";
import { getDeskCueRuntime } from "@runtime";

import {
  LazyAgentBrowserShell,
  LazyLiveSessionOverlay
} from "./dashboardShellLazyComponents";
import {
  buildAgentBrowserShellProps,
  buildManagedSessionShellProps,
  buildSecondaryToolsShellProps
} from "./helpers";
import type { UseDashboardShellSectionsArgs } from "./types";

export function useDashboardShellSections({
  overview,
  agentBrowser,
  managedSession,
  manualRunner,
  prompt,
  agentBrowserActions,
  managedSessionActions,
  manualRunnerActions,
  agentBrowserLoaders,
  route,
  routeActions
}: UseDashboardShellSectionsArgs) {
  const sectionProps = {
    agentSessions: agentBrowser.agentSessions,
    agentSessionsHasMore: agentBrowser.agentSessionsHasMore,
    agentSessionsLoadState: agentBrowser.agentSessionsLoadState,
    agentSessionsQuery: agentBrowser.agentSessionsQuery,
    agentSessionsTotalCountLabel: agentBrowser.agentSessionsTotalCountLabel,
    filteredAgentSessions: agentBrowser.filteredAgentSessions,
    readyForReviewAgentSessionIds: agentBrowser.readyForReviewAgentSessionIds,
    sourceCards: overview.sourceCards,
    effectiveSelectedSourceId: route.effectiveSelectedSourceId,
    initialManagedSessionLoadState: route.initialManagedSessionLoadState,
    effectiveSelectedAgentSessionId: route.effectiveSelectedAgentSessionId,
    selectedAgentSession: agentBrowser.selectedAgentSession,
    isAgentSessionLoading: agentBrowser.isAgentSessionLoading,
    isOpeningSelectedAgentSession: route.isOpeningSelectedAgentSession,
    attachedManagedSessionId: route.attachedManagedSessionId,
    attachedManagedSessionInfo: route.attachedManagedSessionInfo,
    isBootstrapping: overview.isBootstrapping,
    managedSessions: managedSession.managedSessions,
    effectiveSelectedSessionId: route.effectiveSelectedSessionId,
    selectedSession: managedSession.selectedSession,
    takenOverAgentSession: route.takenOverAgentSession,
    agentTranscriptHasMoreById: agentBrowser.agentTranscriptHasMoreById,
    isTakenOverAgentSessionLoading: route.isTakenOverAgentSessionLoading,
    liveUpdatesConnection: managedSession.liveUpdatesConnection,
    activeTab: managedSession.activeTab,
    previewPort: managedSession.previewPort,
    pendingChatPrompt: prompt.pendingChatPrompt,
    isWaitingForChatReply: prompt.isWaitingForChatReply,
    isInterruptingPrompt: prompt.isInterruptingPrompt,
    immediateInterruptPrompt: prompt.immediateInterruptPrompt,
    showLiveTools: route.showLiveTools,
    workspacePath: manualRunner.workspacePath,
    loading: manualRunner.loading,
    pickingWorkspace: manualRunner.pickingWorkspace,
    canOpenNativeDialogs: overview.canOpenNativeDialogs,
    selectedWorkspaceId: manualRunner.selectedWorkspaceId,
    workspaces: overview.overview.workspaces,
    command: manualRunner.command,
    runtimes: overview.visibleRuntimes,
    hasManagedFocus: route.hasManagedFocus,
    isDashboardPinned: route.isDashboardPinned,
    activeLiveOverlay: route.activeLiveOverlay,
    onSelectSource: routeActions.onSelectSource,
    onLoadMoreAgentSessions: agentBrowserLoaders.loadMoreAgentSessions,
    onReloadAgentSessions: agentBrowserLoaders.loadAgentSessions,
    onSearchAgentSessions: agentBrowserLoaders.searchAgentSessions,
    onMarkAgentSessionReviewed: agentBrowserActions.markAgentSessionReviewed,
    onSelectAgentSession: routeActions.onSelectAgentSession,
    onClearAgentSessionSelection: routeActions.onClearAgentSessionSelection,
    onAttachSelectedAgentSession: routeActions.onAttachSelectedAgentSession,
    onOpenManagedSession: routeActions.onOpenManagedSession,
    onOpenLocalLlmChat: routeActions.onOpenLocalLlmChat,
    onSelectManagedSession: routeActions.onSelectManagedSession,
    onSelectSessionTab: routeActions.onSelectSessionTab,
    onSendInput: routeActions.onSendInput,
    onHydrateAgentSessionChanges: agentBrowserActions.hydrateAgentSessionChanges,
    onHydrateAgentSessionTranscriptEntries: agentBrowserActions.hydrateAgentSessionTranscriptEntries,
    onLoadMoreAgentSessionTranscript: agentBrowserActions.loadMoreAgentSessionTranscript,
    onInterruptPrompt: routeActions.onInterruptPrompt,
    onStopSession: routeActions.onStopSession,
    onStopAndExitSession: routeActions.onStopAndExitSession,
    onExitSession: routeActions.onExitSession,
    onRefreshGit: managedSessionActions.handleRefreshGit,
    onRetryInitialManagedSessionLoad: managedSessionActions.retryInitialManagedSessionLoad,
    onChangePreviewPort: managedSessionActions.setPreviewPort,
    onChangePreviewNetworkMode: managedSessionActions.handleChangePreviewNetworkMode,
    onSetPreview: managedSessionActions.handleSetPreview,
    onStopPreview: managedSessionActions.handleStopPreview,
    onToggleLiveTools: routeActions.onToggleLiveTools,
    onChangeWorkspacePath: manualRunnerActions.setWorkspacePath,
    onPickWorkspace: manualRunnerActions.handlePickWorkspace,
    onAddWorkspace: manualRunnerActions.handleAddWorkspace,
    onSelectWorkspace: manualRunnerActions.setSelectedWorkspaceId,
    onChangeCommand: manualRunnerActions.setCommand,
    onStartSession: manualRunnerActions.handleStartSession,
    onCloseLiveOverlays: routeActions.onCloseLiveOverlays
  };
  const agentBrowserShellProps = buildAgentBrowserShellProps(sectionProps);
  const managedSessionShellProps = buildManagedSessionShellProps(sectionProps);
  const secondaryToolsShellProps = buildSecondaryToolsShellProps(sectionProps);

  const shouldRenderAgentBrowser = !route.hasManagedFocus;
  const shouldRenderTools =
    route.showLiveTools ||
    route.activeLiveOverlay === "tools" ||
    !route.hasManagedFocus;
  const runtimeFeatures = getDeskCueRuntime().features;
  const hasSecondaryTools =
    runtimeFeatures.manualRunner ||
    runtimeFeatures.localRuntimes ||
    runtimeFeatures.workspaceManagement;
  const showSecondaryManagedSession =
    !route.isDashboardPinned && Boolean(route.effectiveSelectedSessionId);

  const agentBrowserPanelFallback = <AgentSessionsPanelLoading />;
  const secondaryToolsPanel = shouldRenderTools && hasSecondaryTools ? (
    <SecondaryToolsShell {...secondaryToolsShellProps} />
  ) : null;
  const focusedManagedSessionPanel = route.hasManagedFocus ? (
    <ManagedSessionShell
      {...managedSessionShellProps}
      onToggleTools={routeActions.onToggleLiveTools}
      showTools={route.showLiveTools}
    />
  ) : null;

  const secondaryManagedSessionPanel = showSecondaryManagedSession ? (
    <ManagedSessionShell {...managedSessionShellProps} />
  ) : null;
  const liveOverlay = route.activeLiveOverlay ? (
    <Suspense fallback={null}>
      <LazyLiveSessionOverlay
        onClose={routeActions.onCloseLiveOverlays}
        toolsContent={secondaryToolsPanel}
      />
    </Suspense>
  ) : null;

  return {
    agentBrowserShell: shouldRenderAgentBrowser ? (
      route.hasManagedFocus ? (
        <Suspense fallback={agentBrowserPanelFallback}>
          <LazyAgentBrowserShell
            {...agentBrowserShellProps}
            defaultCollapsed
          />
        </Suspense>
      ) : (
        <DashboardHomeTabs
          chatsContent={
            <Suspense fallback={agentBrowserPanelFallback}>
              <LazyAgentBrowserShell {...agentBrowserShellProps} />
            </Suspense>
          }
          toolsContent={secondaryToolsPanel}
        />
      )
    ) : null,
    focusedManagedSessionShell: focusedManagedSessionPanel,
    liveOverlay,
    secondaryManagedSessionShell: secondaryManagedSessionPanel,
    showSecondaryManagedSession
  };
}
