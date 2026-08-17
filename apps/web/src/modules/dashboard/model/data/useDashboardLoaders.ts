import { useCallback, useEffect, useRef } from "react";

import {
  API_UNAUTHORIZED_EVENT,
  CONNECTION_CONFIG_CHANGED_EVENT
} from "@api/connection/events";
import { agentSessionsApi } from "@api/endpoint/agentSessions/endpoints";
import { dashboardApi } from "@api/endpoint/dashboard/endpoints";
import { isApiRequestCanceled } from "@api/transport/errors";
import { toMessage } from "@lib/format";
import { AGENT_SESSIONS_INVALIDATED_EVENT } from "@models/agentSessions/contracts";
import { getDeskCueRuntime } from "@runtime";

import { AGENT_SESSIONS_PAGE_LIMIT, INITIAL_AGENT_SESSIONS_LIMIT } from "./dashboardConstants";
import type { LoadOptions } from "./dashboardLoad";
import {
  fetchManagedSessionDetail,
  fetchManagedSessionDetailWithMeta
} from "./managedSessionRequests";
import type {
  AgentSessionsLoadOptions,
  ManagedSessionLoadOutcome,
  UseDashboardLoadersArgs
} from "./types";

export function useDashboardLoaders({
  captureOverviewRevision,
  overviewRef,
  agentSessionsRef,
  runtimesRef,
  selectedSessionIdRef,
  selectedSessionSelectionEpochRef,
  selectedSessionRef,
  setOverview,
  setAgentSessionsPage,
  setAgentSessionsLoadState,
  appendAgentSessionsPage,
  setRuntimes,
  setSelectedSession,
  mergeSelectedSessionView,
  setErrorIfEmpty
}: UseDashboardLoadersArgs) {
  const agentSessionsRequestIdRef = useRef(0);
  const agentSessionsAbortControllerRef = useRef<AbortController | null>(null);
  const agentSessionsScopeRef = useRef<{
    query: string | null;
    sourceId: NonNullable<AgentSessionsLoadOptions["sourceId"]>;
  }>({ query: null, sourceId: "all" });
  const overviewRequestIdRef = useRef(0);
  const runtimesRequestIdRef = useRef(0);
  const selectedSessionRequestGenerationRef = useRef(0);
  const selectedSessionRequestIdsByViewRef = useRef(new Map<string, number>());

  useEffect(() => {
    const invalidateRequests = () => {
      overviewRequestIdRef.current += 1;
      runtimesRequestIdRef.current += 1;
      selectedSessionRequestGenerationRef.current += 1;
      selectedSessionRequestIdsByViewRef.current.clear();
      agentSessionsRequestIdRef.current += 1;
      agentSessionsAbortControllerRef.current?.abort();
      agentSessionsAbortControllerRef.current = null;
    };

    window.addEventListener(API_UNAUTHORIZED_EVENT, invalidateRequests);
    window.addEventListener(CONNECTION_CONFIG_CHANGED_EVENT, invalidateRequests);
    return () => {
      invalidateRequests();
      window.removeEventListener(API_UNAUTHORIZED_EVENT, invalidateRequests);
      window.removeEventListener(CONNECTION_CONFIG_CHANGED_EVENT, invalidateRequests);
    };
  }, []);

  const loadOverview = useCallback(async (options?: LoadOptions) => {
    const requestRevision = captureOverviewRevision();
    const requestId = overviewRequestIdRef.current + 1;
    overviewRequestIdRef.current = requestId;
    try {
      const nextOverview = await dashboardApi.getOverview();
      if (overviewRequestIdRef.current === requestId) {
        setOverview(nextOverview, requestRevision);
        return nextOverview;
      }
      return overviewRef.current;
    } catch (caughtError) {
      if (overviewRequestIdRef.current === requestId && !options?.silent) setErrorIfEmpty(toMessage(caughtError));

      return overviewRef.current;
    }
  }, [captureOverviewRevision, overviewRef, setErrorIfEmpty, setOverview]);

  const loadAgentSessions = useCallback(async (options?: AgentSessionsLoadOptions) => {
    agentSessionsScopeRef.current = {
      query: null,
      sourceId: options?.sourceId ?? "all"
    };
    const requestId = agentSessionsRequestIdRef.current + 1;
    agentSessionsRequestIdRef.current = requestId;
    agentSessionsAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    agentSessionsAbortControllerRef.current = abortController;
    if (!options?.silent || agentSessionsRef.current.length === 0) setAgentSessionsLoadState("loading");

    try {
      const page = await agentSessionsApi.getList({
        includeLiveMetadata: true,
        limit: INITIAL_AGENT_SESSIONS_LIMIT,
        signal: abortController.signal,
        sourceId: options?.sourceId
      });
      if (agentSessionsRequestIdRef.current === requestId) setAgentSessionsPage(page);
      return page.sessions;
    } catch (caughtError) {
      if (isApiRequestCanceled(caughtError)) return agentSessionsRef.current;

      if (agentSessionsRequestIdRef.current === requestId) setAgentSessionsLoadState("failed");

      return agentSessionsRef.current;
    } finally {
      if (agentSessionsAbortControllerRef.current === abortController) agentSessionsAbortControllerRef.current = null;
    }
  }, [agentSessionsRef, setAgentSessionsLoadState, setAgentSessionsPage]);

  const loadMoreAgentSessions = useCallback(async (query?: string, options?: AgentSessionsLoadOptions) => {
    agentSessionsScopeRef.current = {
      query: query?.trim() || null,
      sourceId: options?.sourceId ?? "all"
    };
    const requestId = agentSessionsRequestIdRef.current + 1;
    agentSessionsRequestIdRef.current = requestId;
    agentSessionsAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    agentSessionsAbortControllerRef.current = abortController;

    try {
      const page = await agentSessionsApi.getList({
        includeLiveMetadata: true,
        limit: AGENT_SESSIONS_PAGE_LIMIT,
        offset: agentSessionsRef.current.length,
        query,
        signal: abortController.signal,
        sourceId: options?.sourceId
      });
      if (agentSessionsRequestIdRef.current === requestId) appendAgentSessionsPage(page);
      return page.sessions;
    } catch (caughtError) {
      if (isApiRequestCanceled(caughtError)) return agentSessionsRef.current;

      if (agentSessionsRequestIdRef.current === requestId) setErrorIfEmpty(toMessage(caughtError));
      return agentSessionsRef.current;
    } finally {
      if (agentSessionsAbortControllerRef.current === abortController) agentSessionsAbortControllerRef.current = null;
    }
  }, [agentSessionsRef, appendAgentSessionsPage, setErrorIfEmpty]);

  const searchAgentSessions = useCallback(async (
    query: string,
    options?: AgentSessionsLoadOptions
  ) => {
    agentSessionsScopeRef.current = {
      query: query.trim() || null,
      sourceId: options?.sourceId ?? "all"
    };
    const requestId = agentSessionsRequestIdRef.current + 1;
    agentSessionsRequestIdRef.current = requestId;
    agentSessionsAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    agentSessionsAbortControllerRef.current = abortController;

    try {
      const page = await agentSessionsApi.getList({
        includeLiveMetadata: true,
        limit: INITIAL_AGENT_SESSIONS_LIMIT,
        query,
        signal: abortController.signal,
        sourceId: options?.sourceId
      });
      if (agentSessionsRequestIdRef.current === requestId) setAgentSessionsPage(page);
      return page.sessions;
    } catch (caughtError) {
      if (isApiRequestCanceled(caughtError)) return agentSessionsRef.current;

      if (agentSessionsRequestIdRef.current === requestId && !options?.silent) setErrorIfEmpty(toMessage(caughtError));

      return agentSessionsRef.current;
    } finally {
      if (agentSessionsAbortControllerRef.current === abortController) agentSessionsAbortControllerRef.current = null;
    }
  }, [agentSessionsRef, setAgentSessionsPage, setErrorIfEmpty]);

  useEffect(() => {
    let refreshTimer: number | null = null;
    const scheduleExactCountRefresh = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        const scope = agentSessionsScopeRef.current;
        if (scope.query) {
          void searchAgentSessions(scope.query, {
            silent: true,
            sourceId: scope.sourceId
          });
          return;
        }

        void loadAgentSessions({
          silent: true,
          sourceId: scope.sourceId
        });
      }, 150);
    };

    window.addEventListener(AGENT_SESSIONS_INVALIDATED_EVENT, scheduleExactCountRefresh);
    return () => {
      window.removeEventListener(AGENT_SESSIONS_INVALIDATED_EVENT, scheduleExactCountRefresh);
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
  }, [loadAgentSessions, searchAgentSessions]);

  const loadRuntimes = useCallback(async (options?: LoadOptions) => {
    if (!getDeskCueRuntime().features.localRuntimes) {
      setRuntimes([]);
      return [];
    }
    const requestId = runtimesRequestIdRef.current + 1;
    runtimesRequestIdRef.current = requestId;
    try {
      const nextRuntimes = await dashboardApi.getRuntimes();
      if (runtimesRequestIdRef.current === requestId) {
        setRuntimes(nextRuntimes);
        return nextRuntimes;
      }
      return runtimesRef.current;
    } catch (caughtError) {
      if (runtimesRequestIdRef.current === requestId && !options?.silent) setErrorIfEmpty(toMessage(caughtError));

      return runtimesRef.current;
    }
  }, [runtimesRef, setErrorIfEmpty, setRuntimes]);

  const loadSession = useCallback(async (sessionId: string, options?: LoadOptions) => {
    const requestKey = options?.sessionView ?? "full";
    const requestId = (selectedSessionRequestIdsByViewRef.current.get(requestKey) ?? 0) + 1;
    selectedSessionRequestIdsByViewRef.current.set(requestKey, requestId);
    const requestGeneration = selectedSessionRequestGenerationRef.current;
    const selectionEpoch = selectedSessionSelectionEpochRef.current;
    try {
      const session = await fetchManagedSessionDetail(sessionId, {
        debugLogTail: options?.debugLogTail,
        force: options?.force,
        sessionView: options?.sessionView
      });
      if (
        selectedSessionRequestGenerationRef.current !== requestGeneration ||
        selectedSessionRequestIdsByViewRef.current.get(requestKey) !== requestId ||
        selectedSessionSelectionEpochRef.current !== selectionEpoch ||
        selectedSessionIdRef.current !== sessionId
      ) {
        return session;
      }

      if (session && options?.sessionView) {
        mergeSelectedSessionView(session, options.sessionView);
      } else {
        setSelectedSession(session ?? null);
      }
      return session;
    } catch (caughtError) {
      const ownsRequest =
        selectedSessionRequestGenerationRef.current === requestGeneration &&
        selectedSessionRequestIdsByViewRef.current.get(requestKey) === requestId &&
        selectedSessionSelectionEpochRef.current === selectionEpoch;
      if (ownsRequest && !options?.silent) setErrorIfEmpty(toMessage(caughtError));

      return selectedSessionIdRef.current === sessionId ? selectedSessionRef.current : null;
    }
  }, [
    mergeSelectedSessionView,
    selectedSessionIdRef,
    selectedSessionRef,
    selectedSessionSelectionEpochRef,
    setErrorIfEmpty,
    setSelectedSession
  ]);

  const loadSessionWithOutcome = useCallback(async (
    sessionId: string,
    options?: LoadOptions
  ): Promise<ManagedSessionLoadOutcome> => {
    const requestKey = options?.sessionView ?? "full";
    const requestId = (selectedSessionRequestIdsByViewRef.current.get(requestKey) ?? 0) + 1;
    selectedSessionRequestIdsByViewRef.current.set(requestKey, requestId);
    const requestGeneration = selectedSessionRequestGenerationRef.current;
    const selectionEpoch = selectedSessionSelectionEpochRef.current;
    try {
      const result = await fetchManagedSessionDetailWithMeta(sessionId, {
        debugLogTail: options?.debugLogTail,
        force: options?.force,
        sessionView: options?.sessionView
      });
      const session = result.data;
      if (
        selectedSessionRequestGenerationRef.current !== requestGeneration ||
        selectedSessionRequestIdsByViewRef.current.get(requestKey) !== requestId ||
        selectedSessionSelectionEpochRef.current !== selectionEpoch
      ) {
        return { kind: "superseded" };
      }
      if (!session) return { kind: "missing" };

      if (selectedSessionIdRef.current === sessionId) {
        if (options?.sessionView) {
          mergeSelectedSessionView(session, options.sessionView);
        } else {
          setSelectedSession(session);
        }
      }
      return { kind: "loaded", session };
    } catch (caughtError) {
      const message = toMessage(caughtError);
      if (
        selectedSessionRequestGenerationRef.current !== requestGeneration ||
        selectedSessionRequestIdsByViewRef.current.get(requestKey) !== requestId ||
        selectedSessionSelectionEpochRef.current !== selectionEpoch
      ) {
        return { kind: "superseded" };
      }
      if (!options?.silent) setErrorIfEmpty(message);
      return { kind: "error", message };
    }
  }, [
    mergeSelectedSessionView,
    selectedSessionIdRef,
    selectedSessionSelectionEpochRef,
    setErrorIfEmpty,
    setSelectedSession
  ]);

  return {
    loadOverview,
    loadAgentSessions,
    loadMoreAgentSessions,
    searchAgentSessions,
    loadRuntimes,
    loadSession,
    loadSessionWithOutcome
  };
}
