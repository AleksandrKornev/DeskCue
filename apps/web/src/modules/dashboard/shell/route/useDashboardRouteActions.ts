import { useCallback } from "react";
import { flushSync } from "react-dom";

import {
  buildRouteSearch,
  buildSessionPath
} from "@models/dashboardRoute";
import type { SendInputOptions } from "@models/promptDelivery";
import { dashboardNavigationStore } from "@modules/dashboard/shell/store/dashboardNavigationStore";

import {
  createManagedSessionNavigation,
  readSubagentParentSessionId,
  resetDashboardScroll
} from "./helpers";
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

  const toggleLiveTools = useCallback((options?: { replace?: boolean }) => {
    navigateToRoute({
      overlay: activeLiveOverlay === "tools" ? null : "tools"
    }, options);
  }, [activeLiveOverlay, navigateToRoute]);

  const {
    handleBackToParentAgentSession,
    handleClearAgentSessionSelection,
    handleOpenManagedSession,
    handleOpenSubagentSession,
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
        search: buildRouteSearch({
          sourceId: selectedSourceId,
          agentSessionId: "",
          overlay: null
        })
      },
      {
        replace: false
      }
    );
  }, [
    navigate,
    selectedSourceId,
    setActiveTab,
    setSelectedAgentSessionId,
    setSelectedSession,
    setSelectedSessionId
  ]);

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

  const handleStopAndExitSession = useCallback(async (options?: {
    subagentParentSessionId?: string;
    subagentSessionId?: string;
  }) => {
    const stopped = await handleStopSession();

    if (!stopped) return;

    const subagentSessionId = options?.subagentSessionId ?? effectiveSelectedAgentSessionId;
    const subagentParentSessionId = options?.subagentParentSessionId ??
      readSubagentParentSessionId(window.history.state, subagentSessionId);

    if (subagentParentSessionId && subagentSessionId) {
      handleBackToParentAgentSession(
        subagentParentSessionId,
        subagentSessionId
      );

      return;
    }

    handleExitSession();
  }, [
    effectiveSelectedAgentSessionId,
    handleBackToParentAgentSession,
    handleExitSession,
    handleStopSession
  ]);

  const handleAttachSelectedAgentSession = useCallback(async (
    options?: { subagentParentSessionId?: string }
  ) => {
    const agentSessionId = effectiveSelectedAgentSessionId;
    const subagentParentSessionId = options?.subagentParentSessionId ??
      readSubagentParentSessionId(window.history.state, agentSessionId) ??
      undefined;
    const navigation = createManagedSessionNavigation(
      window.history.state,
      subagentParentSessionId,
      agentSessionId
    );

    flushSync(() => {
      dashboardNavigationStore.setIsAgentBrowserListMode(false);
      dashboardNavigationStore.setOpeningAgentSessionId(agentSessionId);
    });
    let keepOpeningStateUntilRouteSync = false;

    try {
      const session = await handleAttachAgentSession();

      if (!session) return;

      dashboardNavigationStore.setIsDashboardPinned(false);
      setSelectedSessionId(session.id);
      keepOpeningStateUntilRouteSync = true;
      navigate(
        {
          pathname: buildSessionPath(session.id, "overview"),
          search: buildRouteSearch({
            sourceId: selectedSourceId,
            agentSessionId,
            overlay: null,
            includeOverlay: true
          })
        },
        {
          replace: navigation.replace,
          state: navigation.state
        }
      );
    } finally {
      if (!keepOpeningStateUntilRouteSync) dashboardNavigationStore.setOpeningAgentSessionId("");
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
    handleExitSession,
    handleStopSession,
    handleStopAndExitSession,
    handleAttachSelectedAgentSession,
    handleSendInputAndSyncRoute
  };
}
