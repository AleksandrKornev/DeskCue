import {
  useCallback,
  useEffect
} from "react";

import type { UseDashboardRouteSyncArgs } from "@modules/dashboard/shell/route/types";
import { dashboardNavigationStore } from "@modules/dashboard/shell/store/dashboardNavigationStore";

import {
  applySelectionRouteSyncAction,
  resolveAgentRouteSyncActions,
  resolveDashboardRouteNavigationAction,
  resolveOpeningAgentRouteSyncActions,
  resolvePendingSendRouteSyncAction,
  resolveSessionRouteSyncActions,
  resolveSourceRouteSyncActions
} from "./helpers";

export function useDashboardRouteSync({
  routeState,
  activeLiveOverlay,
  activeTab,
  effectiveSelectedSessionId,
  hasImplicitManagedAgentSessionSelection,
  hasManagedFocus,
  isBootstrapping,
  isDashboardPinned,
  isRouteSessionKnownStopped,
  locationPathname,
  locationSearch,
  selectedAgentSessionId,
  selectedSessionId,
  selectedSourceId,
  openingAgentSessionId,
  navigate,
  navigateToRoute,
  setActiveTab,
  setSelectedAgentSessionId,
  setSelectedSessionId,
  setSelectedSourceId,
}: UseDashboardRouteSyncArgs) {
  const {
    pendingSendRouteSync,
    pendingDashboardExit,
    pendingSessionTabSelection,
    pendingSourceRouteSelection,
    pendingAgentRouteSelection
  } = dashboardNavigationStore;
  const applySelectionAction = useCallback((action: Parameters<typeof applySelectionRouteSyncAction>[0]["action"]) => {
    applySelectionRouteSyncAction({
      action,
      clearPendingAgentRouteSelection: () =>
        dashboardNavigationStore.setPendingAgentRouteSelection(""),
      clearPendingSessionTabSelection: () =>
        dashboardNavigationStore.setPendingSessionTabSelection(""),
      clearPendingSourceRouteSelection: () =>
        dashboardNavigationStore.setPendingSourceRouteSelection(""),
      clearOpeningAgentSessionId: () => dashboardNavigationStore.setOpeningAgentSessionId(""),
      setActiveTab,
      setSelectedAgentSessionId,
      setSelectedSessionId,
      setSelectedSourceId
    });
  }, [
    setActiveTab,
    setSelectedAgentSessionId,
    setSelectedSessionId,
    setSelectedSourceId
  ]);

  useEffect(() => {
    resolveSourceRouteSyncActions({
      pendingSourceRouteSelection,
      routeSourceId: routeState.sourceId,
      selectedSourceId
    }).forEach(applySelectionAction);
  }, [
    applySelectionAction,
    pendingSourceRouteSelection,
    routeState.sourceId,
    selectedSourceId
  ]);

  useEffect(() => {
    resolveAgentRouteSyncActions({
      hasImplicitManagedAgentSessionSelection,
      isRouteSessionKnownStopped,
      pendingAgentRouteSelection,
      routeAgentSessionId: routeState.agentSessionId,
      selectedAgentSessionId
    }).forEach(applySelectionAction);
  }, [
    applySelectionAction,
    hasImplicitManagedAgentSessionSelection,
    isRouteSessionKnownStopped,
    pendingAgentRouteSelection,
    routeState.agentSessionId,
    selectedAgentSessionId
  ]);

  useEffect(() => {
    resolveOpeningAgentRouteSyncActions({
      hasManagedFocus,
      openingAgentSessionId,
      routeKind: routeState.kind
    }).forEach(applySelectionAction);
  }, [applySelectionAction, hasManagedFocus, openingAgentSessionId, routeState.kind]);

  useEffect(() => {
    resolveSessionRouteSyncActions({
      activeTab,
      isDashboardPinned,
      isRouteSessionKnownStopped,
      pendingSendRouteSync,
      pendingSessionTabSelection,
      routeState,
      selectedSessionId
    }).forEach(applySelectionAction);
  }, [
    applySelectionAction,
    activeTab,
    isDashboardPinned,
    isRouteSessionKnownStopped,
    pendingSendRouteSync,
    pendingSessionTabSelection,
    routeState,
    routeState.kind,
    routeState.sessionId,
    routeState.tab,
    selectedSessionId
  ]);

  useEffect(() => {
    const action = resolvePendingSendRouteSyncAction({
      pendingSendRouteSync,
      routeState,
      selectedSessionId
    });

    if (action.kind === "none") {
      return;
    }

    dashboardNavigationStore.setPendingSendRouteSync(false);
    dashboardNavigationStore.setIsDashboardPinned(false);
    setActiveTab("overview");
    navigateToRoute(
      {
        kind: "session",
        sessionId: action.sessionId,
        tab: "overview",
        overlay: null
      },
      {
        replace: true
      }
    );
  }, [
    pendingSendRouteSync,
    routeState,
    routeState.kind,
    routeState.sessionId,
    selectedSessionId,
    navigateToRoute,
    setActiveTab
  ]);

  useEffect(() => {
    const action = resolveDashboardRouteNavigationAction({
      activeTab,
      effectiveSelectedSessionId,
      hasImplicitManagedAgentSessionSelection,
      hasManagedFocus,
      isBootstrapping,
      isDashboardPinned,
      locationPathname,
      locationSearch,
      openingAgentSessionId,
      pendingDashboardExit,
      routeState,
      selectedAgentSessionId,
      selectedSessionId,
      selectedSourceId
    });

    if (action.kind === "none") {
      return;
    }

    if (action.kind === "clear-dashboard-exit") {
      dashboardNavigationStore.setPendingDashboardExit(false);
      return;
    }

    if (action.kind === "unpin-dashboard") {
      dashboardNavigationStore.setIsDashboardPinned(false);
      return;
    }

    if (action.kind === "navigate-dashboard-root") {
      navigate(
        {
          pathname: "/",
          search: ""
        },
        {
          replace: true
        }
      );
      return;
    }

    if (action.kind === "navigate-selected-session") {
      navigateToRoute(
        {
          kind: "session",
          sessionId: action.sessionId,
          tab: action.tab,
          sourceId: action.sourceId,
          agentSessionId: action.agentSessionId,
          overlay: null
        },
        {
          replace: true
        }
      );
      return;
    }

    if (action.kind === "navigate-dashboard") {
      navigateToRoute(
        {
          kind: "dashboard",
          overlay: null
        },
        {
          replace: true
        }
      );
      return;
    }

    navigateToRoute(
      {
        kind: "dashboard",
        sourceId: action.sourceId,
        agentSessionId: action.agentSessionId,
        overlay: null
      },
      {
        replace: true
      }
    );
  }, [
    activeLiveOverlay,
    activeTab,
    effectiveSelectedSessionId,
    hasImplicitManagedAgentSessionSelection,
    hasManagedFocus,
    isBootstrapping,
    isDashboardPinned,
    isRouteSessionKnownStopped,
    locationPathname,
    locationSearch,
    pendingDashboardExit,
    routeState,
    routeState.kind,
    routeState.agentSessionId,
    routeState.sessionId,
    routeState.sourceId,
    routeState.tab,
    selectedAgentSessionId,
    selectedSessionId,
    selectedSourceId,
    openingAgentSessionId,
    navigate,
    navigateToRoute,
    setSelectedAgentSessionId,
    setSelectedSessionId,
    setSelectedSourceId
  ]);
}
