import type { AgentKind } from "@deskcue/protocol";
import type { RouteViewState } from "@models/dashboardRoute";
import type { SessionTab } from "@models/sessionTabs";

type SelectionRouteSyncAction =
  | { kind: "clear-pending-source" }
  | { kind: "set-selected-source"; value: AgentKind | "all" }
  | { kind: "clear-pending-agent" }
  | { kind: "set-selected-agent"; value: string }
  | { kind: "clear-opening-agent" }
  | { kind: "clear-pending-tab" }
  | { kind: "set-active-tab"; value: SessionTab }
  | { kind: "set-selected-session"; value: string };

type PendingSendRouteSyncAction =
  | { kind: "none" }
  | {
      kind: "open-selected-session-overview";
      sessionId: string;
    };

type DashboardRouteNavigationAction =
  | { kind: "none" }
  | { kind: "clear-dashboard-exit" }
  | { kind: "navigate-dashboard-root" }
  | { kind: "unpin-dashboard" }
  | {
      kind: "navigate-selected-session";
      sessionId: string;
      tab: SessionTab;
      sourceId: AgentKind | "all";
      agentSessionId: string;
    }
  | { kind: "navigate-dashboard" }
  | {
      kind: "navigate-dashboard-list";
      sourceId: AgentKind | "all";
      agentSessionId: string;
    };

export function resolveSourceRouteSyncActions({
  pendingSourceRouteSelection,
  routeSourceId,
  selectedSourceId
}: {
  pendingSourceRouteSelection: AgentKind | "all" | "";
  routeSourceId: AgentKind | "all";
  selectedSourceId: AgentKind | "all";
}): SelectionRouteSyncAction[] {
  if (pendingSourceRouteSelection) {
    if (routeSourceId === pendingSourceRouteSelection) {
      return selectedSourceId === routeSourceId
        ? [{ kind: "clear-pending-source" }]
        : [
            { kind: "clear-pending-source" },
            { kind: "set-selected-source", value: routeSourceId }
          ];
    }

    if (selectedSourceId === pendingSourceRouteSelection) {
      return [];
    }

    return selectedSourceId === routeSourceId
      ? [{ kind: "clear-pending-source" }]
      : [
          { kind: "clear-pending-source" },
          { kind: "set-selected-source", value: routeSourceId }
        ];
  }

  return selectedSourceId !== routeSourceId
    ? [{ kind: "set-selected-source", value: routeSourceId }]
    : [];
}

export function resolveAgentRouteSyncActions({
  hasImplicitManagedAgentSessionSelection,
  isRouteSessionKnownStopped,
  pendingAgentRouteSelection,
  routeAgentSessionId,
  selectedAgentSessionId
}: {
  hasImplicitManagedAgentSessionSelection: boolean;
  isRouteSessionKnownStopped: boolean;
  pendingAgentRouteSelection: string;
  routeAgentSessionId: string;
  selectedAgentSessionId: string;
}): SelectionRouteSyncAction[] {
  if (
    hasImplicitManagedAgentSessionSelection ||
    (isRouteSessionKnownStopped && !routeAgentSessionId)
  ) {
    return [];
  }

  if (pendingAgentRouteSelection) {
    if (routeAgentSessionId === pendingAgentRouteSelection) {
      return selectedAgentSessionId === routeAgentSessionId
        ? [{ kind: "clear-pending-agent" }]
        : [
            { kind: "clear-pending-agent" },
            { kind: "set-selected-agent", value: routeAgentSessionId }
          ];
    }

    if (selectedAgentSessionId === pendingAgentRouteSelection) {
      return [];
    }

    return selectedAgentSessionId === routeAgentSessionId
      ? [{ kind: "clear-pending-agent" }]
      : [
          { kind: "clear-pending-agent" },
          { kind: "set-selected-agent", value: routeAgentSessionId }
        ];
  }

  return routeAgentSessionId !== selectedAgentSessionId
    ? [{ kind: "set-selected-agent", value: routeAgentSessionId }]
    : [];
}

export function resolveOpeningAgentRouteSyncActions({
  hasManagedFocus,
  openingAgentSessionId,
  routeKind
}: {
  hasManagedFocus: boolean;
  openingAgentSessionId: string;
  routeKind: RouteViewState["kind"];
}): SelectionRouteSyncAction[] {
  return routeKind === "session" && hasManagedFocus && openingAgentSessionId
    ? [{ kind: "clear-opening-agent" }]
    : [];
}

export function resolveSessionRouteSyncActions({
  activeTab,
  isDashboardPinned,
  isRouteSessionKnownStopped,
  pendingSendRouteSync,
  pendingSessionTabSelection,
  routeState,
  selectedSessionId
}: {
  activeTab: SessionTab;
  isDashboardPinned: boolean;
  isRouteSessionKnownStopped: boolean;
  pendingSendRouteSync: boolean;
  pendingSessionTabSelection: SessionTab | "";
  routeState: RouteViewState;
  selectedSessionId: string;
}): SelectionRouteSyncAction[] {
  if (routeState.kind !== "session" || isDashboardPinned) {
    return [];
  }

  const actions: SelectionRouteSyncAction[] = [];
  let shouldSyncActiveTab = activeTab !== routeState.tab;
  if (pendingSessionTabSelection) {
    if (routeState.tab === pendingSessionTabSelection) {
      actions.push({ kind: "clear-pending-tab" });
    } else if (activeTab === pendingSessionTabSelection) {
      shouldSyncActiveTab = false;
    } else {
      actions.push({ kind: "clear-pending-tab" });
    }
  }

  if (shouldSyncActiveTab) {
    actions.push({ kind: "set-active-tab", value: routeState.tab });
  }

  if (isRouteSessionKnownStopped) {
    return actions;
  }

  if (
    pendingSendRouteSync &&
    selectedSessionId &&
    selectedSessionId !== routeState.sessionId
  ) {
    return actions;
  }

  if (selectedSessionId !== routeState.sessionId) {
    actions.push({ kind: "set-selected-session", value: routeState.sessionId ?? "" });
  }

  return actions;
}

