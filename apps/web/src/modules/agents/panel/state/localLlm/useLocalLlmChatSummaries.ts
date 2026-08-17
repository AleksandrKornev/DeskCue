import { useCallback, useEffect, useRef, useState } from "react";

import {
  API_UNAUTHORIZED_EVENT,
  CONNECTION_CONFIG_CHANGED_EVENT
} from "@api/connection/events";
import { localLlmChatsApi } from "@api/endpoint/localLlmChats/endpoints";
import { LOCAL_LLM_CHAT_UPDATED_EVENT } from "@models/live/localLlmChatEvents";
import { getDeskCueRuntime } from "@runtime";

import { LOCAL_LLM_SUMMARY_REFRESH_DELAY_MS } from "./constants";
import type { LocalLlmChatSummariesState } from "./types";

/**
 * Keeps the dashboard's local-runtime tabs and chat summaries convergent with
 * daemon updates. Detail views have their own compact tail refresh; this hook
 * deliberately reloads only the small summary collection.
 */
export function useLocalLlmChatSummaries(): LocalLlmChatSummariesState {
  const enabled = getDeskCueRuntime().features.localLlmChats;
  const [state, setState] = useState<LocalLlmChatSummariesState>({ chats: [], error: null });
  const activeRef = useRef(true);
  const inFlightRef = useRef(false);
  const refreshAgainRef = useRef(false);
  const requestGenerationRef = useRef(0);
  const refreshTimerRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setState({ chats: [], error: null });
      return;
    }
    if (inFlightRef.current) {
      refreshAgainRef.current = true;
      return;
    }

    inFlightRef.current = true;
    do {
      refreshAgainRef.current = false;
      const requestGeneration = requestGenerationRef.current + 1;
      requestGenerationRef.current = requestGeneration;
      try {
        const chats = await localLlmChatsApi.list();
        if (activeRef.current && requestGenerationRef.current === requestGeneration) {
          setState({ chats, error: null });
        }
      } catch (error) {
        if (activeRef.current && requestGenerationRef.current === requestGeneration) {
          setState((current) => ({
            ...current,
            error: error instanceof Error ? error.message : "Failed to load local chats"
          }));
        }
      }
    } while (activeRef.current && refreshAgainRef.current);
    inFlightRef.current = false;
  }, [enabled]);

  useEffect(() => {
    activeRef.current = true;
    if (!enabled) {
      setState({ chats: [], error: null });
      return () => {
        activeRef.current = false;
      };
    }
    void refresh();

    const scheduleRefresh = () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        void refresh();
      }, LOCAL_LLM_SUMMARY_REFRESH_DELAY_MS);
    };
    const clearForUnauthorized = () => {
      requestGenerationRef.current += 1;
      refreshAgainRef.current = false;
      setState({ chats: [], error: null });
    };
    const clearForConnectionChange = () => {
      clearForUnauthorized();
      if (inFlightRef.current) {
        refreshAgainRef.current = true;
      } else {
        void refresh();
      }
    };

    window.addEventListener(LOCAL_LLM_CHAT_UPDATED_EVENT, scheduleRefresh);
    window.addEventListener(API_UNAUTHORIZED_EVENT, clearForUnauthorized);
    window.addEventListener(CONNECTION_CONFIG_CHANGED_EVENT, clearForConnectionChange);
    return () => {
      activeRef.current = false;
      requestGenerationRef.current += 1;
      refreshAgainRef.current = false;
      window.removeEventListener(LOCAL_LLM_CHAT_UPDATED_EVENT, scheduleRefresh);
      window.removeEventListener(API_UNAUTHORIZED_EVENT, clearForUnauthorized);
      window.removeEventListener(CONNECTION_CONFIG_CHANGED_EVENT, clearForConnectionChange);
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [enabled, refresh]);

  return state;
}
