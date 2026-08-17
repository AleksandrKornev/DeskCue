import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";
import type { NavigateOptions, To } from "react-router";

import {
  useDashboardRouteActions,
  useDashboardRouteSync,
  useDashboardRouteViewModel
} from "@modules/dashboard/shell/route";
import { dashboardNavigationStore } from "@modules/dashboard/shell/store/dashboardNavigationStore";
import { useDeskCueRuntime } from "@runtime";

import type { UseDashboardShellRouteOrchestrationArgs } from "./types";

export function useDashboardShellRouteOrchestration({
  dashboard,
  routeState
}: UseDashboardShellRouteOrchestrationArgs) {
  const routerNavigate = useNavigate();
  const runtime = useDeskCueRuntime();
  const location = useLocation();
  const locationPathname = runtime.readAppPath(location.pathname);
  const navigate = useCallback((to: To | number, options?: NavigateOptions) => {
    if (typeof to === "number") {
      routerNavigate(to);
      return;
    }
    if (typeof to === "string") {
      routerNavigate(to.startsWith("/") ? runtime.buildAppPath(to) : to, options);
      return;
    }
    routerNavigate({
      ...to,
      pathname: to.pathname?.startsWith("/")
        ? runtime.buildAppPath(to.pathname)
        : to.pathname
    }, options);
  }, [routerNavigate, runtime]);
  const {
    isAgentBrowserListMode,
    isDashboardPinned,
    openingAgentSessionId
  } = dashboardNavigationStore;

  const {
    overview,
    agentBrowser,
    managedSession,
    agentBrowserActions,
    managedSessionActions,
    manualRunnerActions
  } = dashboard;

  const routeViewModel = useDashboardRouteViewModel({
    routeState,
    overviewSessions: overview.overview.sessions,
    managedSessions: managedSession.managedSessions,
    selectedSourceId: agentBrowser.selectedSourceId,
    selectedSessionId: managedSession.selectedSessionId,
    selectedSession: managedSession.selectedSession,
    selectedAgentSessionId: agentBrowser.selectedAgentSessionId,
    selectedAgentSession: agentBrowser.selectedAgentSession,
    activeTakenOverAgentSession: agentBrowser.activeTakenOverAgentSession,
    isActiveTakenOverAgentSessionLoading: agentBrowser.isActiveTakenOverAgentSessionLoading,
    isAgentSessionLoading: agentBrowser.isAgentSessionLoading,
    isAgentBrowserListMode,
    isDashboardPinned,
    attachingAgentSessionId: agentBrowser.attachingAgentSessionId,
    openingAgentSessionId,
    isBootstrapping: overview.isBootstrapping,
    initialManagedSessionLoadState: overview.initialManagedSessionLoadState
  });

  const {
    isRouteSessionKnownStopped,
    effectiveSelectedSessionId,
    effectiveSelectedAgentSessionId,
    hasManagedFocus,
    hasImplicitManagedAgentSessionSelection,
    activeLiveOverlay
  } = routeViewModel;

  const routeActions = useDashboardRouteActions({
    activeLiveOverlay,
    activeTab: managedSession.activeTab,
    effectiveSelectedAgentSessionId,
    effectiveSelectedSessionId,
    locationPathname,
    locationSearch: location.search,
    managedSessions: managedSession.managedSessions,
    routeState,
    selectedAgentSessionId: agentBrowser.selectedAgentSessionId,
    selectedSourceId: agentBrowser.selectedSourceId,
    handleAttachAgentSession: manualRunnerActions.handleAttachAgentSession,
    handleSendInput: managedSessionActions.handleSendInput,
    handleStopSession: managedSessionActions.handleStopSession,
    navigate,
    setActiveTab: managedSessionActions.setActiveTab,
    setSelectedAgentSession: agentBrowserActions.setSelectedAgentSession,
    setSelectedAgentSessionId: agentBrowserActions.setSelectedAgentSessionId,
    setSelectedSession: managedSessionActions.setSelectedSession,
    setSelectedSessionId: managedSessionActions.setSelectedSessionId,
    setSelectedSourceId: agentBrowserActions.setSelectedSourceId
  });

  useDashboardRouteSync({
    routeState,
    activeLiveOverlay,
    activeTab: managedSession.activeTab,
    effectiveSelectedSessionId,
    hasImplicitManagedAgentSessionSelection,
    hasManagedFocus,
    isBootstrapping: overview.isBootstrapping,
    isDashboardPinned,
    isRouteSessionKnownStopped,
    locationPathname,
    locationSearch: location.search,
    selectedAgentSessionId: agentBrowser.selectedAgentSessionId,
    selectedSessionId: managedSession.selectedSessionId,
    selectedSourceId: agentBrowser.selectedSourceId,
    openingAgentSessionId,
    navigate,
    navigateToRoute: routeActions.navigateToRoute,
    setActiveTab: managedSessionActions.setActiveTab,
    setSelectedAgentSessionId: agentBrowserActions.setSelectedAgentSessionId,
    setSelectedSessionId: managedSessionActions.setSelectedSessionId,
    setSelectedSourceId: agentBrowserActions.setSelectedSourceId,
  });

  return {
    ...routeViewModel,
    ...routeActions,
    isDashboardPinned
  };
}
