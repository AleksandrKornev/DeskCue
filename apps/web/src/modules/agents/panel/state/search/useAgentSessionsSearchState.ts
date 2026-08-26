import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

import {
  readAgentBrowserQuery,
  rememberAgentBrowserQuery
} from "@modules/agents/panel/state/agentBrowserListMemory";
import { SOURCE_SWITCH_MIN_PLACEHOLDER_MS } from "@modules/agents/panel/state/helpers";
import type { AgentSessionsPanelProps } from "@modules/agents/types";

import type { SelectedSourceId } from "./types";

export function useAgentSessionsSearchState({
  agentSessionsQuery,
  onReloadAgentSessions,
  onSearchAgentSessions,
  onSelectSource,
  selectedSourceId
}: Pick<
  AgentSessionsPanelProps,
  | "agentSessionsQuery"
  | "onReloadAgentSessions"
  | "onSearchAgentSessions"
  | "onSelectSource"
  | "selectedSourceId"
>) {
  const [query, setQueryState] = useState(() => readAgentBrowserQuery());
  const [isSearchRequestPending, setIsSearchRequestPending] = useState(false);
  const [pendingSourceId, setPendingSourceId] = useState<SelectedSourceId | null>(null);
  const searchRequestIdRef = useRef(0);
  const loadedSourceIdRef = useRef<SelectedSourceId | null>(null);
  const loadedSearchSourceIdRef = useRef<SelectedSourceId | null>(null);
  const sourceSwitchStartedAtRef = useRef(0);
  const sourceSwitchGenerationRef = useRef(0);
  const sourceSwitchCompletionTimerRef = useRef<number | null>(null);

  const normalizedQuery = query.trim().toLowerCase();
  const isSourceReloadPending = !normalizedQuery && pendingSourceId === selectedSourceId;
  const isSourceLoadUninitialized =
    !normalizedQuery &&
    selectedSourceId !== "all" &&
    loadedSourceIdRef.current !== selectedSourceId;
  const isSearchLoading =
    isSearchRequestPending ||
    (normalizedQuery ? agentSessionsQuery !== normalizedQuery : agentSessionsQuery !== null);
  const isSourceSwitching = isSourceReloadPending || isSourceLoadUninitialized;
  const setQuery = useCallback((value: string) => {
    rememberAgentBrowserQuery(value);
    setQueryState(value);
  }, []);

  useEffect(() => {
    return () => rememberAgentBrowserQuery(query);
  }, [query]);

  const beginSourceSwitch = useCallback((sourceId: SelectedSourceId) => {
    sourceSwitchGenerationRef.current += 1;
    if (sourceSwitchCompletionTimerRef.current !== null) {
      window.clearTimeout(sourceSwitchCompletionTimerRef.current);
      sourceSwitchCompletionTimerRef.current = null;
    }

    sourceSwitchStartedAtRef.current = performance.now();
    setPendingSourceId(sourceId);
    return sourceSwitchGenerationRef.current;
  }, []);

  const completeSourceSwitch = useCallback((
    sourceId: SelectedSourceId,
    generation: number
  ) => {
    if (sourceSwitchGenerationRef.current !== generation) return;

    const elapsedMs = performance.now() - sourceSwitchStartedAtRef.current;
    const remainingMs = Math.max(SOURCE_SWITCH_MIN_PLACEHOLDER_MS - elapsedMs, 0);

    sourceSwitchCompletionTimerRef.current = window.setTimeout(() => {
      sourceSwitchCompletionTimerRef.current = null;
      if (sourceSwitchGenerationRef.current === generation) {
        setPendingSourceId((current) => (current === sourceId ? null : current));
      }
    }, remainingMs);
  }, []);

  const handleSelectSource = useCallback((sourceId: SelectedSourceId) => {
    loadedSourceIdRef.current = sourceId;
    onSelectSource(sourceId);

    if (query.trim()) return;

    const requestId = searchRequestIdRef.current + 1;

    searchRequestIdRef.current = requestId;
    const switchGeneration = beginSourceSwitch(sourceId);

    setIsSearchRequestPending(true);

    void onReloadAgentSessions({ sourceId }).finally(() => {
      completeSourceSwitch(sourceId, switchGeneration);
      if (searchRequestIdRef.current === requestId) setIsSearchRequestPending(false);
    });
  }, [beginSourceSwitch, completeSourceSwitch, onReloadAgentSessions, onSelectSource, query]);

  useEffect(() => {
    const trimmedQuery = query.trim();
    const nextNormalizedQuery = trimmedQuery.toLowerCase();
    const timer = window.setTimeout(() => {
      if (!trimmedQuery) {
        loadedSearchSourceIdRef.current = null;
        if (agentSessionsQuery !== null) {
          const requestId = searchRequestIdRef.current + 1;

          searchRequestIdRef.current = requestId;
          const switchGeneration = beginSourceSwitch(selectedSourceId);

          setIsSearchRequestPending(true);

          void onReloadAgentSessions({ sourceId: selectedSourceId }).finally(() => {
            if (searchRequestIdRef.current === requestId) {
              completeSourceSwitch(selectedSourceId, switchGeneration);
              setIsSearchRequestPending(false);
            }
          });
        } else {
          setIsSearchRequestPending(false);
        }

        return;
      }

      if (
        agentSessionsQuery === nextNormalizedQuery &&
        loadedSearchSourceIdRef.current === selectedSourceId
      ) {
        setIsSearchRequestPending(false);
        return;
      }

      setIsSearchRequestPending(true);
      const requestId = searchRequestIdRef.current + 1;

      searchRequestIdRef.current = requestId;

      void onSearchAgentSessions(trimmedQuery, {
        silent: true,
        sourceId: selectedSourceId
      }).finally(() => {
        if (searchRequestIdRef.current === requestId) {
          loadedSearchSourceIdRef.current = selectedSourceId;
          setIsSearchRequestPending(false);
        }
      });
    }, 360);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    agentSessionsQuery,
    beginSourceSwitch,
    completeSourceSwitch,
    onReloadAgentSessions,
    onSearchAgentSessions,
    query,
    selectedSourceId
  ]);

  useEffect(() => {
    if (query.trim()) {
      loadedSourceIdRef.current = null;
      setPendingSourceId(null);
      return;
    }

    if (selectedSourceId === "all") {
      loadedSourceIdRef.current = selectedSourceId;
      return;
    }

    if (loadedSourceIdRef.current === selectedSourceId) return;

    loadedSourceIdRef.current = selectedSourceId;
    const switchGeneration = beginSourceSwitch(selectedSourceId);

    void onReloadAgentSessions({ sourceId: selectedSourceId }).finally(() => {
      completeSourceSwitch(selectedSourceId, switchGeneration);
    });
  }, [beginSourceSwitch, completeSourceSwitch, onReloadAgentSessions, query, selectedSourceId]);

  useEffect(() => {
    return () => {
      sourceSwitchGenerationRef.current += 1;
      if (sourceSwitchCompletionTimerRef.current !== null) {
        window.clearTimeout(sourceSwitchCompletionTimerRef.current);
        sourceSwitchCompletionTimerRef.current = null;
      }
    };
  }, []);

  return {
    handleSelectSource,
    isSearchLoading,
    isSourceSwitching,
    query,
    setQuery
  };
}
