import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AgentSessionSummary } from "@deskcue/protocol";
import { agentSessionsApi } from "@api/endpoint/agentSessions/endpoints";
import { isApiRequestCanceled } from "@api/transport/errors";
import {
  AGENT_SESSIONS_INVALIDATED_EVENT,
  AGENT_SESSION_SUMMARY_UPDATED_EVENT
} from "@models/agentSessions/contracts";
import type {
  AgentSessionSummaryUpdatedEventDetail
} from "@models/agentSessions/contracts";

import {
  mergeSubagentSessions,
  selectDirectSubagentSessions
} from "./model";

const SUBAGENT_SESSION_LIMIT = 100;
const SUBAGENT_REFRESH_DELAY_MS = 150;

type LiveSubagentSession = {
  revision: number;
  session: AgentSessionSummary;
};

class SubagentRefreshSubscription {
  private abortController: AbortController | null = null;
  private timerId: number | null = null;

  constructor(
    private readonly load: (signal?: AbortSignal) => Promise<void>,
    private readonly onSummaryUpdated: (session: AgentSessionSummary) => void
  ) {}

  readonly schedule = () => {
    if (this.timerId !== null) window.clearTimeout(this.timerId);
    this.timerId = window.setTimeout(() => {
      this.timerId = null;
      this.abortController?.abort();
      this.abortController = new AbortController();
      void this.load(this.abortController.signal);
    }, SUBAGENT_REFRESH_DELAY_MS);
  };

  start() {
    window.addEventListener(AGENT_SESSIONS_INVALIDATED_EVENT, this.schedule);
    window.addEventListener(AGENT_SESSION_SUMMARY_UPDATED_EVENT, this.handleSummaryUpdated);
  }

  stop() {
    window.removeEventListener(AGENT_SESSIONS_INVALIDATED_EVENT, this.schedule);
    window.removeEventListener(AGENT_SESSION_SUMMARY_UPDATED_EVENT, this.handleSummaryUpdated);
    if (this.timerId !== null) window.clearTimeout(this.timerId);
    this.abortController?.abort();
  }

  private readonly handleSummaryUpdated = (event: Event) => {
    const detail = (event as CustomEvent<AgentSessionSummaryUpdatedEventDetail>).detail;

    if (detail?.session) this.onSummaryUpdated(detail.session);
  };
}

type SubagentSessionsState = {
  fetchedSessions: AgentSessionSummary[];
  hasMore: boolean;
  parentSessionId: string;
  status: "idle" | "loading" | "ready" | "failed";
};

const emptyState: SubagentSessionsState = {
  fetchedSessions: [],
  hasMore: false,
  parentSessionId: "",
  status: "idle"
};

export function useSubagentSessions(
  knownSessions: AgentSessionSummary[],
  parentSessionId: string | null
) {
  const [state, setState] = useState<SubagentSessionsState>(emptyState);
  const requestIdRef = useRef(0);
  const liveRevisionRef = useRef(0);
  const liveSummariesRef = useRef(new Map<string, LiveSubagentSession>());

  const load = useCallback(async (signal?: AbortSignal) => {
    const requestId = requestIdRef.current + 1;
    const requestRevision = liveRevisionRef.current;

    requestIdRef.current = requestId;

    if (!parentSessionId) {
      setState(emptyState);

      return;
    }

    setState((current) => ({
      fetchedSessions: current.parentSessionId === parentSessionId
        ? current.fetchedSessions
        : [],
      hasMore: current.parentSessionId === parentSessionId && current.hasMore,
      parentSessionId,
      status: "loading"
    }));

    try {
      const page = await agentSessionsApi.getList({
        includeLiveMetadata: true,
        limit: SUBAGENT_SESSION_LIMIT,
        parentSessionId,
        signal
      });

      if (requestIdRef.current !== requestId) return;

      const summariesReceivedDuringRequest = Array.from(liveSummariesRef.current.values())
        .filter(({ revision }) => revision > requestRevision)
        .map(({ session }) => session);
      const mergedSessions = selectDirectSubagentSessions(
        mergeSubagentSessions(page.sessions, summariesReceivedDuringRequest),
        parentSessionId
      );

      setState({
        fetchedSessions: mergedSessions.slice(0, SUBAGENT_SESSION_LIMIT),
        hasMore: page.hasMore || mergedSessions.length > SUBAGENT_SESSION_LIMIT,
        parentSessionId,
        status: "ready"
      });

      for (const [sessionId, entry] of liveSummariesRef.current) {
        if (entry.revision <= requestRevision) liveSummariesRef.current.delete(sessionId);
      }
    } catch (error) {
      if (isApiRequestCanceled(error)) return;
      if (requestIdRef.current !== requestId) return;

      setState((current) => ({
        ...current,
        parentSessionId,
        status: "failed"
      }));
    }
  }, [parentSessionId]);

  const handleSummaryUpdated = useCallback((session: AgentSessionSummary) => {
    if (session.subagent?.parentSessionId !== parentSessionId) return;

    liveRevisionRef.current += 1;
    liveSummariesRef.current.set(session.id, {
      revision: liveRevisionRef.current,
      session
    });
    setState((current) => {
      const mergedSessions = selectDirectSubagentSessions(
        mergeSubagentSessions(current.fetchedSessions, [session]),
        parentSessionId
      );

      return {
        ...current,
        fetchedSessions: mergedSessions.slice(0, SUBAGENT_SESSION_LIMIT),
        hasMore: current.hasMore || mergedSessions.length > SUBAGENT_SESSION_LIMIT
      };
    });
  }, [parentSessionId]);

  useEffect(() => {
    const abortController = new AbortController();

    liveRevisionRef.current = 0;
    liveSummariesRef.current.clear();
    void load(abortController.signal);

    return () => abortController.abort();
  }, [load]);

  useEffect(() => {
    if (!parentSessionId) return;

    const subscription = new SubagentRefreshSubscription(load, handleSummaryUpdated);

    subscription.start();
    return () => subscription.stop();
  }, [handleSummaryUpdated, load, parentSessionId]);

  const knownChildren = useMemo(
    () => parentSessionId
      ? selectDirectSubagentSessions(knownSessions, parentSessionId)
      : [],
    [knownSessions, parentSessionId]
  );

  const mergedSessions = useMemo(
    () => selectDirectSubagentSessions(
      mergeSubagentSessions(state.fetchedSessions, knownChildren),
      parentSessionId ?? ""
    ),
    [knownChildren, parentSessionId, state.fetchedSessions]
  );

  const sessions = mergedSessions.slice(0, SUBAGENT_SESSION_LIMIT);
  const hasCurrentParentState = Boolean(parentSessionId) &&
    state.parentSessionId === parentSessionId;

  const retry = useCallback(() => load(), [load]);

  return {
    hasMore: state.hasMore || mergedSessions.length > SUBAGENT_SESSION_LIMIT,
    isLoading: Boolean(parentSessionId) &&
      (!hasCurrentParentState || state.status === "idle" || state.status === "loading"),
    loadFailed: hasCurrentParentState && state.status === "failed",
    sessions,
    retry
  };
}
