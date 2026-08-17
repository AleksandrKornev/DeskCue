import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

import type { AgentSessionSummary } from "@deskcue/protocol";
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

/** Loads the bounded, unfiltered page used only by the mobile attention rail. */
export function useAttentionAgentSessionSummaries(enabled = true) {
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const activeRef = useRef(true);
  const inFlightRef = useRef(false);
  const refreshAgainRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const liveRevisionRef = useRef(0);
  const liveSummariesRef = useRef(
    new Map<string, { revision: number; session: AgentSessionSummary }>()
  );

  const refresh = useCallback(async () => {
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
          signal: abortController.signal
        });
        if (activeRef.current && !abortController.signal.aborted) {
          const summariesReceivedDuringRequest = Array.from(
            liveSummariesRef.current.values()
          )
            .filter(({ revision }) => revision > requestRevision)
            .map(({ session }) => session);
          setSessions(mergeAttentionSessions(
            page.sessions,
            summariesReceivedDuringRequest
          ));
          setHasLoaded(true);

          for (const [sessionId, entry] of liveSummariesRef.current) {
            if (entry.revision <= requestRevision) {
              liveSummariesRef.current.delete(sessionId);
            }
          }
        }
      } catch {
        // The attention rail is optional; the main source list owns visible errors.
        if (activeRef.current && !abortController.signal.aborted) {
          setHasLoaded(true);
        }
      } finally {
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
      }
    } while (activeRef.current && refreshAgainRef.current);
    inFlightRef.current = false;
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    activeRef.current = true;
    void refresh();

    const scheduleRefresh = () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        void refresh();
      }, ATTENTION_AGENT_SESSION_REFRESH_DELAY_MS);
    };
    const applyLiveSummary = (event: Event) => {
      const detail = (event as CustomEvent<AgentSessionSummaryUpdatedEventDetail>).detail;
      if (!detail?.session) {
        return;
      }

      liveRevisionRef.current += 1;
      liveSummariesRef.current.set(detail.session.id, {
        revision: liveRevisionRef.current,
        session: detail.session
      });
      setSessions((current) => mergeAttentionSessions(current, [detail.session]));
    };
    const clearConnectionState = () => {
      abortControllerRef.current?.abort();
      refreshAgainRef.current = false;
      liveRevisionRef.current = 0;
      liveSummariesRef.current.clear();
      setSessions([]);
      setHasLoaded(false);
    };
    const handleUnauthorized = () => {
      clearConnectionState();
    };
    const handleConnectionChange = () => {
      clearConnectionState();
      void refresh();
    };

    window.addEventListener(AGENT_SESSIONS_INVALIDATED_EVENT, scheduleRefresh);
    window.addEventListener(AGENT_SESSION_SUMMARY_UPDATED_EVENT, applyLiveSummary);
    window.addEventListener(API_UNAUTHORIZED_EVENT, handleUnauthorized);
    window.addEventListener(CONNECTION_CONFIG_CHANGED_EVENT, handleConnectionChange);

    return () => {
      activeRef.current = false;
      refreshAgainRef.current = false;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      window.removeEventListener(AGENT_SESSIONS_INVALIDATED_EVENT, scheduleRefresh);
      window.removeEventListener(AGENT_SESSION_SUMMARY_UPDATED_EVENT, applyLiveSummary);
      window.removeEventListener(API_UNAUTHORIZED_EVENT, handleUnauthorized);
      window.removeEventListener(CONNECTION_CONFIG_CHANGED_EVENT, handleConnectionChange);
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [enabled, refresh]);

  return { hasLoaded, sessions };
}
