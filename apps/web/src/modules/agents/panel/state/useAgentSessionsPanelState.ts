import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { AgentSessionSummary } from "@deskcue/protocol";
import type { AgentSessionsPanelProps } from "@modules/agents/types";

import {
  AGENT_SESSIONS_COMPACT_MEDIA_QUERY,
  AGENT_SESSIONS_MOBILE_MEDIA_QUERY,
  filterAndSortAgentSessionsByQuery,
  INITIAL_VISIBLE_SESSIONS,
  isEditableKeyboardTarget,
  VISIBLE_SESSIONS_INCREMENT
} from "./helpers";
import { useAgentSessionsSearchState } from "./search/useAgentSessionsSearchState";

function createMediaQueryChangeHandler(
  mediaQuery: MediaQueryList,
  setMatches: Dispatch<SetStateAction<boolean>>
) {
  return () => setMatches(mediaQuery.matches);
}

function createAgentSessionsKeyDownHandler(onClearSelection: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    if (event.defaultPrevented) return;
    if (isEditableKeyboardTarget(event.target)) return;

    onClearSelection();
  };
}

export function useAgentSessionsPanelState(props: AgentSessionsPanelProps) {
  const {
    agentSessions,
    agentSessionsHasMore,
    agentSessionsQuery,
    defaultCollapsed = false,
    selectedAgentSession,
    selectedAgentSessionId,
    selectedSourceId,
    onLoadMoreAgentSessions,
    onReloadAgentSessions,
    onSearchAgentSessions,
    onClearAgentSessionSelection,
    onSelectSource,
    onSelectAgentSession
  } = props;

  const [isCompactViewport, setIsCompactViewport] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(AGENT_SESSIONS_COMPACT_MEDIA_QUERY).matches : false
  );
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(AGENT_SESSIONS_MOBILE_MEDIA_QUERY).matches : false
  );
  const [visibleSessionsCount, setVisibleSessionsCount] = useState(INITIAL_VISIBLE_SESSIONS);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [isLoadingMoreSessions, setIsLoadingMoreSessions] = useState(false);
  const [settlingAgentSessionId, setSettlingAgentSessionId] = useState("");
  const [optimisticSelectedAgentSessionSummary, setOptimisticSelectedAgentSessionSummary] =
    useState<AgentSessionSummary | null>(null);
  const {
    handleSelectSource,
    isSearchLoading,
    isSourceSwitching,
    query,
    setQuery
  } = useAgentSessionsSearchState({
    agentSessionsQuery,
    onReloadAgentSessions,
    onSearchAgentSessions,
    onSelectSource,
    selectedSourceId
  });

  const filteredByQuery = useMemo(() => {
    return filterAndSortAgentSessionsByQuery(agentSessions, query);
  }, [agentSessions, query]);

  const visibleSessions = useMemo(
    () => filteredByQuery.slice(0, visibleSessionsCount),
    [filteredByQuery, visibleSessionsCount]
  );

  const selectedAgentSessionSummary = useMemo(
    () =>
      agentSessions.find((session) => session.id === selectedAgentSessionId) ??
      (optimisticSelectedAgentSessionSummary?.id === selectedAgentSessionId
        ? optimisticSelectedAgentSessionSummary
        : null),
    [agentSessions, optimisticSelectedAgentSessionSummary, selectedAgentSessionId]
  );

  const hiddenSessionsCount = Math.max(filteredByQuery.length - visibleSessions.length, 0);
  const canShowFewerSessions = visibleSessionsCount > INITIAL_VISIBLE_SESSIONS;
  const canLoadMoreSessions = hiddenSessionsCount > 0 || agentSessionsHasMore;
  const showFocusedMobileDetail =
    isCompactViewport && Boolean(selectedAgentSessionId);
  const selectedAgentSessionDisplay = selectedAgentSession ?? selectedAgentSessionSummary;
  const isSelectedAgentSessionSettling = settlingAgentSessionId === selectedAgentSessionId;
  const hasSelectedAgentSession = Boolean(selectedAgentSessionId);

  const handleSelectAgentSession = useCallback((sessionId: string) => {
    setOptimisticSelectedAgentSessionSummary(
      agentSessions.find((session) => session.id === sessionId) ?? null
    );

    setSettlingAgentSessionId(sessionId);
    onSelectAgentSession(sessionId);
  }, [agentSessions, onSelectAgentSession]);

  const handleClearAgentSessionSelection = useCallback(() => {
    setOptimisticSelectedAgentSessionSummary(null);
    setSettlingAgentSessionId("");
    onClearAgentSessionSelection();
  }, [onClearAgentSessionSelection]);

  const showMoreSessions = useCallback(async () => {
    if (hiddenSessionsCount > 0) {
      setVisibleSessionsCount((current) =>
        Math.min(current + VISIBLE_SESSIONS_INCREMENT, filteredByQuery.length)
      );

      return;
    }

    if (!agentSessionsHasMore || isLoadingMoreSessions) {
      return;
    }

    setIsLoadingMoreSessions(true);

    try {
      await onLoadMoreAgentSessions(query, { sourceId: selectedSourceId });
      setVisibleSessionsCount((current) => current + VISIBLE_SESSIONS_INCREMENT);
    } finally {
      setIsLoadingMoreSessions(false);
    }
  }, [
    agentSessionsHasMore,
    filteredByQuery.length,
    hiddenSessionsCount,
    isLoadingMoreSessions,
    onLoadMoreAgentSessions,
    query,
    selectedSourceId
  ]);

  useEffect(() => {
    setCollapsed(defaultCollapsed);
  }, [defaultCollapsed]);

  useEffect(() => {
    setVisibleSessionsCount(INITIAL_VISIBLE_SESSIONS);
  }, [query, selectedSourceId]);

  useEffect(() => {
    if (!settlingAgentSessionId) {
      return;
    }

    const timer = window.setTimeout(() => {
      setSettlingAgentSessionId((current) => (current === settlingAgentSessionId ? "" : current));
    }, 320);

    return () => {
      window.clearTimeout(timer);
    };
  }, [settlingAgentSessionId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia(AGENT_SESSIONS_COMPACT_MEDIA_QUERY);
    const syncViewport = createMediaQueryChangeHandler(mediaQuery, setIsCompactViewport);

    syncViewport();
    mediaQuery.addEventListener("change", syncViewport);

    return () => {
      mediaQuery.removeEventListener("change", syncViewport);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia(AGENT_SESSIONS_MOBILE_MEDIA_QUERY);
    const syncViewport = createMediaQueryChangeHandler(mediaQuery, setIsMobileViewport);

    syncViewport();
    mediaQuery.addEventListener("change", syncViewport);

    return () => {
      mediaQuery.removeEventListener("change", syncViewport);
    };
  }, []);

  useEffect(() => {
    if (!selectedAgentSessionId || isCompactViewport) {
      return;
    }

    const handleKeyDown = createAgentSessionsKeyDownHandler(handleClearAgentSessionSelection);

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleClearAgentSessionSelection, isCompactViewport, selectedAgentSessionId]);

  return {
    collapsed,
    canLoadMoreSessions,
    canShowFewerSessions,
    filteredByQuery,
    hasSelectedAgentSession,
    hiddenSessionsCount,
    isCompactViewport,
    isLoadingMoreSessions,
    isMobileViewport,
    isSearchLoading,
    isSelectedAgentSessionSettling,
    isSourceSwitching,
    query,
    selectedAgentSessionDisplay,
    selectedAgentSessionSummary,
    showFocusedMobileDetail,
    visibleSessions,
    setCollapsed,
    setQuery,
    showFewerSessions: () => setVisibleSessionsCount(INITIAL_VISIBLE_SESSIONS),
    showMoreSessions,
    handleClearAgentSessionSelection,
    handleSelectSource,
    handleSelectAgentSession
  };
}
