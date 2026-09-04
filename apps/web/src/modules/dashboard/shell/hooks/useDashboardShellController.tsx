import { useCallback, useState } from "react";

import {
  countRunningAgentChats,
  isManagedSessionActivelyAttached
} from "@models/agentChatWorkState";
import { DashboardBootShell } from "@modules/dashboard/shell/DashboardBootShell";
import { readSubagentParentSessionId } from "@modules/dashboard/shell/route/helpers";
import { dashboardNavigationStore } from "@modules/dashboard/shell/store/dashboardNavigationStore";

import { useDashboardShellDisplayState } from "./display/useDashboardShellDisplayState";
import { useDashboardRouteScrollReset } from "./route/useDashboardRouteScrollReset";
import { useDashboardShellRouteOrchestration } from "./route/useDashboardShellRouteOrchestration";
import { useDashboardShellSections } from "./sections/useDashboardShellSections";
import type { UseDashboardShellControllerArgs } from "./types";
import { useDashboardCompactViewport } from "./viewport/useDashboardCompactViewport";

export function useDashboardShellController({
  dashboard,
  routeState
}: UseDashboardShellControllerArgs) {
  const {
    overview,
    agentBrowser,
    managedSession,
    manualRunner,
    prompt,
    agentBrowserActions,
    managedSessionActions,
    manualRunnerActions,
    agentBrowserLoaders
  } = dashboard;

  const {
    effectiveSelectedSessionId,
    effectiveSelectedAgentSessionId,
    isOpeningSelectedAgentSession,
    initialManagedSessionLoadState,
    effectiveSelectedSourceId,
    attachedManagedSessionId,
    attachedManagedSessionInfo,
    hasManagedFocus,
    activeLiveOverlay,
    showLiveTools,
    showBootstrapShell,
    takenOverAgentSessionForPanel,
    isTakenOverAgentSessionLoading,
    isDashboardPinned,
    closeLiveOverlays,
    toggleLiveTools,
    handleBackToParentAgentSession,
    handleSelectManagedSession,
    handleSelectSessionTab,
    handleSelectSource,
    handleSelectAgentSession,
    handleClearAgentSessionSelection,
    handleOpenManagedSession,
    handleOpenSubagentSession,
    handleOpenLocalLlmChat,
    handleGoHome,
    handleExitSession: handleRouteExitSession,
    handleStopSession: handleRouteStopSession,
    handleStopAndExitSession: handleRouteStopAndExitSession,
    handleAttachSelectedAgentSession,
    handleSendInputAndSyncRoute
  } = useDashboardShellRouteOrchestration({ dashboard, routeState });
  const isCompactViewport = useDashboardCompactViewport();
  const [isExitingToDashboardFrame, setIsExitingToDashboardFrame] = useState(false);
  const isExitingToDashboard =
    isExitingToDashboardFrame || dashboardNavigationStore.pendingDashboardExit;
  const {
    displayHasManagedFocus,
    displayIsAgentSessionLoading,
    displaySelectedAgentSession,
    displaySelectedAgentSessionId,
    displaySelectedSession,
    displaySelectedSessionId,
    shouldShowBootstrapShell,
    shouldShowHeader
  } = useDashboardShellDisplayState({
    activeTab: managedSession.activeTab,
    effectiveSelectedAgentSessionId,
    effectiveSelectedSessionId,
    hasManagedFocus,
    isAgentSessionLoading: agentBrowser.isAgentSessionLoading,
    isBootstrapping: overview.isBootstrapping,
    initialManagedSessionLoadState,
    isCompactViewport,
    isExitingToDashboard,
    isTakenOverAgentSessionLoading,
    routeState,
    selectedAgentSession: agentBrowser.selectedAgentSession,
    selectedSession: managedSession.selectedSession,
    showBootstrapShell,
    takenOverAgentSessionForPanel
  });

  useDashboardRouteScrollReset({
    isExitingToDashboardFrame,
    routeState,
    setIsExitingToDashboardFrame
  });

  const handleExitSession = useCallback(() => {
    setIsExitingToDashboardFrame(true);
    handleRouteExitSession();
  }, [handleRouteExitSession]);

  const handleStopAndExitSession = useCallback(async (options?: {
    subagentParentSessionId?: string;
    subagentSessionId?: string;
  }) => {
    setIsExitingToDashboardFrame(true);
    await handleRouteStopAndExitSession(options);
  }, [handleRouteStopAndExitSession]);

  const handleStartSessionAndSyncRoute = useCallback(
    async (event: React.SubmitEvent<HTMLFormElement>) => {
      await manualRunnerActions.handleStartSession(event);
    },
    [manualRunnerActions]
  );

  const subagentParentSessionId = readSubagentParentSessionId(
    window.history.state,
    displaySelectedAgentSessionId
  );

  const sections = useDashboardShellSections({
    overview,
    agentBrowser: {
      ...agentBrowser,
      selectedAgentSession: displaySelectedAgentSession,
      isAgentSessionLoading: displayIsAgentSessionLoading
    },
    managedSession: {
      ...managedSession,
      selectedSession: displaySelectedSession
    },
    manualRunner,
    prompt,
    agentBrowserActions,
    managedSessionActions,
    manualRunnerActions: {
      ...manualRunnerActions,
      handleStartSession: handleStartSessionAndSyncRoute
    },
    agentBrowserLoaders,
    route: {
      activeLiveOverlay,
      attachedManagedSessionId,
      attachedManagedSessionInfo,
      effectiveSelectedAgentSessionId: displaySelectedAgentSessionId,
      effectiveSelectedSessionId: displaySelectedSessionId,
      effectiveSelectedSourceId,
      initialManagedSessionLoadState,
      hasManagedFocus: displayHasManagedFocus,
      isDashboardPinned,
      isOpeningSelectedAgentSession,
      isTakenOverAgentSessionLoading,
      showLiveTools,
      subagentParentSessionId,
      takenOverAgentSession: takenOverAgentSessionForPanel
    },
    routeActions: {
      onAttachSelectedAgentSession: handleAttachSelectedAgentSession,
      onBackToParentAgentSession: handleBackToParentAgentSession,
      onClearAgentSessionSelection: handleClearAgentSessionSelection,
      onCloseLiveOverlays: closeLiveOverlays,
      onExitSession: handleExitSession,
      onInterruptPrompt: managedSessionActions.handleInterruptPrompt,
      onOpenManagedSession: handleOpenManagedSession,
      onOpenSubagentSession: handleOpenSubagentSession,
      onOpenLocalLlmChat: handleOpenLocalLlmChat,
      onSelectAgentSession: handleSelectAgentSession,
      onSelectManagedSession: handleSelectManagedSession,
      onSelectSessionTab: handleSelectSessionTab,
      onSelectSource: handleSelectSource,
      onSendInput: handleSendInputAndSyncRoute,
      onStopAndExitSession: handleStopAndExitSession,
      onStopSession: handleRouteStopSession,
      onToggleLiveTools: toggleLiveTools
    }
  });

  return {
    showHeader: shouldShowHeader,
    headerProps: {
      discoveredCount: agentBrowser.agentSessionsTotalCountLabel,
      managedCount: managedSession.managedSessions.filter(isManagedSessionActivelyAttached).length,
      runningChatCount: countRunningAgentChats({
        agentSessions: agentBrowser.agentSessions,
        managedSessions: managedSession.managedSessions
      }),
      isBootstrapping: overview.isBootstrapping,
      isFocusedChat: displayHasManagedFocus,
      isBootShell: shouldShowBootstrapShell,
      onGoHome: handleGoHome
    },
    error: overview.error,
    contentLayoutProps: {
      hasManagedFocus: displayHasManagedFocus,
      showBootstrapShell: shouldShowBootstrapShell,
      showSecondaryManagedSession: sections.showSecondaryManagedSession,
      bootShell: <DashboardBootShell />,
      focusedManagedSessionShell: sections.focusedManagedSessionShell,
      liveOverlay: sections.liveOverlay,
      agentBrowserShell: sections.agentBrowserShell,
      secondaryManagedSessionShell: sections.secondaryManagedSessionShell
    }
  };
}
