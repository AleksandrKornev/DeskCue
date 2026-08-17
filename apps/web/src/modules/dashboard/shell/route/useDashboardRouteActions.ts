import { useCallback } from "react";
import { flushSync } from "react-dom";

import {
  buildRouteSearch,
  buildSessionPath
} from "@models/dashboardRoute";
import type { SendInputOptions } from "@models/promptDelivery";
import { dashboardNavigationStore } from "@modules/dashboard/shell/store/dashboardNavigationStore";

import { resetDashboardScroll } from "./helpers";
import type { UseDashboardRouteActionsArgs } from "./types";
import { useDashboardNavigateToRoute } from "./useDashboardNavigateToRoute";
import { useDashboardRouteSelectionActions } from "./useDashboardRouteSelectionActions";

export function useDashboardRouteActions({
  activeLiveOverlay,
  activeTab,
  effectiveSelectedAgentSessionId,
  effectiveSelectedSessionId,
  locationPathname,
  locationSearch,
  managedSessions,
  routeState,
  selectedAgentSessionId,
  selectedSourceId,
  handleAttachAgentSession,
  handleSendInput,
  handleStopSession,
  navigate,
  setActiveTab,
  setSelectedAgentSession,
  setSelectedAgentSessionId,
  setSelectedSession,
  setSelectedSessionId,
  setSelectedSourceId
}: UseDashboardRouteActionsArgs) {
  const navigateToRoute = useDashboardNavigateToRoute({
    activeLiveOverlay,
    activeTab,
    effectiveSelectedSessionId,
    locationPathname,
    locationSearch,
    routeState,
    selectedAgentSessionId,
    selectedSourceId,
    navigate
  });

  const closeLiveOverlays = useCallback(() => {
    navigateToRoute({
      overlay: null
    });
  }, [navigateToRoute]);

  const toggleLiveTools = useCallback(() => {
    navigateToRoute({
      overlay: activeLiveOverlay === "tools" ? null : "tools"
    });
  }, [activeLiveOverlay, navigateToRoute]);

  const {
    handleClearAgentSessionSelection,
    handleOpenManagedSession,
    handleSelectAgentSession,
    handleSelectManagedSession,
    handleSelectSessionTab,
    handleSelectSource
  } = useDashboardRouteSelectionActions({
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
  });

  const exitToDashboard = useCallback(() => {
    resetDashboardScroll();
    flushSync(() => {
      dashboardNavigationStore.setPendingDashboardExit(true);
      dashboardNavigationStore.setIsAgentBrowserListMode(false);
      dashboardNavigationStore.setIsDashboardPinned(true);
      setSelectedSessionId("");
      setSelectedSession(null);
      setSelectedAgentSessionId("");
      setActiveTab("overview");
    });
    navigate(
      {
        pathname: "/",
        search: ""
      },
      {
        replace: false
      }
    );
  }, [navigate, setActiveTab, setSelectedAgentSessionId, setSelectedSession, setSelectedSessionId]);

  const handleGoHome = useCallback(() => {
    exitToDashboard();
  }, [exitToDashboard]);

  const handleExitSession = useCallback(() => {
    exitToDashboard();
  }, [exitToDashboard]);

  const handleOpenLocalLlmChat = useCallback((chatId: string) => {
    resetDashboardScroll();
    navigate({
      pathname: `/local-llm/chats/${encodeURIComponent(chatId)}`,
      search: ""
    });
  }, [navigate]);

  const handleStopAndExitSession = useCallback(async () => {
    const stopped = await handleStopSession();
    if (!stopped) {
      return;
    }

    handleExitSession();
  }, [handleExitSession, handleStopSession]);

  const handleAttachSelectedAgentSession = useCallback(async () => {
    const agentSessionId = effectiveSelectedAgentSessionId;
    flushSync(() => {
      dashboardNavigationStore.setIsAgentBrowserListMode(false);
      dashboardNavigationStore.setOpeningAgentSessionId(agentSessionId);
    });
    let keepOpeningStateUntilRouteSync = false;
    try {
      const session = await handleAttachAgentSession();
      if (!session) {
        return;
      }

      dashboardNavigationStore.setIsDashboardPinned(false);
      setSelectedSessionId(session.id);
      keepOpeningStateUntilRouteSync = true;
      navigate({
        pathname: buildSessionPath(session.id, "overview"),
        search: buildRouteSearch({
          sourceId: selectedSourceId,
          agentSessionId,
          overlay: null,
          includeOverlay: true
        })
      });
    } finally {
      if (!keepOpeningStateUntilRouteSync) {
        dashboardNavigationStore.setOpeningAgentSessionId("");
      }
    }
  }, [
    effectiveSelectedAgentSessionId,
    handleAttachAgentSession,
    navigate,
    selectedSourceId,
    setSelectedSessionId
  ]);

  const handleSendInputAndSyncRoute = useCallback(
    async (nextInstruction: string, options?: SendInputOptions) => {
      const sent = await handleSendInput(nextInstruction, options);
      const sentSessionId = typeof sent === "string" ? sent : "";
      if (sent && sentSessionId && sentSessionId !== routeState.sessionId) {
        dashboardNavigationStore.setPendingSendRouteSync(false);
        dashboardNavigationStore.setIsDashboardPinned(false);
        setSelectedSessionId(sentSessionId);
        setActiveTab("overview");
        navigateToRoute(
          {
            kind: "session",
            sessionId: sentSessionId,
            tab: "overview",
            overlay: null
          },
          {
            replace: true
          }
        );
      } else if (sent) {
        dashboardNavigationStore.setPendingSendRouteSync(true);
      }

      return Boolean(sent);
    },
    [routeState.sessionId, handleSendInput, navigateToRoute, setActiveTab, setSelectedSessionId]
  );

  return {
    navigateToRoute,
    closeLiveOverlays,
    toggleLiveTools,
    handleSelectManagedSession,
    handleSelectSessionTab,
    handleSelectSource,
    handleSelectAgentSession,
    handleClearAgentSessionSelection,
    handleOpenManagedSession,
    handleOpenLocalLlmChat,
    handleGoHome,
    handleExitSession,
    handleStopSession,
    handleStopAndExitSession,
    handleAttachSelectedAgentSession,
    handleSendInputAndSyncRoute
  };
}
