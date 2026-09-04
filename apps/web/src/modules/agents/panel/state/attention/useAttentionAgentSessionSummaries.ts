import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import type { Dispatch, SetStateAction } from "react";

import type { AgentKind, AgentSessionSummary } from "@deskcue/protocol";
import {
  API_UNAUTHORIZED_EVENT,
  CONNECTION_CONFIG_CHANGED_EVENT
} from "@api/connection/events";
import { agentSessionsApi } from "@api/endpoint/agentSessions/endpoints";
import {
  AGENT_SESSIONS_INVALIDATED_EVENT,
  AGENT_SESSION_SUMMARY_UPDATED_EVENT
} from "@models/agentSessions/contracts";
import type {
  AgentSessionSummaryUpdatedEventDetail
} from "@models/agentSessions/contracts";

import {
  ATTENTION_AGENT_SESSION_LIMIT,
  ATTENTION_AGENT_SESSION_REFRESH_DELAY_MS
} from "./constants";
import { mergeAttentionSessions } from "./helpers";

type MutableValue<T> = { current: T };

type LiveAttentionSession = {
  revision: number;
  session: AgentSessionSummary;
};

type AttentionSessionEventControllerOptions = {
  abortControllerRef: MutableValue<AbortController | null>;
  liveRevisionRef: MutableValue<number>;
  liveSummariesRef: MutableValue<Map<string, LiveAttentionSession>>;
  refresh: () => Promise<void>;
  refreshAgainRef: MutableValue<boolean>;
  refreshTimerRef: MutableValue<number | null>;
  setHasLoaded: Dispatch<SetStateAction<boolean>>;
  setHasMore: Dispatch<SetStateAction<boolean>>;
  setSessions: Dispatch<SetStateAction<AgentSessionSummary[]>>;
  sessionsRef: MutableValue<AgentSessionSummary[]>;
  sourceId: AgentKind | "all";
};

function exceedsAttentionSessionLimit(...sessionGroups: AgentSessionSummary[][]) {
  return new Set(
    sessionGroups.flatMap((sessions) => sessions.map((session) => session.id))
  ).size > ATTENTION_AGENT_SESSION_LIMIT;
}

class AttentionSessionEventController implements EventListenerObject {
  constructor(private readonly options: AttentionSessionEventControllerOptions) {}

  handleEvent(event: Event) {
    switch (event.type) {
      case AGENT_SESSIONS_INVALIDATED_EVENT:
        this.scheduleRefresh();
        break;
      case AGENT_SESSION_SUMMARY_UPDATED_EVENT:
        this.applyLiveSummary(event);
        break;
      case API_UNAUTHORIZED_EVENT:
        this.clearConnectionState();
        break;
      case CONNECTION_CONFIG_CHANGED_EVENT:
        this.clearConnectionState();
        void this.options.refresh();
        break;
    }
  }

  dispose() {
    const { abortControllerRef, refreshAgainRef, refreshTimerRef } = this.options;

    refreshAgainRef.current = false;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }

  private scheduleRefresh() {
    const { refresh, refreshTimerRef } = this.options;

    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }

    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void refresh();
    }, ATTENTION_AGENT_SESSION_REFRESH_DELAY_MS);
  }

  private applyLiveSummary(event: Event) {
    const {
      liveRevisionRef,
      liveSummariesRef,
      setHasMore,
      setSessions,
      sessionsRef,
      sourceId
    } = this.options;
    const detail = (event as CustomEvent<AgentSessionSummaryUpdatedEventDetail>).detail;

    if (!detail?.session) return;
    if (sourceId !== "all" && detail.session.agentId !== sourceId) return;

    const isNewSession = !sessionsRef.current.some((session) => session.id === detail.session.id);

    if (isNewSession && sessionsRef.current.length >= ATTENTION_AGENT_SESSION_LIMIT) {
      setHasMore(true);
    }

    liveRevisionRef.current += 1;
    liveSummariesRef.current.set(detail.session.id, {
      revision: liveRevisionRef.current,
      session: detail.session
    });

    const nextSessions = mergeAttentionSessions(sessionsRef.current, [detail.session]);

    sessionsRef.current = nextSessions;
    setSessions(nextSessions);
  }

  private clearConnectionState() {
    const {
      abortControllerRef,
      liveRevisionRef,
      liveSummariesRef,
      refreshAgainRef,
      setHasLoaded,
      setHasMore,
      setSessions,
      sessionsRef
    } = this.options;

    abortControllerRef.current?.abort();
    refreshAgainRef.current = false;
    liveRevisionRef.current = 0;
    liveSummariesRef.current.clear();
    sessionsRef.current = [];
    setSessions([]);
    setHasMore(false);
    setHasLoaded(false);
  }
}