export function resolvePendingSendRouteSyncAction({
  pendingSendRouteSync,
  routeState,
  selectedSessionId
}: {
  pendingSendRouteSync: boolean;
  routeState: RouteViewState;
  selectedSessionId: string;
}): PendingSendRouteSyncAction {
  if (
    !pendingSendRouteSync ||
    routeState.kind !== "session" ||
    !selectedSessionId ||
    selectedSessionId === routeState.sessionId
  ) {
    return { kind: "none" };
  }

  return {
    kind: "open-selected-session-overview",
    sessionId: selectedSessionId
  };
}

export function resolveDashboardRouteNavigationAction({
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
}: {
  activeTab: SessionTab;
  effectiveSelectedSessionId: string;
  hasImplicitManagedAgentSessionSelection: boolean;
  hasManagedFocus: boolean;
  isBootstrapping: boolean;
  isDashboardPinned: boolean;
  locationPathname: string;
  locationSearch: string;
  openingAgentSessionId: string;
  pendingDashboardExit: boolean;
  routeState: RouteViewState;
  selectedAgentSessionId: string;
  selectedSessionId: string;
  selectedSourceId: AgentKind | "all";
}): DashboardRouteNavigationAction {
  if (isBootstrapping) {
    return { kind: "none" };
  }

  if (pendingDashboardExit) {
    const isCleanDashboardRoute = locationPathname === "/" && !locationSearch;
    if (
      isCleanDashboardRoute &&
      routeState.kind === "dashboard" &&
      isDashboardPinned &&
      !selectedSessionId &&
      !selectedAgentSessionId
    ) {
      return { kind: "clear-dashboard-exit" };
    }

    return !isCleanDashboardRoute
      ? { kind: "navigate-dashboard-root" }
      : { kind: "none" };
  }

  if (routeState.kind === "session" && isDashboardPinned) {
    return { kind: "unpin-dashboard" };
  }

  if (isDashboardPinned) {
    const hasDashboardListSearch =
      routeState.sourceId !== "all" || Boolean(routeState.agentSessionId);

    return (locationPathname !== "/" || (locationSearch && !hasDashboardListSearch)) &&
      !routeState.agentSessionId
      ? { kind: "navigate-dashboard-root" }
      : { kind: "none" };
  }

  if (
    routeState.kind === "dashboard" &&
    openingAgentSessionId &&
    selectedSessionId
  ) {
    return {
      kind: "navigate-selected-session",
      sessionId: selectedSessionId,
      tab: activeTab,
      sourceId: selectedSourceId,
      agentSessionId: selectedAgentSessionId || routeState.agentSessionId
    };
  }

  const awaitingRouteSelectionSync =
    selectedSourceId !== routeState.sourceId ||
    (!hasImplicitManagedAgentSessionSelection &&
      selectedAgentSessionId !== routeState.agentSessionId) ||
    (routeState.kind === "session" &&
      (selectedSessionId !== routeState.sessionId || activeTab !== routeState.tab));

  if (awaitingRouteSelectionSync) {
    return { kind: "none" };
  }

  if (routeState.kind === "session") {
    return effectiveSelectedSessionId
      ? { kind: "none" }
      : { kind: "navigate-dashboard" };
  }

  if (hasManagedFocus && effectiveSelectedSessionId) {
    return {
      kind: "navigate-selected-session",
      sessionId: effectiveSelectedSessionId,
      tab: activeTab,
      sourceId: selectedSourceId,
      agentSessionId: selectedAgentSessionId
    };
  }

  return {
    kind: "navigate-dashboard-list",
    sourceId: selectedSourceId,
    agentSessionId: selectedAgentSessionId
  };
}

export function applySelectionRouteSyncAction({
  action,
  clearPendingAgentRouteSelection,
  clearPendingSessionTabSelection,
  clearPendingSourceRouteSelection,
  clearOpeningAgentSessionId,
  setActiveTab,
  setSelectedAgentSessionId,
  setSelectedSessionId,
  setSelectedSourceId
}: {
  action: SelectionRouteSyncAction;
  clearPendingAgentRouteSelection: () => void;
  clearPendingSessionTabSelection: () => void;
  clearPendingSourceRouteSelection: () => void;
  clearOpeningAgentSessionId: () => void;
  setActiveTab: (value: SessionTab) => void;
  setSelectedAgentSessionId: (value: string) => void;
  setSelectedSessionId: (value: string) => void;
  setSelectedSourceId: (value: AgentKind | "all") => void;
}) {
  if (action.kind === "clear-pending-source") {
    clearPendingSourceRouteSelection();
    return;
  }

  if (action.kind === "set-selected-source") {
    setSelectedSourceId(action.value);
    return;
  }

  if (action.kind === "clear-pending-agent") {
    clearPendingAgentRouteSelection();
    return;
  }

  if (action.kind === "set-selected-agent") {
    setSelectedAgentSessionId(action.value);
    return;
  }

  if (action.kind === "clear-opening-agent") {
    clearOpeningAgentSessionId();
    return;
  }

  if (action.kind === "clear-pending-tab") {
    clearPendingSessionTabSelection();
    return;
  }

  if (action.kind === "set-active-tab") {
    setActiveTab(action.value);
    return;
  }

  setSelectedSessionId(action.value);
}
