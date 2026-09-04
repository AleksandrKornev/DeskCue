import type { RouteViewState } from "@models/dashboardRoute";
import type { SessionTab } from "@models/sessionTabs";
import type { InitialManagedSessionLoadState } from "@modules/dashboard/model/data";
import type { DashboardState } from "@modules/dashboard/shell/hooks/types";
import { getDeskCueRuntime } from "@runtime";

export function useDashboardShellDisplayState({
  activeTab,
  effectiveSelectedAgentSessionId,
  effectiveSelectedSessionId,
  hasManagedFocus,
  isAgentSessionLoading,
  isBootstrapping,
  initialManagedSessionLoadState,
  isCompactViewport,
  isExitingToDashboard,
  isTakenOverAgentSessionLoading,
  routeState,
  selectedAgentSession,
  selectedSession,
  showBootstrapShell,
  takenOverAgentSessionForPanel
}: {
  activeTab: SessionTab;
  effectiveSelectedAgentSessionId: string;
  effectiveSelectedSessionId: string;
  hasManagedFocus: boolean;
  isAgentSessionLoading: boolean;
  isBootstrapping: boolean;
  initialManagedSessionLoadState: InitialManagedSessionLoadState;
  isCompactViewport: boolean;
  isExitingToDashboard: boolean;
  isTakenOverAgentSessionLoading: boolean;
  routeState: RouteViewState;
  selectedAgentSession: DashboardState["agentBrowser"]["selectedAgentSession"];
  selectedSession: DashboardState["managedSession"]["selectedSession"];
  showBootstrapShell: boolean;
  takenOverAgentSessionForPanel: DashboardState["agentBrowser"]["activeTakenOverAgentSession"];
}) {
  const isSettledDashboardLocation =
    typeof window !== "undefined" &&
    getDeskCueRuntime().readAppPath(window.location.pathname) === "/" &&
    !isBootstrapping;
  const isCleanDashboardRoute =
    routeState.kind === "dashboard" && !routeState.agentSessionId;
  const displaySelectedAgentSessionId = isExitingToDashboard ? "" : effectiveSelectedAgentSessionId;
  const displaySelectedAgentSession = isExitingToDashboard ? null : selectedAgentSession;
  const displayIsAgentSessionLoading = isExitingToDashboard ? false : isAgentSessionLoading;
  const displaySelectedSessionId = isExitingToDashboard ? "" : effectiveSelectedSessionId;
  const displaySelectedSession = isExitingToDashboard ? null : selectedSession;
  const displayHasManagedFocus = isExitingToDashboard ? false : hasManagedFocus;
  const focusedTabNeedsSourceTranscript =
    activeTab === "overview" || activeTab === "activity" || activeTab === "diff";
  const isFocusedSessionDetailHydrating =
    displayHasManagedFocus &&
    Boolean(displaySelectedSessionId) &&
    displaySelectedSession?.id !== displaySelectedSessionId;
  const isFocusedSourceTranscriptHydrating =
    displayHasManagedFocus &&
    Boolean(displaySelectedSession?.sourceSessionId) &&
    focusedTabNeedsSourceTranscript &&
    routeState.kind === "dashboard" &&
    Boolean(routeState.agentSessionId) &&
    !takenOverAgentSessionForPanel &&
    isTakenOverAgentSessionLoading;
  const isInitialSessionRecoveryVisible =
    routeState.kind === "session" &&
    (initialManagedSessionLoadState.kind === "error" ||
      initialManagedSessionLoadState.kind === "missing" ||
      initialManagedSessionLoadState.kind === "retrying");
  const shouldShowFocusedSessionHydrationShell =
    !isExitingToDashboard &&
    routeState.kind === "session" &&
    !isInitialSessionRecoveryVisible &&
    (isFocusedSessionDetailHydrating || isFocusedSourceTranscriptHydrating);
  const shouldShowRouteBootstrapShell =
    routeState.kind === "session" &&
    showBootstrapShell &&
    !isInitialSessionRecoveryVisible &&
    displaySelectedSessionId !== routeState.sessionId &&
    displaySelectedSession?.id !== displaySelectedSessionId &&
    !isCleanDashboardRoute &&
    !isExitingToDashboard &&
    !isSettledDashboardLocation;
  const shouldShowBootstrapShell =
    shouldShowFocusedSessionHydrationShell ||
    shouldShowRouteBootstrapShell;
  const shouldShowHeader =
    !shouldShowBootstrapShell &&
    !(
      isCompactViewport &&
      (routeState.kind === "session" || displayHasManagedFocus)
    );

  return {
    displayHasManagedFocus,
    displayIsAgentSessionLoading,
    displaySelectedAgentSession,
    displaySelectedAgentSessionId,
    displaySelectedSession,
    displaySelectedSessionId,
    shouldShowBootstrapShell,
    shouldShowHeader
  };
}
