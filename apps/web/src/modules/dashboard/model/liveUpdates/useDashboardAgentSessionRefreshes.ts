import type { UseDashboardAgentSessionRefreshesArgs } from "./types";
import { useSelectedAgentSessionRefresh } from "./useSelectedAgentSessionRefresh";
import { useTakenOverAgentSessionRefresh } from "./useTakenOverAgentSessionRefresh";

export function useDashboardAgentSessionRefreshes({
  activeTabRef,
  activeTakenOverAgentSession,
  activeTakenOverAgentSessionSummaryId,
  applyFetchedAgentSessionDetail,
  promptReplyPollingActiveRef,
  selectedAgentSessionId,
  selectedAgentSessionIdRef,
  selectedAgentSessionRef,
  store
}: UseDashboardAgentSessionRefreshesArgs) {
  const { scheduleSelectedAgentSessionRefresh } = useSelectedAgentSessionRefresh({
    activeTabRef,
    selectedAgentSessionId,
    selectedAgentSessionIdRef,
    selectedAgentSessionRef,
    store
  });
  const {
    activeTakenOverAgentSessionIdRef,
    refreshTakenOverTranscriptNow,
    scheduleTakenOverTranscriptRefresh
  } = useTakenOverAgentSessionRefresh({
    activeTabRef,
    activeTakenOverAgentSession,
    activeTakenOverAgentSessionSummaryId,
    applyFetchedAgentSessionDetail,
    promptReplyPollingActiveRef
  });

  return {
    activeTakenOverAgentSessionIdRef,
    refreshTakenOverTranscriptNow,
    scheduleSelectedAgentSessionRefresh,
    scheduleTakenOverTranscriptRefresh
  };
}
