import type { AgentKind, LocalLlmChatSummary, SessionSummary } from "@deskcue/protocol";
import { getSourceSessionKey, isManagedSessionActivelyAttached } from "@models/agentChatWorkState";
import type { AgentSessionsLoadState } from "@models/agentSessions/contracts";
import type { SourceCard } from "@models/dashboard/sourceCards";

export type AgentSessionsUnifiedListModelOptions = {
  agentSessionsCount: number;
  agentSessionsHasMore: boolean;
  agentSessionsLoadState: AgentSessionsLoadState;
  canLoadMoreSessions: boolean;
  canShowFewerSessions: boolean;
  filteredAgentSessionsCount: number;
  filteredLocalChatsCount: number;
  hiddenAgentSessionsCount: number;
  isLoadingMoreSessions: boolean;
  isSearchLoading: boolean;
  isSourceSwitching: boolean;
  localChatsCount: number;
  queryMatchedLocalChatsCount: number;
  query: string;
  selectedLocalRuntime: LocalLlmChatSummary["runtimeId"] | null;
  selectedSourceId: AgentKind | "all";
  sourceCards: SourceCard[];
  totalAgentSessionsCount: string;
};

export function selectAttachedSourceSessionKeys(managedSessions: SessionSummary[]) {
  return new Set(
    managedSessions.flatMap((session) => {
      if (!isManagedSessionActivelyAttached(session)) {
        return [];
      }
      const key = getSourceSessionKey(session.adapterId, session.sourceSessionId);
      return key ? [key] : [];
    })
  );
}

export function addCountLabel(countLabel: string, additionalCount: number) {
  const match = /^(\d+)(\+?)$/.exec(countLabel.trim());
  if (!match) {
    return countLabel;
  }

  return `${Number(match[1]) + additionalCount}${match[2]}`;
}

export function buildAgentSessionsUnifiedListModel({
  agentSessionsCount,
  agentSessionsHasMore,
  agentSessionsLoadState,
  canLoadMoreSessions,
  canShowFewerSessions,
  filteredAgentSessionsCount,
  filteredLocalChatsCount,
  hiddenAgentSessionsCount,
  isLoadingMoreSessions,
  isSearchLoading,
  isSourceSwitching,
  localChatsCount,
  queryMatchedLocalChatsCount,
  query,
  selectedLocalRuntime,
  selectedSourceId,
  sourceCards,
  totalAgentSessionsCount
}: AgentSessionsUnifiedListModelOptions) {
  const hasQuery = Boolean(query.trim());
  const allChatsCount = addCountLabel(
    totalAgentSessionsCount,
    hasQuery ? queryMatchedLocalChatsCount : localChatsCount
  );
  const selectedSourceSessionsCount = selectedLocalRuntime
    ? String(filteredLocalChatsCount)
    : selectedSourceId === "all"
      ? allChatsCount
      : sourceCards.find((source) => source.id === selectedSourceId)
          ?.sessionCountLabel ?? "0";
  const isInitialListLoading =
    agentSessionsLoadState === "loading" && agentSessionsCount === 0;
  const isListUnavailable = agentSessionsLoadState === "failed";
  const isListLoading =
    isInitialListLoading ||
    isSourceSwitching ||
    (isSearchLoading &&
      filteredAgentSessionsCount === 0 &&
      filteredLocalChatsCount === 0);
  const hasQueryOrRuntime = hasQuery || Boolean(selectedLocalRuntime);
  const isLocalOnlyQuery =
    hasQueryOrRuntime &&
    filteredAgentSessionsCount === 0 &&
    filteredLocalChatsCount > 0;

  return {
    allChatsCount,
    canLoadMoreSessions:
      selectedLocalRuntime || isLocalOnlyQuery ? false : canLoadMoreSessions,
    canShowFewerSessions: !selectedLocalRuntime && canShowFewerSessions,
    filteredSessionsCount:
      (selectedLocalRuntime ? 0 : filteredAgentSessionsCount) +
      filteredLocalChatsCount,
    hasMoreSessions: !selectedLocalRuntime && agentSessionsHasMore,
    hiddenSessionsCount:
      (selectedLocalRuntime ? 0 : hiddenAgentSessionsCount) +
      (hasQueryOrRuntime ? 0 : filteredLocalChatsCount),
    isListLoading,
    isListUnavailable,
    isLoadingMoreSessions,
    selectedSourceSessionsCount
  };
}
