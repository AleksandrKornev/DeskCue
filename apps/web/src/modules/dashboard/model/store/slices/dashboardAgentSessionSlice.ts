import type {
  AgentKind,
  AgentSessionDetail,
  AgentSessionsResponse,
  AgentSessionSourceCount,
  AgentSessionSummary,
  AgentTranscriptEntry,
  AgentTranscriptViewResponse
} from "@deskcue/protocol";
import type { AgentSessionsLoadState } from "@models/agentSessions/contracts";
import type { AgentTranscriptHistoryProtection } from "@models/bounds/agentTranscriptBounds";
import {
  buildAgentSessionsListPatch,
  buildAgentSessionsPagePatch,
  buildAppendedAgentSessionsPagePatch,
  buildMergedAgentSessionSummaryPatch
} from "@modules/dashboard/model/store/collections/agentSessionCollection";
import { applyAgentSessionCollectionPatch } from "@modules/dashboard/model/store/collections/agentSessionCollectionPatch";
import {
  mergeAgentSessionDetail,
  mergeAgentSessionTranscriptPage
} from "@modules/dashboard/model/store/transcript/transcriptMerge";

import {
  applyAgentSessionReviewedAt,
  clearReadyForReviewSessionId,
  markReadyForReviewSessionId,
  reconcileReadyForReviewSessionIds
} from "./reviewState";

export type DashboardAgentSessionState = {
  activeTakenOverAgentSession: AgentSessionDetail | null;
  agentSessions: AgentSessionSummary[];
  agentSessionsHasMore: boolean;
  agentSessionsLoadState: AgentSessionsLoadState;
  agentSessionsQuery: string | null;
  agentSessionSourceCounts: AgentSessionSourceCount[];
  agentSessionsTotalCount: number;
  agentSessionsTotalCountExact: boolean;
  isActiveTakenOverAgentSessionLoading: boolean;
  isAgentSessionLoading: boolean;
  readyForReviewAgentSessionIds: string[];
  selectedAgentSession: AgentSessionDetail | null;
  selectedAgentSessionId: string;
  selectedAgentSessionRefreshNonce: number;
  selectedSourceId: AgentKind | "all";
  agentTranscriptHistoryProtectionById: Map<string, AgentTranscriptHistoryProtection>;
};

function reconcileReadyForReviewAgentSessions(
  state: DashboardAgentSessionState,
  sessions: AgentSessionSummary[]
) {
  state.readyForReviewAgentSessionIds = reconcileReadyForReviewSessionIds(
    state.readyForReviewAgentSessionIds,
    sessions
  );
}

export function setAgentSessions(
  state: DashboardAgentSessionState,
  value: AgentSessionSummary[]
) {
  applyAgentSessionCollectionPatch(state, buildAgentSessionsListPatch(value));
  state.agentSessionsLoadState = "ready";
  reconcileReadyForReviewAgentSessions(state, value);
}

export function setAgentSessionsPage(
  state: DashboardAgentSessionState,
  page: AgentSessionsResponse
) {
  applyAgentSessionCollectionPatch(state, buildAgentSessionsPagePatch(page));
  state.agentSessionsLoadState = "ready";
  reconcileReadyForReviewAgentSessions(state, page.sessions);
}

export function appendAgentSessionsPage(
  state: DashboardAgentSessionState,
  page: AgentSessionsResponse
) {
  applyAgentSessionCollectionPatch(
    state,
    buildAppendedAgentSessionsPagePatch(state.agentSessions, page)
  );
  reconcileReadyForReviewAgentSessions(state, page.sessions);
}

export function mergeAgentSessionSummary(
  state: DashboardAgentSessionState,
  summary: AgentSessionSummary
) {
  reconcileReadyForReviewAgentSessions(state, [summary]);
  const patch = buildMergedAgentSessionSummaryPatch(state, summary);
  if (patch) {
    applyAgentSessionCollectionPatch(state, patch);
  }
}

