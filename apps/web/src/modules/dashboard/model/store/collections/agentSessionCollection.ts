import type {
  AgentKind,
  AgentSessionDetail,
  AgentSessionsResponse,
  AgentSessionSourceCount,
  AgentSessionSummary
} from "@deskcue/protocol";
import {
  isStructurallyEqual,
  isTimestampOlder
} from "@modules/dashboard/model/store/helpers";
import { mergeContextCompactionCount } from "@modules/dashboard/model/store/transcript/transcriptMerge";

export function sortAgentSessionSummariesByActivity(sessions: AgentSessionSummary[]) {
  sessions.sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  );
}

export function buildSourceCountsFromSessions(sessions: AgentSessionSummary[]): AgentSessionSourceCount[] {
  const counts = new Map<AgentKind, number>();
  for (const session of sessions) {
    counts.set(session.agentId, (counts.get(session.agentId) ?? 0) + 1);
  }

  return Array.from(counts.entries()).map(([agentId, count]) => ({
    agentId,
    count,
    exact: true
  }));
}

function mergeAgentSessionListSummary(
  current: AgentSessionSummary | undefined,
  incoming: AgentSessionSummary
) {
  if (!current) return incoming;

  if (isTimestampOlder(incoming.updatedAt, current.updatedAt)) return current;

  const contextCompactionCount = mergeContextCompactionCount(
    current.contextCompactionCount,
    incoming.contextCompactionCount
  );
  const model = incoming.model ?? current.model;
  return contextCompactionCount === incoming.contextCompactionCount && model === incoming.model
    ? incoming
    : {
        ...incoming,
        contextCompactionCount,
        model
      };
}

function mergeAgentSessionSummaryLists(
  current: AgentSessionSummary[],
  incoming: AgentSessionSummary[]
) {
  const sessionsById = new Map<string, AgentSessionSummary>();
  for (const session of current) {
    sessionsById.set(session.id, session);
  }
  for (const session of incoming) {
    sessionsById.set(session.id, mergeAgentSessionListSummary(sessionsById.get(session.id), session));
  }

  const mergedSessions = Array.from(sessionsById.values());
  sortAgentSessionSummariesByActivity(mergedSessions);
  return mergedSessions;
}

