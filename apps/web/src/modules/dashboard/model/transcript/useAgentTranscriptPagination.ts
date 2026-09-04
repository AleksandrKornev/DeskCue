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

type MutableValueRef<T> = {
  current: T;
};

type AgentTranscriptPaginationResetState = {
  generationRef: MutableValueRef<number>;
  inFlightPagesRef: MutableValueRef<Map<string, symbol>>;
  historyWindowsRef: MutableValueRef<Map<string, AgentTranscriptHistoryWindow>>;
  agentTranscriptHasMoreByIdRef: MutableValueRef<Map<string, boolean>>;
  agentTranscriptHistoryIncompleteByIdRef: MutableValueRef<Map<string, boolean>>;
  setAgentTranscriptHasMoreById: (value: Map<string, boolean>) => void;
  setAgentTranscriptHistoryIncompleteById: (value: Map<string, boolean>) => void;
};

class AgentTranscriptPaginationResetListener implements EventListenerObject {
  constructor(private readonly state: AgentTranscriptPaginationResetState) {}

  handleEvent() {
    this.reset();
  }

  reset() {
    this.state.generationRef.current += 1;
    this.state.inFlightPagesRef.current.clear();
    this.state.historyWindowsRef.current.clear();
    this.state.agentTranscriptHasMoreByIdRef.current = new Map();
    this.state.agentTranscriptHistoryIncompleteByIdRef.current = new Map();
    this.state.setAgentTranscriptHasMoreById(new Map());
    this.state.setAgentTranscriptHistoryIncompleteById(new Map());
  }
}

export function useAgentTranscriptPagination(store: DashboardStore) {
  const agentTranscriptHasMoreByIdRef = useRef(new Map<string, boolean>());
  const agentTranscriptHistoryIncompleteByIdRef = useRef(new Map<string, boolean>());
  const generationRef = useRef(0);
  const inFlightPagesRef = useRef(new Map<string, symbol>());
  const historyWindowsRef = useRef(new Map<string, AgentTranscriptHistoryWindow>());
  const [agentTranscriptHasMoreById, setAgentTranscriptHasMoreById] = useState<Map<string, boolean>>(
    () => new Map()
  );
  const [
    agentTranscriptHistoryIncompleteById,
    setAgentTranscriptHistoryIncompleteById
  ] = useState<Map<string, boolean>>(() => new Map());

  useEffect(() => {
    const resetListener = new AgentTranscriptPaginationResetListener({
      agentTranscriptHasMoreByIdRef,
      agentTranscriptHistoryIncompleteByIdRef,
      generationRef,
      historyWindowsRef,
      inFlightPagesRef,
      setAgentTranscriptHasMoreById,
      setAgentTranscriptHistoryIncompleteById
    });

    window.addEventListener(API_UNAUTHORIZED_EVENT, resetListener);
    window.addEventListener(CONNECTION_CONFIG_CHANGED_EVENT, resetListener);
    return () => {
      resetListener.reset();
      window.removeEventListener(API_UNAUTHORIZED_EVENT, resetListener);
      window.removeEventListener(CONNECTION_CONFIG_CHANGED_EVENT, resetListener);
    };
  }, []);

  const updatePaginationState = useCallback((
    agentSessionId: string,
    canLoadMore: boolean,
    historyIncomplete: boolean
  ) => {
    agentTranscriptHasMoreByIdRef.current = new Map(agentTranscriptHasMoreByIdRef.current).set(
      agentSessionId,
      canLoadMore
    );
    agentTranscriptHistoryIncompleteByIdRef.current = new Map(
      agentTranscriptHistoryIncompleteByIdRef.current
    ).set(
      agentSessionId,
      historyIncomplete
    );
    setAgentTranscriptHasMoreById(agentTranscriptHasMoreByIdRef.current);
    setAgentTranscriptHistoryIncompleteById(agentTranscriptHistoryIncompleteByIdRef.current);
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
        updatePaginationState(agentSessionId, false, true);
        return 0;
      }

      store.mergeFetchedAgentSessionTranscriptPage(agentSessionId, page);
      const nextWindow = {
        bytes: currentWindow.bytes + pageBytes,
        pages: currentWindow.pages + 1
      };

      historyWindowsRef.current.set(agentSessionId, nextWindow);
      updatePaginationState(
        agentSessionId,
        page.hasMore &&
          nextWindow.pages < MAX_AGENT_TRANSCRIPT_HISTORY_PAGES &&
          nextWindow.bytes < MAX_AGENT_TRANSCRIPT_HISTORY_BYTES,
        page.hasMore
      );

      return page.entries.filter((entry) => entry.role === "user" || entry.role === "assistant").length;
    } finally {
      if (inFlightPagesRef.current.get(pageKey) === requestToken) {
        inFlightPagesRef.current.delete(pageKey);
      }
    }
  }, [store, updatePaginationState]);

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
    agentTranscriptHistoryIncompleteById,
    hydrateAgentSessionChanges,
    hydrateAgentSessionTranscriptEntries,
    loadMoreAgentSessionTranscript
  };
}
