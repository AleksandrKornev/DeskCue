import { useEffect, useMemo } from "react";

import {
  API_UNAUTHORIZED_EVENT,
  CONNECTION_CONFIG_CHANGED_EVENT
} from "@api/connection/events";

import { useDashboardCachePersistence } from "./cache";
import { clearDashboardCache } from "./cache/storage";
import { agentChatDetailResource } from "./chatDetail/resource/agentChatDetailResource";
import { buildDashboardCacheSnapshot } from "./dashboardViewModel";
import type { DashboardCacheSnapshot } from "./dashboardViewModel";
import type { DashboardStore } from "./store";

/** Keeps the persisted dashboard projection aligned with its source state. */
export function useDashboardCacheLifecycle(
  store: DashboardStore,
  value: DashboardCacheSnapshot
) {
  const {
    activeTakenOverAgentSession,
    agentSessions,
    awaitingChatReplySince,
    isWaitingForChatReply,
    overview,
    pendingChatPrompt,
    readyForReviewAgentSessionIds,
    runtimes,
    selectedAgentSession,
    selectedAgentSessionId,
    selectedSession,
    selectedSessionId,
    selectedSourceId,
    selectedWorkspaceId
  } = value;
  const snapshot = useMemo(() => buildDashboardCacheSnapshot({
    activeTakenOverAgentSession,
    agentSessions,
    awaitingChatReplySince,
    isWaitingForChatReply,
    overview,
    pendingChatPrompt,
    readyForReviewAgentSessionIds,
    runtimes,
    selectedAgentSession,
    selectedAgentSessionId,
    selectedSession,
    selectedSessionId,
    selectedSourceId,
    selectedWorkspaceId
  }), [
    activeTakenOverAgentSession,
    agentSessions,
    awaitingChatReplySince,
    isWaitingForChatReply,
    overview,
    pendingChatPrompt,
    readyForReviewAgentSessionIds,
    runtimes,
    selectedAgentSession,
    selectedAgentSessionId,
    selectedSession,
    selectedSessionId,
    selectedSourceId,
    selectedWorkspaceId
  ]);

  useDashboardCachePersistence(snapshot);

  useEffect(() => {
    const resetConnectionState = () => {
      clearDashboardCache();
      agentChatDetailResource.clear();
      store.resetConnectionScopedState();
    };

    window.addEventListener(API_UNAUTHORIZED_EVENT, resetConnectionState);
    window.addEventListener(CONNECTION_CONFIG_CHANGED_EVENT, resetConnectionState);
    return () => {
      window.removeEventListener(API_UNAUTHORIZED_EVENT, resetConnectionState);
      window.removeEventListener(CONNECTION_CONFIG_CHANGED_EVENT, resetConnectionState);
    };
  }, [store]);
}