function matchesAgentSessionSummaryQuery(session: AgentSessionSummary, query: string) {
  return [
    session.id,
    session.sourceSessionId,
    session.title,
    session.workspaceName,
    session.workspacePath,
    session.agentLabel,
    session.model,
    session.source,
    session.filePath,
    session.approvalPolicy,
    session.sandboxMode
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function mergeAgentSessionSummary(
  current: AgentSessionDetail | null,
  summary: AgentSessionSummary
) {
  if (!current || current.id !== summary.id) return current;

  if (isTimestampOlder(summary.updatedAt, current.updatedAt)) return current;

  return {
    ...current,
    ...summary,
    model: summary.model ?? current.model,
    contextCompactionCount: mergeContextCompactionCount(
      current.contextCompactionCount,
      summary.contextCompactionCount
    ),
    transcript: current.transcript
  };
}

export interface AgentSessionCollectionState {
  activeTakenOverAgentSession: AgentSessionDetail | null;
  agentSessions: AgentSessionSummary[];
  agentSessionsHasMore: boolean;
  agentSessionsQuery: string | null;
  agentSessionsTotalCount: number;
  agentSessionsTotalCountExact: boolean;
  agentSessionSourceCounts: AgentSessionSourceCount[];
  selectedAgentSession: AgentSessionDetail | null;
}

export type AgentSessionCollectionPatch = Partial<AgentSessionCollectionState>;

type AgentSessionCollectionLiveState = AgentSessionCollectionState & {
  selectedSourceId: AgentKind | "all";
};

export function buildAgentSessionsListPatch(
  sessions: AgentSessionSummary[]
): AgentSessionCollectionPatch {
  return {
    agentSessions: sessions,
    agentSessionsHasMore: false,
    agentSessionsQuery: null,
    agentSessionsTotalCount: sessions.length,
    agentSessionsTotalCountExact: true,
    agentSessionSourceCounts: buildSourceCountsFromSessions(sessions)
  };
}

export function buildAgentSessionsPagePatch(
  page: AgentSessionsResponse
): AgentSessionCollectionPatch {
  return {
    agentSessions: page.sessions,
    agentSessionsHasMore: page.hasMore,
    agentSessionsQuery: page.query,
    agentSessionsTotalCount: page.totalCount,
    agentSessionsTotalCountExact: page.totalCountExact,
    ...(page.query === null ? { agentSessionSourceCounts: page.sourceCounts } : {})
  };
}

export function buildAppendedAgentSessionsPagePatch(
  currentSessions: AgentSessionSummary[],
  page: AgentSessionsResponse
): AgentSessionCollectionPatch {
  return {
    agentSessions: mergeAgentSessionSummaryLists(currentSessions, page.sessions),
    agentSessionsHasMore: page.hasMore,
    agentSessionsQuery: page.query,
    agentSessionsTotalCount: page.totalCount,
    agentSessionsTotalCountExact: page.totalCountExact,
    ...(page.query === null ? { agentSessionSourceCounts: page.sourceCounts } : {})
  };
}

export function buildMergedAgentSessionSummaryPatch(
  state: AgentSessionCollectionLiveState,
  summary: AgentSessionSummary
): AgentSessionCollectionPatch | null {
  const matchesActiveSource =
    state.selectedSourceId === "all" || summary.agentId === state.selectedSourceId;
  const matchesActiveQueryText =
    !state.agentSessionsQuery || matchesAgentSessionSummaryQuery(summary, state.agentSessionsQuery);
  const matchesActiveQuery =
    matchesActiveSource && matchesActiveQueryText;
  const existingSession = state.agentSessions.find((session) => session.id === summary.id) ?? null;
  const hasExistingSession = Boolean(existingSession);
  const mergedListSummary = mergeAgentSessionListSummary(existingSession ?? undefined, summary);
  const summaryUnchanged = existingSession
    ? isStructurallyEqual(existingSession, mergedListSummary)
    : false;
  const selectedAgentSession = mergeAgentSessionSummary(state.selectedAgentSession, summary);
  const activeTakenOverAgentSession = mergeAgentSessionSummary(
    state.activeTakenOverAgentSession,
    summary
  );

  if (
    summaryUnchanged &&
    selectedAgentSession === state.selectedAgentSession &&
    activeTakenOverAgentSession === state.activeTakenOverAgentSession
  ) {
    return null;
  }

  let agentSessions = hasExistingSession
    ? state.agentSessions
        .map((session) => (session.id === summary.id ? mergedListSummary : session))
        .filter((session) =>
          (state.selectedSourceId === "all" || session.agentId === state.selectedSourceId) &&
          (!state.agentSessionsQuery ||
            matchesAgentSessionSummaryQuery(session, state.agentSessionsQuery))
        )
    : matchesActiveQuery
      ? [mergedListSummary, ...state.agentSessions]
      : state.agentSessions;

  const unseenInActiveScope = !hasExistingSession && matchesActiveQuery;
  const hasKnownOffPageSessions =
    state.agentSessionsTotalCount > state.agentSessions.length;
  if (agentSessions !== state.agentSessions) {
    sortAgentSessionSummariesByActivity(agentSessions);
    if (unseenInActiveScope && hasKnownOffPageSessions) {
      // A live summary for an existing off-page session belongs at the top of
      // the visible window, but it must not make that bounded window grow.
      agentSessions = agentSessions.slice(0, Math.max(1, state.agentSessions.length));
    }
  }

  const removedFromActiveQuery = Boolean(
    existingSession && state.agentSessionsQuery && !matchesActiveQueryText
  );
  const addedToFullyLoadedScope = unseenInActiveScope && !hasKnownOffPageSessions;
  const totalCount = removedFromActiveQuery
    ? Math.max(agentSessions.length, state.agentSessionsTotalCount - 1)
    : addedToFullyLoadedScope
      ? state.agentSessionsTotalCount + 1
      : state.agentSessionsTotalCount;

  return {
    activeTakenOverAgentSession,
    agentSessions,
    agentSessionsTotalCount: totalCount,
    agentSessionsTotalCountExact: state.agentSessionsTotalCountExact,
    agentSessionSourceCounts: state.agentSessionSourceCounts,
    selectedAgentSession
  };
}
