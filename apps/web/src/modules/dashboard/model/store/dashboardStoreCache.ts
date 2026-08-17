import type {
  AgentKind,
  AgentSessionDetail,
  AgentSessionSourceCount,
  AgentSessionSummary,
  OverviewResponse,
  RuntimeSummary,
  SessionDetail
} from "@deskcue/protocol";
import type { DashboardCache } from "@models/dashboardCache";
import type { SessionTab } from "@models/sessionTabs";

import { buildSourceCountsFromSessions } from "./collections/agentSessionCollection";
import { initialOverview } from "./dashboardStoreDefaults";

export type DashboardStoreOptions = {
  initialActiveTab?: SessionTab;
  suppressAgentSessionAutoSelect?: boolean;
  suppressManagedSessionAutoSelect?: boolean;
};

type DashboardStoreCacheTarget = {
  overview: OverviewResponse;
  agentSessions: AgentSessionSummary[];
  agentSessionsTotalCount: number;
  agentSessionsTotalCountExact: boolean;
  agentSessionSourceCounts: AgentSessionSourceCount[];
  runtimes: RuntimeSummary[];
  selectedSourceId: AgentKind | "all";
  selectedAgentSessionId: string;
  selectedAgentSession: AgentSessionDetail | null;
  isAgentSessionLoading: boolean;
  readyForReviewAgentSessionIds: string[];
  activeTakenOverAgentSession: AgentSessionDetail | null;
  isActiveTakenOverAgentSessionLoading: boolean;
  selectedWorkspaceId: string;
  selectedSessionId: string;
  selectedSession: SessionDetail | null;
  activeTab: SessionTab;
  previewPort: string;
};

export function applyDashboardStoreCache(
  target: DashboardStoreCacheTarget,
  cache: DashboardCache,
  options?: DashboardStoreOptions
) {
  target.overview = cache.overview ?? initialOverview;
  target.agentSessions = cache.agentSessions ?? [];
  target.agentSessionsTotalCount = target.agentSessions.length;
  target.agentSessionsTotalCountExact = true;
  target.agentSessionSourceCounts = buildSourceCountsFromSessions(target.agentSessions);
  target.runtimes = cache.runtimes ?? [];
  target.selectedSourceId = cache.selectedSourceId ?? "all";
  target.selectedAgentSessionId = options?.suppressAgentSessionAutoSelect
    ? ""
    : cache.selectedAgentSessionId ?? "";
  target.selectedAgentSession = options?.suppressAgentSessionAutoSelect
    ? null
    : cache.selectedAgentSession ?? null;
  target.isAgentSessionLoading = Boolean(target.selectedAgentSessionId);
  target.readyForReviewAgentSessionIds = cache.readyForReviewAgentSessionIds ?? [];
  target.activeTakenOverAgentSession = options?.suppressManagedSessionAutoSelect
    ? null
    : cache.activeTakenOverAgentSession ?? null;
  target.isActiveTakenOverAgentSessionLoading = Boolean(target.activeTakenOverAgentSession);
  target.selectedWorkspaceId = cache.selectedWorkspaceId ?? "";
  target.selectedSessionId = options?.suppressManagedSessionAutoSelect
    ? ""
    : cache.selectedSessionId ?? "";
  target.selectedSession = options?.suppressManagedSessionAutoSelect
    ? null
    : cache.selectedSession ?? null;
  target.activeTab = options?.initialActiveTab ?? "overview";
  target.previewPort = target.selectedSession?.preview.port === null ||
    target.selectedSession?.preview.port === undefined
    ? ""
    : String(target.selectedSession.preview.port);
}
