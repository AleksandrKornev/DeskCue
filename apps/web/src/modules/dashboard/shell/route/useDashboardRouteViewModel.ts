import { useMemo } from "react";

import type { UseDashboardRouteViewModelArgs } from "./types";

export function useDashboardRouteViewModel({
  routeState,
  overviewSessions,
  managedSessions,
  selectedSourceId,
  selectedSessionId,
  selectedSession,
  selectedAgentSessionId,
  selectedAgentSession,
  activeTakenOverAgentSession,
  isActiveTakenOverAgentSessionLoading,
  isAgentSessionLoading,
  isAgentBrowserListMode,
  isDashboardPinned,
  attachingAgentSessionId,
  openingAgentSessionId,
  isBootstrapping,
  initialManagedSessionLoadState
}: UseDashboardRouteViewModelArgs) {
  return useMemo(() => {
    const routeSession =
      routeState.kind === "session"
        ? selectedSession?.id === routeState.sessionId
          ? selectedSession
          : (managedSessions.find((session) => session.id === routeState.sessionId) ??
            overviewSessions.find((session) => session.id === routeState.sessionId) ??
            null)
        : null;

    const isRouteSessionKnownStopped = routeSession?.status === "stopped";
    const isRouteSessionMissing =
      routeState.kind === "session" && initialManagedSessionLoadState.kind === "missing";

    const selectedSessionHasManagedFocus =
      selectedSession?.status === "running" || selectedSession?.status === "read_only";

    const isCleanDashboardRoute =
      routeState.kind === "dashboard" && !routeState.agentSessionId;
    const activeManagedSessionSummary =
      managedSessions.find((session) => {
        if (session.status === "stopped") {
          return false;
        }

        return session.id === routeState.sessionId || session.id === selectedSessionId;
      }) ?? null;

    const isBrowsingUnattachedAgentSession =
      routeState.kind === "dashboard" &&
      Boolean(routeState.agentSessionId) &&
      !isAgentBrowserListMode;

    const effectiveSelectedAgentSessionId = isAgentBrowserListMode
      ? ""
      : routeState.agentSessionId || selectedAgentSessionId;

    const isOpeningSelectedAgentSession =
      Boolean(effectiveSelectedAgentSessionId) &&
      (attachingAgentSessionId === effectiveSelectedAgentSessionId ||
        openingAgentSessionId === effectiveSelectedAgentSessionId);

    const effectiveSelectedSourceId = selectedSourceId;
    const effectiveSelectedAgentSourceSessionId =
      selectedAgentSession?.id === effectiveSelectedAgentSessionId
        ? selectedAgentSession.sourceSessionId
        : effectiveSelectedAgentSessionId.includes(":")
          ? effectiveSelectedAgentSessionId.slice(effectiveSelectedAgentSessionId.indexOf(":") + 1)
          : effectiveSelectedAgentSessionId;

    const attachedManagedSession =
      overviewSessions.find(
        (session) =>
          session.sourceSessionId === effectiveSelectedAgentSourceSessionId &&
          session.status === "running"
      ) ??
      overviewSessions.find(
        (session) =>
          session.sourceSessionId === effectiveSelectedAgentSourceSessionId &&
          session.status === "read_only" &&
          (session.viewerCount ?? 0) > 0
      ) ??
      null;

    const hasAttachedManagedPromptInFlight =
      attachedManagedSession?.status === "running" &&
      (attachedManagedSession.replyState.phase === "sending" ||
        attachedManagedSession.replyState.phase === "waiting");
    const shouldPromoteAttachedManagedSession =
      isBrowsingUnattachedAgentSession && hasAttachedManagedPromptInFlight;

    const effectiveSelectedSessionId = shouldPromoteAttachedManagedSession
      ? attachedManagedSession.id
      : isBrowsingUnattachedAgentSession || isCleanDashboardRoute
        ? ""
        : routeState.kind === "session" && !isRouteSessionMissing
          ? routeState.sessionId ?? ""
          : selectedSessionHasManagedFocus
            ? selectedSessionId
            : activeManagedSessionSummary?.id ?? "";

    const attachedManagedSessionId = attachedManagedSession?.id ?? null;
    const attachedManagedSessionInfo = attachedManagedSession
      ? {
          id: attachedManagedSession.id,
          status: attachedManagedSession.status,
          viewerCount: attachedManagedSession.viewerCount
        }
      : null;

    const routeHasManagedFocus =
      routeState.kind === "session" && !isRouteSessionMissing;
    const dashboardHasManagedFocus =
      (!isCleanDashboardRoute || shouldPromoteAttachedManagedSession) &&
      (!isDashboardPinned || shouldPromoteAttachedManagedSession) &&
      Boolean(
        selectedSessionHasManagedFocus ||
        activeManagedSessionSummary ||
        shouldPromoteAttachedManagedSession
      );
    const hasManagedFocus =
      (!isBrowsingUnattachedAgentSession || shouldPromoteAttachedManagedSession) &&
      (routeHasManagedFocus || dashboardHasManagedFocus);

    const hasImplicitManagedAgentSessionSelection =
      !isAgentBrowserListMode &&
      !routeState.agentSessionId &&
      selectedSessionHasManagedFocus &&
      Boolean(selectedSession?.sourceSessionId) &&
      (routeState.kind === "session" || hasManagedFocus);

    const activeLiveOverlay = routeState.overlay;
    const showLiveTools = activeLiveOverlay === "tools";
    const isResolvingSessionRoute =
      routeState.kind === "session" &&
      !routeSession &&
      initialManagedSessionLoadState.kind === "loading";
    const showBootstrapShell =
      isBootstrapping || isResolvingSessionRoute;

    const effectiveManagedSessionSummary =
      effectiveSelectedSessionId
        ? managedSessions.find((session) => session.id === effectiveSelectedSessionId) ??
          overviewSessions.find((session) => session.id === effectiveSelectedSessionId) ??
          null
        : null;
    const panelSourceSessionId =
      selectedSession?.sourceSessionId ?? effectiveManagedSessionSummary?.sourceSessionId ?? null;
    const isPanelUsingActiveTakenOverAgentSession =
      Boolean(panelSourceSessionId) &&
      activeTakenOverAgentSession?.sourceSessionId === panelSourceSessionId;
    const isPanelUsingSelectedAgentSession =
      !isPanelUsingActiveTakenOverAgentSession &&
      Boolean(panelSourceSessionId) &&
      selectedAgentSession?.sourceSessionId === panelSourceSessionId;
    const takenOverAgentSessionForPanel = isPanelUsingActiveTakenOverAgentSession
      ? activeTakenOverAgentSession
      : isPanelUsingSelectedAgentSession
        ? selectedAgentSession
        : null;
    const isPanelAgentSessionLoading = isPanelUsingSelectedAgentSession
      ? isAgentSessionLoading
      : isActiveTakenOverAgentSessionLoading;

    return {
      isRouteSessionKnownStopped,
      initialManagedSessionLoadState,
      effectiveSelectedSessionId,
      effectiveSelectedAgentSessionId,
      isOpeningSelectedAgentSession,
      effectiveSelectedSourceId,
      attachedManagedSessionId,
      attachedManagedSessionInfo,
      hasManagedFocus,
      hasImplicitManagedAgentSessionSelection,
      activeLiveOverlay,
      showLiveTools,
      showBootstrapShell,
      takenOverAgentSessionForPanel,
      isTakenOverAgentSessionLoading: isPanelAgentSessionLoading
    };
  }, [
    activeTakenOverAgentSession,
    attachingAgentSessionId,
    isActiveTakenOverAgentSessionLoading,
    isAgentBrowserListMode,
    isAgentSessionLoading,
    isBootstrapping,
    initialManagedSessionLoadState,
    isDashboardPinned,
    managedSessions,
    openingAgentSessionId,
    overviewSessions,
    routeState,
    selectedAgentSession,
    selectedAgentSessionId,
    selectedSession,
    selectedSessionId,
    selectedSourceId
  ]);
}
