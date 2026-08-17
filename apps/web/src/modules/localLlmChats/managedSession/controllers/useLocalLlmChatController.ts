import { useCallback, useEffect, useRef, useState } from "react";

import type { LocalLlmChatDetail } from "@deskcue/protocol";
import { localLlmChatsApi } from "@api/endpoint/localLlmChats/endpoints";
import { LOCAL_LLM_CHAT_UPDATED_EVENT } from "@models/live/localLlmChatEvents";
import type { LocalLlmChatUpdatedEventDetail } from "@models/live/localLlmChatEvents";
import type { LiveUpdatesConnectionState } from "@models/liveUpdatesConnection";
import {
  LOCAL_LLM_LIVE_EVENT_REFRESH_MIN_INTERVAL_MS,
  boundLocalChatDetail,
  localLlmChatRefreshInterval,
  mergeLocalChatDetail
} from "@modules/localLlmChats/managedSession/localLlmManagedSessionTranscript";
import type {
  LocalLlmHistoryStream,
  LocalLlmProtectedRecordIds
} from "@modules/localLlmChats/managedSession/types";

import {
  LOCAL_LLM_LIVE_CONNECTION_RENDER_INTERVAL_MS,
  MAX_LOCAL_LLM_HISTORY_WINDOW_BYTES,
  MAX_LOCAL_LLM_HISTORY_WINDOW_PAGES
} from "./constants";
import {
  canApplyLocalLlmRefresh,
  canCommitLocalLlmMutation,
  createLocalLlmDetailRefreshState,
  estimateLocalLlmHistoryPageBytes,
  readLocalLlmError,
  rememberLoadedHistoryRecordIds
} from "./helpers";
import type { DetailMutationToken } from "./types";

