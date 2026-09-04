import { useCallback } from "react";
import { flushSync } from "react-dom";

import type { AgentKind } from "@deskcue/protocol";
import {
  buildRouteSearch,
  buildSessionPath
} from "@models/dashboardRoute";
import type { SessionTab } from "@models/sessionTabs";
import { dashboardNavigationStore } from "@modules/dashboard/shell/store/dashboardNavigationStore";

import {
  createManagedSessionNavigation,
  createSubagentNavigationState,
  readCurrentHistoryIndex,
  readSubagentParentHistoryDelta,
  readSubagentParentSessionId,
  resetDashboardScroll
} from "./helpers";
import type {
  AgentSessionNavigationOptions,
  ManagedSessionNavigationOptions,
  UseDashboardRouteSelectionActionsArgs
} from "./types";

export function useDashboardRouteSelectionActions({
  activeLiveOverlay,
  activeTab,
  effectiveSelectedAgentSessionId,
  effectiveSelectedSessionId,
  managedSessions,
  navigate,
  navigateToRoute,
  routeState,
  selectedSourceId,
  setActiveTab,
  setSelectedAgentSession,
  setSelectedAgentSessionId,
  setSelectedSession,
  setSelectedSessionId,
  setSelectedSourceId
}: UseDashboardRouteSelectionActionsArgs) {
  const getManagedSessionAgentSessionId = useCallback(
    (sessionId: string) => {
      const session = managedSessions.find((managedSession) => managedSession.id === sessionId);

      return session?.sourceSessionId && session.adapterId
        ? `${session.adapterId}:${session.sourceSessionId}`
        : "";
    },
    [managedSessions]
  );

  const handleSelectManagedSession = useCallback(
    (sessionId: string) => {
      dashboardNavigationStore.setIsAgentBrowserListMode(false);
      dashboardNavigationStore.setIsDashboardPinned(false);
      const agentSessionId = getManagedSessionAgentSessionId(sessionId);

      setSelectedAgentSessionId(agentSessionId);

      setSelectedSessionId(sessionId);
      navigateToRoute({
        kind: "session",
        agentSessionId,
        sessionId,
        tab: activeTab,
        overlay: null
      });
    },
    [
      activeTab,
      getManagedSessionAgentSessionId,
      navigateToRoute,
      setSelectedAgentSessionId,
      setSelectedSessionId
    ]
  );

  const handleSelectSessionTab = useCallback(
    (tab: SessionTab) => {
      dashboardNavigationStore.setPendingSessionTabSelection(tab);
      dashboardNavigationStore.setIsDashboardPinned(false);
      setActiveTab(tab);
      if (!effectiveSelectedSessionId) {
        return;
      }

      navigateToRoute({
        kind: "session",
        sessionId: effectiveSelectedSessionId,
        tab
      });
    },
    [effectiveSelectedSessionId, navigateToRoute, setActiveTab]
  );

  const handleSelectSource = useCallback(
    (sourceId: AgentKind | "all") => {
      dashboardNavigationStore.setPendingSourceRouteSelection(sourceId);
      dashboardNavigationStore.setIsDashboardPinned(true);
      setSelectedSessionId("");
      setSelectedSession(null);
      setSelectedAgentSessionId("");
      setSelectedAgentSession(null);
      setActiveTab("overview");
      setSelectedSourceId(sourceId);
      navigate({
        pathname: "/",
        search: buildRouteSearch({
          sourceId,
          agentSessionId: "",
          overlay: null
        })
      });
    },
    [
      navigate,
      setActiveTab,
      setSelectedAgentSession,
      setSelectedAgentSessionId,
      setSelectedSession,
      setSelectedSessionId,
      setSelectedSourceId
    ]
  );

  const handleSelectAgentSession = useCallback(
    (agentSessionId: string, options?: AgentSessionNavigationOptions) => {
      resetDashboardScroll();
      dashboardNavigationStore.setIsAgentBrowserListMode(false);
      dashboardNavigationStore.setIsDashboardPinned(true);
      dashboardNavigationStore.setPendingAgentRouteSelection(agentSessionId);
      setSelectedSessionId("");
      setSelectedSession(null);
      setSelectedAgentSessionId(agentSessionId);
      setActiveTab("overview");
      navigate(
        {
          pathname: "/",
          search: buildRouteSearch({
            sourceId: selectedSourceId,
            agentSessionId,
            overlay: null
          })
        },
        {
          replace: options?.replace ?? false,
          state: options?.subagentParentSessionId
            ? createSubagentNavigationState(
                options.subagentParentSessionId,
                agentSessionId,
                "history",
                readCurrentHistoryIndex(window.history.state)
              )
            : undefined
        }
      );
    },
    [
      navigate,
      selectedSourceId,
      setActiveTab,
      setSelectedAgentSessionId,
      setSelectedSession,
      setSelectedSessionId
    ]
  );

  const handleOpenSubagentSession = useCallback((parentSessionId: string, childSessionId: string) => {
    handleSelectAgentSession(childSessionId, {
      subagentParentSessionId: parentSessionId
    });
  }, [handleSelectAgentSession]);

  const handleBackToParentAgentSession = useCallback((
    parentSessionId: string,
    childSessionId: string
  ) => {
    const parentHistoryDelta = readSubagentParentHistoryDelta(
      window.history.state,
      parentSessionId,
      childSessionId
    );

    if (parentHistoryDelta !== null) {
      navigate(parentHistoryDelta);

      return;
    }

    handleSelectAgentSession(parentSessionId, { replace: true });
  }, [handleSelectAgentSession, navigate]);

  const handleClearAgentSessionSelection = useCallback(() => {
    dashboardNavigationStore.setIsAgentBrowserListMode(true);
    setSelectedAgentSessionId("");
    setSelectedAgentSession(null);
    const targetSearch = buildRouteSearch({
      sourceId: selectedSourceId,
      agentSessionId: "",
      overlay: activeLiveOverlay,
      includeOverlay: routeState.kind === "session"
    });

    navigate({
      pathname:
        routeState.kind === "session" && routeState.sessionId
          ? buildSessionPath(routeState.sessionId, activeTab)
          : "/",
      search: targetSearch
    });
  }, [
    activeLiveOverlay,
    activeTab,
    routeState.kind,
    routeState.sessionId,
    selectedSourceId,
    navigate,
    setSelectedAgentSession,
    setSelectedAgentSessionId
  ]);

  const handleOpenManagedSession = useCallback(
    (sessionId: string, options?: ManagedSessionNavigationOptions) => {
      const subagentParentSessionId = options?.subagentParentSessionId ??
        readSubagentParentSessionId(window.history.state, effectiveSelectedAgentSessionId) ??
        undefined;
      const navigation = createManagedSessionNavigation(
        window.history.state,
        subagentParentSessionId,
        effectiveSelectedAgentSessionId
      );

      flushSync(() => {
        dashboardNavigationStore.setIsAgentBrowserListMode(false);
        dashboardNavigationStore.setIsDashboardPinned(false);
        dashboardNavigationStore.setOpeningAgentSessionId(effectiveSelectedAgentSessionId);
        setSelectedSessionId(sessionId);
      });
      navigate({
        pathname: buildSessionPath(sessionId, activeTab),
        search: buildRouteSearch({
          sourceId: selectedSourceId,
          agentSessionId: effectiveSelectedAgentSessionId,
          overlay: null,
          includeOverlay: true
        })
      }, {
        replace: navigation.replace,
        state: navigation.state
      });
    },
    [
      activeTab,
      effectiveSelectedAgentSessionId,
      navigate,
      selectedSourceId,
      setSelectedSessionId
    ]
  );

  return {
    handleBackToParentAgentSession,
    handleClearAgentSessionSelection,
    handleOpenManagedSession,
    handleOpenSubagentSession,
    handleSelectAgentSession,
    handleSelectManagedSession,
    handleSelectSessionTab,
    handleSelectSource
  };
}
