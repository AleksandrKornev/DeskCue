import { startTransition, useCallback } from "react";
import type { MutableRefObject } from "react";

import type { AgentSessionDetail } from "@deskcue/protocol";
import type { SessionTab } from "@models/sessionTabs";
import {
  readDefaultTranscriptDetail,
  useAgentChatDetailRefreshScheduler
} from "@modules/dashboard/model/chatDetail";
import type { DashboardStore } from "@modules/dashboard/model/store";

import {
  SELECTED_AGENT_SESSION_REFRESH_MIN_INTERVAL_MS
} from "./helpers";

export function useSelectedAgentSessionRefresh({
  activeTabRef,
  selectedAgentSessionId,
  selectedAgentSessionIdRef,
  selectedAgentSessionRef,
  store
}: {
  activeTabRef: MutableRefObject<SessionTab>;
  selectedAgentSessionId: string;
  selectedAgentSessionIdRef: MutableRefObject<string>;
  selectedAgentSessionRef: MutableRefObject<AgentSessionDetail | null>;
  store: DashboardStore;
}) {
  const applyFetchedAgentSessionDetail = useCallback((session: AgentSessionDetail) => {
    startTransition(() => {
      store.mergeSelectedAgentSessionDetail(session);
    });
  }, [store]);
  const readSelectedAgentTranscriptDetail = useCallback((activeTab: SessionTab) =>
    selectedAgentSessionRef.current?.sourceSessionId
      ? "summary"
      : readDefaultTranscriptDetail(activeTab), [selectedAgentSessionRef]);
  const { scheduleAgentChatDetailRefresh } = useAgentChatDetailRefreshScheduler({
    activeTabRef,
    applyFetchedAgentSessionDetail,
    currentDetailRef: selectedAgentSessionRef,
    minIntervalMs: SELECTED_AGENT_SESSION_REFRESH_MIN_INTERVAL_MS,
    readTranscriptDetail: readSelectedAgentTranscriptDetail,
    resetKey: selectedAgentSessionId,
    sessionIdRef: selectedAgentSessionIdRef
  });

  return {
    scheduleSelectedAgentSessionRefresh: scheduleAgentChatDetailRefresh
  };
}