/** Loads the bounded source-scoped page used only by the compact attention rail. */
export function useAttentionAgentSessionSummaries(
  enabled = true,
  sourceId: AgentKind | "all" = "all"
) {
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const sessionsRef = useRef<AgentSessionSummary[]>([]);
  const activeRef = useRef(true);
  const inFlightRef = useRef(false);
  const refreshAgainRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const scopeRevisionRef = useRef(0);
  const liveRevisionRef = useRef(0);
  const liveSummariesRef = useRef(
    new Map<string, LiveAttentionSession>()
  );

  const refresh = useCallback(async () => {
    const scopeRevision = scopeRevisionRef.current;

    if (inFlightRef.current) {
      refreshAgainRef.current = true;
      return;
    }

    inFlightRef.current = true;
    do {
      refreshAgainRef.current = false;
      const requestRevision = liveRevisionRef.current;
      const abortController = new AbortController();

      abortControllerRef.current = abortController;

      try {
        const page = await agentSessionsApi.getList({
          includeLiveMetadata: true,
          limit: ATTENTION_AGENT_SESSION_LIMIT,
          signal: abortController.signal,
          sourceId
        });

        if (
          activeRef.current &&
          scopeRevision === scopeRevisionRef.current &&
          !abortController.signal.aborted
        ) {
          const summariesReceivedDuringRequest = Array.from(
            liveSummariesRef.current.values()
          )
            .filter(({ revision }) => revision > requestRevision)
            .map(({ session }) => session);
          const nextSessions = mergeAttentionSessions(
            page.sessions,
            summariesReceivedDuringRequest
          );

          sessionsRef.current = nextSessions;
          setSessions(nextSessions);
          setHasMore(
            Boolean(page.hasMore) ||
            exceedsAttentionSessionLimit(page.sessions, summariesReceivedDuringRequest)
          );

          setHasLoaded(true);

          for (const [sessionId, entry] of liveSummariesRef.current) {
            if (entry.revision <= requestRevision) {
              liveSummariesRef.current.delete(sessionId);
            }
          }
        }
      } catch {
        // The attention rail is optional; the main source list owns visible errors.
        if (
          activeRef.current &&
          scopeRevision === scopeRevisionRef.current &&
          !abortController.signal.aborted
        ) {
          setHasLoaded(true);
        }
      } finally {
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
      }
    } while (
      activeRef.current &&
      scopeRevision === scopeRevisionRef.current &&
      refreshAgainRef.current
    );
    if (scopeRevision === scopeRevisionRef.current) {
      inFlightRef.current = false;
    }
  }, [sourceId]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    scopeRevisionRef.current += 1;
    activeRef.current = true;
    inFlightRef.current = false;
    refreshAgainRef.current = false;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    liveRevisionRef.current = 0;
    liveSummariesRef.current.clear();
    sessionsRef.current = [];
    setSessions([]);
    setHasMore(false);
    setHasLoaded(false);
    void refresh();
    const eventController = new AttentionSessionEventController({
      abortControllerRef,
      liveRevisionRef,
      liveSummariesRef,
      refresh,
      refreshAgainRef,
      refreshTimerRef,
      setHasLoaded,
      setHasMore,
      setSessions,
      sessionsRef,
      sourceId
    });

    window.addEventListener(AGENT_SESSIONS_INVALIDATED_EVENT, eventController);
    window.addEventListener(AGENT_SESSION_SUMMARY_UPDATED_EVENT, eventController);
    window.addEventListener(API_UNAUTHORIZED_EVENT, eventController);
    window.addEventListener(CONNECTION_CONFIG_CHANGED_EVENT, eventController);

    return () => {
      scopeRevisionRef.current += 1;
      activeRef.current = false;
      inFlightRef.current = false;
      eventController.dispose();
      window.removeEventListener(AGENT_SESSIONS_INVALIDATED_EVENT, eventController);
      window.removeEventListener(AGENT_SESSION_SUMMARY_UPDATED_EVENT, eventController);
      window.removeEventListener(API_UNAUTHORIZED_EVENT, eventController);
      window.removeEventListener(CONNECTION_CONFIG_CHANGED_EVENT, eventController);
    };
  }, [enabled, refresh, sourceId]);

  return { hasLoaded, hasMore, sessions };
}
