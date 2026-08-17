import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

import {
  API_UNAUTHORIZED_EVENT,
  CONNECTION_CONFIG_CHANGED_EVENT
} from "@api/connection/events";
import { agentSessionsApi } from "@api/endpoint/agentSessions/endpoints";
import type { FetchAgentSessionChangesOptions } from "@api/endpoint/agentSessions/types";
import { agentChatDetailResource } from "@modules/dashboard/model/chatDetail/resource/agentChatDetailResource";
import type { DashboardStore } from "@modules/dashboard/model/store";

import {
  MAX_AGENT_TRANSCRIPT_HISTORY_BYTES,
  MAX_AGENT_TRANSCRIPT_HISTORY_PAGES
} from "./constants";
import { estimateAgentTranscriptPageBytes } from "./helpers";
import type { AgentTranscriptHistoryWindow } from "./types";

export function useAgentTranscriptPagination(store: DashboardStore) {
  const agentTranscriptHasMoreByIdRef = useRef(new Map<string, boolean>());
  const generationRef = useRef(0);
  const inFlightPagesRef = useRef(new Map<string, symbol>());
  const historyWindowsRef = useRef(new Map<string, AgentTranscriptHistoryWindow>());
  const [agentTranscriptHasMoreById, setAgentTranscriptHasMoreById] = useState<Map<string, boolean>>(
    () => new Map()
  );

  useEffect(() => {
    const clearConnectionScopedPagination = () => {
      generationRef.current += 1;
      inFlightPagesRef.current.clear();
      historyWindowsRef.current.clear();
      agentTranscriptHasMoreByIdRef.current = new Map();
      setAgentTranscriptHasMoreById(new Map());
    };

    window.addEventListener(API_UNAUTHORIZED_EVENT, clearConnectionScopedPagination);
    window.addEventListener(CONNECTION_CONFIG_CHANGED_EVENT, clearConnectionScopedPagination);
    return () => {
      clearConnectionScopedPagination();
      window.removeEventListener(API_UNAUTHORIZED_EVENT, clearConnectionScopedPagination);
      window.removeEventListener(CONNECTION_CONFIG_CHANGED_EVENT, clearConnectionScopedPagination);
    };
  }, []);

  const updateHasMore = useCallback((agentSessionId: string, hasMore: boolean) => {
    agentTranscriptHasMoreByIdRef.current = new Map(agentTranscriptHasMoreByIdRef.current).set(
      agentSessionId,
      hasMore
    );
    setAgentTranscriptHasMoreById(agentTranscriptHasMoreByIdRef.current);
  }, []);

  const loadMoreAgentSessionTranscript = useCallback(async (
    agentSessionId: string,
    beforeEntryId: string
  ) => {
    if (!agentSessionId || !beforeEntryId) {
      return 0;
    }

    if (agentTranscriptHasMoreByIdRef.current.get(agentSessionId) === false) {
      return 0;
    }

    const pageKey = `${agentSessionId}\u0000${beforeEntryId}`;
    if (inFlightPagesRef.current.has(pageKey)) {
      return 0;
    }

    const generation = generationRef.current;
    const requestToken = Symbol(pageKey);
    inFlightPagesRef.current.set(pageKey, requestToken);

    try {
      const page = await agentSessionsApi.getTranscriptPage(agentSessionId, {
        beforeEntryId
      });
      if (generationRef.current !== generation) {
        return 0;
      }

      const currentWindow = historyWindowsRef.current.get(agentSessionId) ?? {
        bytes: 0,
        pages: 0
      };
      const pageBytes = estimateAgentTranscriptPageBytes(page);
      if (
        currentWindow.pages >= MAX_AGENT_TRANSCRIPT_HISTORY_PAGES ||
        currentWindow.bytes + pageBytes > MAX_AGENT_TRANSCRIPT_HISTORY_BYTES
      ) {
        updateHasMore(agentSessionId, false);
        return 0;
      }

      store.mergeFetchedAgentSessionTranscriptPage(agentSessionId, page);
      const nextWindow = {
        bytes: currentWindow.bytes + pageBytes,
        pages: currentWindow.pages + 1
      };
      historyWindowsRef.current.set(agentSessionId, nextWindow);
      updateHasMore(
        agentSessionId,
        page.hasMore && nextWindow.pages < MAX_AGENT_TRANSCRIPT_HISTORY_PAGES
      );
      return page.entries.filter((entry) => entry.role === "user" || entry.role === "assistant").length;
    } finally {
      if (inFlightPagesRef.current.get(pageKey) === requestToken) {
        inFlightPagesRef.current.delete(pageKey);
      }
    }
  }, [store, updateHasMore]);

  const hydrateAgentSessionTranscriptEntries = useCallback((
    agentSessionId: string,
    entryIds: string[]
  ) => agentChatDetailResource.hydrateTranscriptEntries(agentSessionId, entryIds), []);
  const hydrateAgentSessionChanges = useCallback((
    agentSessionId: string,
    groupId: string,
    sourceRefs?: FetchAgentSessionChangesOptions
  ) => agentChatDetailResource.hydrateChanges(agentSessionId, groupId, sourceRefs), []);

  return {
    agentTranscriptHasMoreById,
    hydrateAgentSessionChanges,
    hydrateAgentSessionTranscriptEntries,
    loadMoreAgentSessionTranscript
  };
}