export function markAgentSessionReadyForReview(
  state: DashboardAgentSessionState,
  sessionId: string
) {
  state.readyForReviewAgentSessionIds = markReadyForReviewSessionId(
    state.readyForReviewAgentSessionIds,
    sessionId,
    state.selectedAgentSessionId
  );
}

export function clearAgentSessionReadyForReview(
  state: DashboardAgentSessionState,
  sessionId: string
) {
  state.readyForReviewAgentSessionIds = clearReadyForReviewSessionId(
    state.readyForReviewAgentSessionIds,
    sessionId
  );
}

export function markAgentSessionReviewedAt(
  state: DashboardAgentSessionState,
  sessionId: string,
  reviewedAt: string
) {
  clearAgentSessionReadyForReview(state, sessionId);
  state.agentSessions = state.agentSessions.map((session) =>
    applyAgentSessionReviewedAt(session, sessionId, reviewedAt)
  );
  state.selectedAgentSession = applyAgentSessionReviewedAt(
    state.selectedAgentSession,
    sessionId,
    reviewedAt
  );
  state.activeTakenOverAgentSession = applyAgentSessionReviewedAt(
    state.activeTakenOverAgentSession,
    sessionId,
    reviewedAt
  );
}

export function mergeSelectedAgentSessionDetail(
  state: DashboardAgentSessionState,
  detail: AgentSessionDetail
) {
  if (state.selectedAgentSessionId !== detail.id) {
    return;
  }

  state.selectedAgentSession = mergeAgentSessionDetail(
    state.selectedAgentSession,
    detail,
    state.agentTranscriptHistoryProtectionById.get(detail.id)
  );
}

export function mergeActiveTakenOverAgentSessionDetail(
  state: DashboardAgentSessionState,
  detail: AgentSessionDetail
) {
  if (state.activeTakenOverAgentSession?.id !== detail.id) {
    return;
  }

  state.activeTakenOverAgentSession = mergeAgentSessionDetail(
    state.activeTakenOverAgentSession,
    detail,
    state.agentTranscriptHistoryProtectionById.get(detail.id)
  );
}

function rememberTranscriptHistoryProtection(
  state: DashboardAgentSessionState,
  sessionId: string,
  page: { entries: AgentTranscriptEntry[]; transcriptView?: AgentTranscriptViewResponse }
) {
  const current = state.agentTranscriptHistoryProtectionById.get(sessionId);
  const protection: AgentTranscriptHistoryProtection = {
    entryIds: new Set([
      ...(current?.entryIds ?? []),
      ...page.entries.map((entry) => entry.id)
    ]),
    viewItemKeys: new Set([
      ...(current?.viewItemKeys ?? []),
      ...(page.transcriptView?.items.map((item) => item.key) ?? [])
    ])
  };
  state.agentTranscriptHistoryProtectionById.delete(sessionId);
  state.agentTranscriptHistoryProtectionById.set(sessionId, protection);
  while (state.agentTranscriptHistoryProtectionById.size > 8) {
    const oldestSessionId = state.agentTranscriptHistoryProtectionById.keys().next().value;
    if (!oldestSessionId) break;
    state.agentTranscriptHistoryProtectionById.delete(oldestSessionId);
  }
  return protection;
}

export function mergeFetchedAgentSessionTranscriptPage(
  state: DashboardAgentSessionState,
  sessionId: string,
  page: { entries: AgentTranscriptEntry[]; transcriptView?: AgentTranscriptViewResponse }
) {
  const historyProtection = rememberTranscriptHistoryProtection(state, sessionId, page);
  state.selectedAgentSession = mergeAgentSessionTranscriptPage(
    state.selectedAgentSession,
    sessionId,
    page,
    historyProtection
  );
  state.activeTakenOverAgentSession = mergeAgentSessionTranscriptPage(
    state.activeTakenOverAgentSession,
    sessionId,
    page,
    historyProtection
  );
}
