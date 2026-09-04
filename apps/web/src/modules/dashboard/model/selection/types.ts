import type { MutableRefObject } from "react";

import type {
  AgentSessionDetail,
  AgentSessionSummary,
  OverviewResponse,
  SessionDetail
} from "@deskcue/protocol";
import type { SessionTab } from "@models/sessionTabs";
import type { InitialManagedSessionLoadState } from "@modules/dashboard/model/data";
import type { LoadOptions } from "@modules/dashboard/model/data/dashboardLoad";

export type UseSelectedManagedSessionControllerArgs = {
  suppressManagedSessionAutoSelect?: boolean;
  overview: OverviewResponse;
  isBootstrapping: boolean;
  initialManagedSessionLoadState?: InitialManagedSessionLoadState;
  activeTab: SessionTab;
  selectedWorkspaceId: string;
  selectedAgentSessionId: string;
  selectedSessionId: string;
  selectedSession: SessionDetail | null;
  selectedSessionIdRef: MutableRefObject<string>;
  setSelectedWorkspaceId: (value: string) => void;
  setSelectedSessionId: (value: string) => void;
  setSelectedSession: (value: SessionDetail | null) => void;
  loadSession: (sessionId: string, options?: LoadOptions) => Promise<SessionDetail | null>;
};

export type UseSelectedAgentSessionControllerArgs = {
  suppressAgentSessionAutoSelect?: boolean;
  activeTab: SessionTab;
  isBootstrapping: boolean;
  agentSessions: AgentSessionSummary[];
  filteredAgentSessions: AgentSessionSummary[];
  selectedAgentSessionId: string;
  selectedAgentSession: AgentSessionDetail | null;
  selectedAgentSessionRefreshNonce: number;
  selectedSession: SessionDetail | null;
  hydratedSelectedAgentSessionIdRef: MutableRefObject<string>;
  selectedAgentSessionRef: MutableRefObject<AgentSessionDetail | null>;
  incrementSelectedAgentSessionRefreshNonce: () => void;
  setSelectedAgentSessionId: (value: string) => void;
  setSelectedAgentSession: (value: AgentSessionDetail | null) => void;
  setIsAgentSessionLoading: (value: boolean) => void;
  updateSelectedAgentSession: (
    updater: (current: AgentSessionDetail | null) => AgentSessionDetail | null
  ) => void;
};

export type UseActiveTakenOverAgentSessionControllerArgs = {
  enabled?: boolean;
  isBootstrapping: boolean;
  activeTab: SessionTab;
  activeTakenOverAgentSession: AgentSessionDetail | null;
  activeTakenOverAgentSessionSummaryId: string;
  setActiveTakenOverAgentSession: (value: AgentSessionDetail | null) => void;
  setIsActiveTakenOverAgentSessionLoading: (value: boolean) => void;
  updateActiveTakenOverAgentSession: (
    updater: (current: AgentSessionDetail | null) => AgentSessionDetail | null
  ) => void;
};
