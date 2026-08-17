import type { NavigateFunction } from "react-router";

import type {
  AgentKind,
  AgentSessionDetail,
  SessionDetail,
  SessionSummary
} from "@deskcue/protocol";
import type { OverlayMode, RouteViewState } from "@models/dashboardRoute";
import type { SendInputOptions } from "@models/promptDelivery";
import type { SessionTab } from "@models/sessionTabs";
import type { InitialManagedSessionLoadState } from "@modules/dashboard/model/data";

export type NavigateToRoute = (
  nextState: Partial<RouteViewState>,
  options?: {
    replace?: boolean;
  }
) => void;

export type UseDashboardRouteActionsArgs = {
  activeLiveOverlay: OverlayMode;
  activeTab: SessionTab;
  effectiveSelectedAgentSessionId: string;
  effectiveSelectedSessionId: string;
  locationPathname: string;
  locationSearch: string;
  managedSessions: SessionSummary[];
  routeState: RouteViewState;
  selectedAgentSessionId: string;
  selectedSourceId: AgentKind | "all";
  navigate: NavigateFunction;
  handleAttachAgentSession: () => Promise<SessionDetail | null>;
  handleSendInput: (
    nextInstruction: string,
    options?: SendInputOptions
  ) => Promise<string | boolean>;
  handleStopSession: () => Promise<boolean>;
  setActiveTab: (value: SessionTab) => void;
  setSelectedAgentSession: (value: null) => void;
  setSelectedAgentSessionId: (value: string) => void;
  setSelectedSession: (value: SessionDetail | null) => void;
  setSelectedSessionId: (value: string) => void;
  setSelectedSourceId: (value: AgentKind | "all") => void;
};

export type UseDashboardRouteViewModelArgs = {
  routeState: RouteViewState;
  overviewSessions: SessionSummary[];
  managedSessions: SessionSummary[];
  selectedSourceId: AgentKind | "all";
  selectedSessionId: string;
  selectedSession: SessionDetail | null;
  selectedAgentSessionId: string;
  selectedAgentSession: AgentSessionDetail | null;
  activeTakenOverAgentSession: AgentSessionDetail | null;
  isActiveTakenOverAgentSessionLoading: boolean;
  isAgentSessionLoading: boolean;
  isAgentBrowserListMode: boolean;
  isDashboardPinned: boolean;
  attachingAgentSessionId: string;
  openingAgentSessionId: string;
  isBootstrapping: boolean;
  initialManagedSessionLoadState: InitialManagedSessionLoadState;
};

export type UseDashboardRouteSelectionActionsArgs = Pick<
  UseDashboardRouteActionsArgs,
  | "activeLiveOverlay"
  | "activeTab"
  | "effectiveSelectedAgentSessionId"
  | "effectiveSelectedSessionId"
  | "managedSessions"
  | "navigate"
  | "routeState"
  | "selectedSourceId"
  | "setActiveTab"
  | "setSelectedAgentSession"
  | "setSelectedAgentSessionId"
  | "setSelectedSession"
  | "setSelectedSessionId"
  | "setSelectedSourceId"
> & {
  navigateToRoute: NavigateToRoute;
};

export type UseDashboardNavigateToRouteArgs = Pick<
  UseDashboardRouteActionsArgs,
  | "activeLiveOverlay"
  | "activeTab"
  | "effectiveSelectedSessionId"
  | "locationPathname"
  | "locationSearch"
  | "routeState"
  | "selectedAgentSessionId"
  | "selectedSourceId"
  | "navigate"
>;

export type UseDashboardRouteSyncArgs = {
  routeState: RouteViewState;
  activeLiveOverlay: OverlayMode;
  activeTab: SessionTab;
  effectiveSelectedSessionId: string;
  hasImplicitManagedAgentSessionSelection: boolean;
  hasManagedFocus: boolean;
  isBootstrapping: boolean;
  isDashboardPinned: boolean;
  isRouteSessionKnownStopped: boolean;
  locationPathname: string;
  locationSearch: string;
  selectedAgentSessionId: string;
  selectedSessionId: string;
  selectedSourceId: AgentKind | "all";
  openingAgentSessionId: string;
  navigate: NavigateFunction;
  navigateToRoute: NavigateToRoute;
  setActiveTab: (value: SessionTab) => void;
  setSelectedAgentSessionId: (value: string) => void;
  setSelectedSessionId: (value: string) => void;
  setSelectedSourceId: (value: AgentKind | "all") => void;
};