export function useLocalLlmChatController(chatId: string) {
  const [detail, setDetail] = useState<LocalLlmChatDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyWindowFull, setHistoryWindowFull] = useState(false);
  const [localLiveConnection, setLocalLiveConnection] = useState<LiveUpdatesConnectionState>({
    lastSyncedAt: null,
    status: "connecting"
  });
  const loadedHistoryStreamsRef = useRef<Set<LocalLlmHistoryStream>>(new Set());
  const loadedHistoryRecordIdsRef = useRef<LocalLlmProtectedRecordIds>({});
  const loadedHistoryPageCountRef = useRef(0);
  const loadedHistoryBytesRef = useRef(0);
  const historyWindowFullRef = useRef(false);
  const lastLocalLiveConnectionRenderAtRef = useRef(0);
  const lastLocalEventRefreshAtRef = useRef(0);
  const localEventRefreshTimerRef = useRef<number | null>(null);
  const refreshStateRef = useRef(createLocalLlmDetailRefreshState(chatId));

  const markLocalChatSynced = useCallback(() => {
    const now = Date.now();
    setLocalLiveConnection((current) => {
      if (
        current.status === "live" &&
        now - lastLocalLiveConnectionRenderAtRef.current < LOCAL_LLM_LIVE_CONNECTION_RENDER_INTERVAL_MS
      ) {
        return current;
      }
      lastLocalLiveConnectionRenderAtRef.current = now;
      return {
        lastSyncedAt: new Date(now).toISOString(),
        status: "live"
      };
    });
  }, []);

  const markLocalChatUnavailable = useCallback(() => {
    setLocalLiveConnection((current) => ({
      lastSyncedAt: current.lastSyncedAt,
      status: current.lastSyncedAt ? "reconnecting" : "offline"
    }));
  }, []);

  const beginDetailMutation = useCallback(() => {
    const state = refreshStateRef.current;
    if (state.chatId !== chatId) {
      refreshStateRef.current = {
        chatId,
        inFlight: false,
        mutationInFlight: true,
        mutationRevision: 1
      };
      return { revision: 1, state: refreshStateRef.current };
    }
    state.mutationInFlight = true;
    state.mutationRevision += 1;
    return { revision: state.mutationRevision, state };
  }, [chatId]);

  const commitDetailMutation = useCallback((token: DetailMutationToken, nextDetail: LocalLlmChatDetail) => {
    const state = refreshStateRef.current;
    if (!canCommitLocalLlmMutation(state, token)) return;
    state.mutationInFlight = false;
    markLocalChatSynced();
    setDetail((current) => current?.id === nextDetail.id
      ? mergeLocalChatDetail(current, nextDetail, {
          preserveHistoryFor: loadedHistoryStreamsRef.current,
          preserveRecordIds: loadedHistoryRecordIdsRef.current
        })
      : boundLocalChatDetail(nextDetail, loadedHistoryRecordIdsRef.current)
    );
  }, [markLocalChatSynced]);

  const abandonDetailMutation = useCallback((token: DetailMutationToken) => {
    const state = refreshStateRef.current;
    if (canCommitLocalLlmMutation(state, token)) {
      state.mutationInFlight = false;
    }
  }, []);

  const mutateDetail = useCallback(async (
    mutation: () => Promise<LocalLlmChatDetail>
  ) => {
    const token = beginDetailMutation();
    try {
      const nextDetail = await mutation();
      commitDetailMutation(token, nextDetail);
      return nextDetail;
    } catch (mutationError) {
      abandonDetailMutation(token);
      throw mutationError;
    }
  }, [abandonDetailMutation, beginDetailMutation, commitDetailMutation]);

  const refresh = useCallback(async (tail: "initial" | "live" = "live") => {
    const state = refreshStateRef.current;
    if (state.chatId !== chatId || state.inFlight) return null;
    const mutationRevision = state.mutationRevision;
    state.inFlight = true;
    try {
      const nextDetail = await localLlmChatsApi.get(chatId, { tail });
      // Never let a request that started before a local composer/action update
      // replace the newer server response from that update.
      if (!canApplyLocalLlmRefresh(refreshStateRef.current, state, mutationRevision)) {
        return null;
      }
      markLocalChatSynced();
      setDetail((current) => current?.id === nextDetail.id
        ? mergeLocalChatDetail(current, nextDetail, {
            preserveHistoryFor: loadedHistoryStreamsRef.current,
            preserveRecordIds: loadedHistoryRecordIdsRef.current
          })
        : boundLocalChatDetail(nextDetail)
      );
      return nextDetail;
    } catch (refreshError) {
      if (canApplyLocalLlmRefresh(refreshStateRef.current, state, mutationRevision)) {
        markLocalChatUnavailable();
      }
      throw refreshError;
    } finally {
      if (refreshStateRef.current === state) state.inFlight = false;
    }
  }, [chatId, markLocalChatSynced, markLocalChatUnavailable]);

  const loadEarlierHistory = useCallback(async () => {
    if (!detail) return 0;
    if (historyWindowFullRef.current) return 0;
    const state = refreshStateRef.current;
    const mutationRevision = state.mutationRevision;
    const { history } = detail;
    if (!history.messages.hasMore && !history.events.hasMore && !history.changeSets.hasMore) {
      return 0;
    }
    const historyStreams = (Object.keys(history) as LocalLlmHistoryStream[])
      .filter((stream) => history[stream].nextCursor !== null);
    const nextDetail = await localLlmChatsApi.get(detail.id, {
      // A zero byte-offset is the API's stable end-of-history cursor. Sending
      // it prevents an already exhausted stream from being read from the
      // newest page again while another stream still has older entries.
      messages: history.messages.nextCursor ?? "0",
      events: history.events.nextCursor ?? "0",
      changeSets: history.changeSets.nextCursor ?? "0",
      tail: "history"
    });
    if (!canApplyLocalLlmRefresh(refreshStateRef.current, state, mutationRevision)) {
      return 0;
    }
    const pageBytes = estimateLocalLlmHistoryPageBytes(historyStreams, nextDetail);
    if (
      loadedHistoryPageCountRef.current >= MAX_LOCAL_LLM_HISTORY_WINDOW_PAGES ||
      loadedHistoryBytesRef.current + pageBytes > MAX_LOCAL_LLM_HISTORY_WINDOW_BYTES
    ) {
      historyWindowFullRef.current = true;
      setHistoryWindowFull(true);
      return 0;
    }
    loadedHistoryPageCountRef.current += 1;
    loadedHistoryBytesRef.current += pageBytes;
    if (
      loadedHistoryPageCountRef.current >= MAX_LOCAL_LLM_HISTORY_WINDOW_PAGES ||
      loadedHistoryBytesRef.current >= MAX_LOCAL_LLM_HISTORY_WINDOW_BYTES
    ) {
      historyWindowFullRef.current = true;
      setHistoryWindowFull(true);
    }
    markLocalChatSynced();
    for (const stream of historyStreams) {
      loadedHistoryStreamsRef.current.add(stream);
    }
    rememberLoadedHistoryRecordIds(
      loadedHistoryRecordIdsRef.current,
      historyStreams,
      nextDetail
    );
    const loadedMessageCount = nextDetail.messages.filter((message) =>
      !detail.messages.some((current) => current.id === message.id)
    ).length;
    setDetail((current) => current?.id === nextDetail.id
      ? mergeLocalChatDetail(current, nextDetail, {
          preserveCurrentShell: true,
          preserveRecordIds: loadedHistoryRecordIdsRef.current
        })
      : current
    );
    return loadedMessageCount;
  }, [detail, markLocalChatSynced]);

  const hydrateChangeSet = useCallback(async (groupId: string) => {
    if (!detail) {
      return { files: [], groupId, sessionId: "" };
    }
    const state = refreshStateRef.current;
    const changeSetId = groupId.replace(/^local-llm:changes:/, "");
    const existing = detail.changeSets.find((changeSet) => changeSet.id === changeSetId);
    if (!existing || existing.diff) {
      return { files: [], groupId, sessionId: `local-llm:${detail.id}` };
    }
    const hydrated = await localLlmChatsApi.getChangeSetDiff(detail.id, changeSetId);
    if (refreshStateRef.current !== state) {
      return { files: [], groupId, sessionId: `local-llm:${detail.id}` };
    }
    markLocalChatSynced();
    setDetail((current) => current?.id === detail.id
      ? {
        ...current,
        changeSets: current.changeSets.map((changeSet) =>
          changeSet.id === changeSetId ? { ...changeSet, diff: hydrated.diff } : changeSet
        )
      }
      : current
    );
    return { files: [], groupId, sessionId: `local-llm:${detail.id}` };
  }, [detail, markLocalChatSynced]);

  useEffect(() => {
    let active = true;
    loadedHistoryStreamsRef.current = new Set();
    loadedHistoryRecordIdsRef.current = {};
    loadedHistoryPageCountRef.current = 0;
    loadedHistoryBytesRef.current = 0;
    historyWindowFullRef.current = false;
    setHistoryWindowFull(false);
    refreshStateRef.current = createLocalLlmDetailRefreshState(chatId);
    setDetail(null);
    setError(null);
    lastLocalLiveConnectionRenderAtRef.current = 0;
    lastLocalEventRefreshAtRef.current = 0;
    setLocalLiveConnection({ lastSyncedAt: null, status: "connecting" });
    void refresh("initial")
      .then(() => {
        if (active) setError(null);
      })
      .catch((loadError: unknown) => {
        if (active) setError(readLocalLlmError(loadError));
      });

    return () => {
      active = false;
    };
  }, [chatId, refresh]);

  useEffect(() => {
    const interval = localLlmChatRefreshInterval(detail?.generationState);
    if (interval === null) return;

    const refreshWhenVisible = () => {
      if (document.visibilityState === "hidden") return;
      // A transient polling failure must not replace a working chat with a
      // persistent page error. The connection indicator already represents
      // this state as reconnecting/offline and the next successful poll
      // restores it to live.
      void refresh().catch(() => undefined);
    };
    const timer = window.setInterval(refreshWhenVisible, interval);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [detail?.generationState, refresh]);

  useEffect(() => {
    const handleChatUpdated = (event: Event) => {
      const update = (event as CustomEvent<LocalLlmChatUpdatedEventDetail>).detail;
      if (update?.chatId !== chatId || document.visibilityState === "hidden") return;

      const scheduleRefresh = (terminal: boolean, retry = false) => {
        const elapsed = Date.now() - lastLocalEventRefreshAtRef.current;
        const delay = terminal && !retry
          ? 0
          : Math.max(0, LOCAL_LLM_LIVE_EVENT_REFRESH_MIN_INTERVAL_MS - elapsed);
        if (localEventRefreshTimerRef.current !== null) {
          if (!terminal || retry) return;
          window.clearTimeout(localEventRefreshTimerRef.current);
        }
        localEventRefreshTimerRef.current = window.setTimeout(() => {
          localEventRefreshTimerRef.current = null;
          lastLocalEventRefreshAtRef.current = Date.now();
          void refresh()
            .then((nextDetail) => {
              // A mutation may already be reading this chat. Preserve the
              // terminal update, but retry through the normal backpressure.
              if (nextDetail === null) scheduleRefresh(terminal, true);
            })
            .catch(() => undefined);
        }, delay);
      };

      scheduleRefresh(update.terminal);
    };

    window.addEventListener(LOCAL_LLM_CHAT_UPDATED_EVENT, handleChatUpdated);
    return () => {
      window.removeEventListener(LOCAL_LLM_CHAT_UPDATED_EVENT, handleChatUpdated);
      if (localEventRefreshTimerRef.current !== null) {
        window.clearTimeout(localEventRefreshTimerRef.current);
        localEventRefreshTimerRef.current = null;
      }
    };
  }, [chatId, refresh]);

  return {
    detail,
    error,
    hydrateChangeSet,
    historyWindowFull,
    loadEarlierHistory,
    localLiveConnection,
    mutateDetail,
    refresh,
    setError
  };
}
