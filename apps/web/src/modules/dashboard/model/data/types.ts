import type { MutableRefObject } from "react";

import type {
  AgentKind,
  AgentSessionDetail,
  AgentSessionSummary,
  OverviewResponse,
  RuntimeSummary,
  SessionDetail
} from "@deskcue/protocol";
import { agentSessionsApi } from "@api/endpoint/agentSessions/endpoints";
import type { AgentSessionsLoadState } from "@models/agentSessions/contracts";
import type { SessionTab } from "@models/sessionTabs";

import type { LoadOptions } from "./dashboardLoad";

export interface UseDashboardMutableRefsArgs {
  activeTab: SessionTab;
  agentSessions: AgentSessionSummary[];
  overview: OverviewResponse;
  runtimes: RuntimeSummary[];
  selectedAgentSession: AgentSessionDetail | null;
  selectedAgentSessionId: string;
  selectedSession: SessionDetail | null;
  selectedSessionId: string;
}

export type AgentSessionsLoadOptions = LoadOptions & {
  sourceId?: AgentKind | "all";
};

export type ManagedSessionLoadOutcome =
  | { kind: "loaded"; session: SessionDetail }
  | { kind: "missing" }
  | { kind: "superseded" }
  | { kind: "error"; message: string };

export type UseDashboardLoadersArgs = {
  overviewRef: MutableRefObject<OverviewResponse>;
  agentSessionsRef: MutableRefObject<AgentSessionSummary[]>;
  runtimesRef: MutableRefObject<RuntimeSummary[]>;
  selectedSessionIdRef: MutableRefObject<string>;
  selectedSessionSelectionEpochRef: MutableRefObject<number>;
  selectedSessionRef: MutableRefObject<SessionDetail | null>;
  captureOverviewRevision: () => number;
  setOverview: (value: OverviewResponse, requestRevision: number) => void;
  setAgentSessionsPage: (value: Awaited<ReturnType<typeof agentSessionsApi.getList>>) => void;
  setAgentSessionsLoadState: (value: AgentSessionsLoadState) => void;
  appendAgentSessionsPage: (value: Awaited<ReturnType<typeof agentSessionsApi.getList>>) => void;
  setRuntimes: (value: RuntimeSummary[]) => void;
  setSelectedSession: (value: SessionDetail | null) => void;
  mergeSelectedSessionView: (
    value: SessionDetail,
    view: NonNullable<LoadOptions["sessionView"]>
  ) => void;
  setErrorIfEmpty: (value: string) => void;
};

export type InitialManagedSessionLoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "retrying"; message: string }
  | { kind: "loaded" }
  | { kind: "missing" }
  | { kind: "error"; message: string };

export type UseDashboardBootstrapArgs = {
  initialManagedSessionId?: string;
  suppressManagedSessionAutoSelect?: boolean;
  selectedSessionIdRef: MutableRefObject<string>;
  selectedSessionSelectionEpochRef: MutableRefObject<number>;
  setSelectedSessionId: (value: string) => void;
  setIsBootstrapping: (value: boolean) => void;
  loadOverview: (options?: LoadOptions) => Promise<OverviewResponse>;
  loadAgentSessions: (options?: LoadOptions) => Promise<AgentSessionSummary[]>;
  loadRuntimes: (options?: LoadOptions) => Promise<RuntimeSummary[]>;
  loadSession: (sessionId: string, options?: LoadOptions) => Promise<SessionDetail | null>;
  loadSessionWithOutcome: (
    sessionId: string,
    options?: LoadOptions
  ) => Promise<ManagedSessionLoadOutcome>;
};
