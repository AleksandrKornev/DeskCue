import type {
  AgentSessionDetail,
  AgentSessionSourceCount,
  AgentSessionSummary
} from "@deskcue/protocol";

export type AgentSessionCollectionPatch = {
  activeTakenOverAgentSession?: AgentSessionDetail | null;
  agentSessions?: AgentSessionSummary[];
  agentSessionsHasMore?: boolean;
  agentSessionsQuery?: string | null;
  agentSessionsTotalCount?: number;
  agentSessionsTotalCountExact?: boolean;
  agentSessionSourceCounts?: AgentSessionSourceCount[];
  selectedAgentSession?: AgentSessionDetail | null;
};

type AgentSessionCollectionPatchTarget = {
  activeTakenOverAgentSession: AgentSessionDetail | null;
  agentSessions: AgentSessionSummary[];
  agentSessionsHasMore: boolean;
  agentSessionsQuery: string | null;
  agentSessionsTotalCount: number;
  agentSessionsTotalCountExact: boolean;
  agentSessionSourceCounts: AgentSessionSourceCount[];
  selectedAgentSession: AgentSessionDetail | null;
};

export function applyAgentSessionCollectionPatch(
  target: AgentSessionCollectionPatchTarget,
  patch: AgentSessionCollectionPatch
) {
  if (patch.agentSessions !== undefined) {
    target.agentSessions = patch.agentSessions;
  }
  if (patch.agentSessionsHasMore !== undefined) {
    target.agentSessionsHasMore = patch.agentSessionsHasMore;
  }
  if (patch.agentSessionsQuery !== undefined) {
    target.agentSessionsQuery = patch.agentSessionsQuery;
  }
  if (patch.agentSessionsTotalCount !== undefined) {
    target.agentSessionsTotalCount = patch.agentSessionsTotalCount;
  }
  if (patch.agentSessionsTotalCountExact !== undefined) {
    target.agentSessionsTotalCountExact = patch.agentSessionsTotalCountExact;
  }
  if (patch.agentSessionSourceCounts !== undefined) {
    target.agentSessionSourceCounts = patch.agentSessionSourceCounts;
  }
  if (patch.selectedAgentSession !== undefined) {
    target.selectedAgentSession = patch.selectedAgentSession;
  }
  if (patch.activeTakenOverAgentSession !== undefined) {
    target.activeTakenOverAgentSession = patch.activeTakenOverAgentSession;
  }
}
