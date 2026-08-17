import { useCallback, useEffect, useRef } from "react";

import type { AgentSessionDetail } from "@deskcue/protocol";
import { useAgentChatDetailRefreshScheduler } from "@modules/dashboard/model/chatDetail";

import {
  TAKEN_OVER_AGENT_SESSION_REFRESH_MIN_INTERVAL_MS,
  usesTakenOverAgentTranscript
} from "./helpers";
import type {
  ScheduleTakenOverTranscriptRefreshOptions,
  UseTakenOverAgentSessionRefreshArgs
} from "./types";

export function useTakenOverAgentSessionRefresh({
  activeTabRef,
  activeTakenOverAgentSession,
  activeTakenOverAgentSessionSummaryId,
  applyFetchedAgentSessionDetail,
  promptReplyPollingActiveRef
}: UseTakenOverAgentSessionRefreshArgs) {
  const activeTakenOverAgentSessionIdRef = useRef("");
  const activeTakenOverAgentSessionRef = useRef<AgentSessionDetail | null>(activeTakenOverAgentSession);
  const shouldRefreshTakenOverTranscript = useCallback((
    options: ScheduleTakenOverTranscriptRefreshOptions
  ) => {
    if (!usesTakenOverAgentTranscript(activeTabRef.current)) {
      return false;
    }

    return !promptReplyPollingActiveRef.current || options.allowDuringPromptPolling === true;
  }, [activeTabRef, promptReplyPollingActiveRef]);
  const readTakenOverTranscriptDetail = useCallback(() => "summary" as const, []);
  const {
    refreshAgentChatDetailNow: refreshTakenOverTranscriptNow,
    scheduleAgentChatDetailRefresh: scheduleTakenOverTranscriptRefresh
  } = useAgentChatDetailRefreshScheduler({
    activeTabRef,
    applyFetchedAgentSessionDetail,
    currentDetailRef: activeTakenOverAgentSessionRef,
    minIntervalMs: TAKEN_OVER_AGENT_SESSION_REFRESH_MIN_INTERVAL_MS,
    readTranscriptDetail: readTakenOverTranscriptDetail,
    resetKey: activeTakenOverAgentSessionSummaryId ?? "",
    sessionIdRef: activeTakenOverAgentSessionIdRef,
    shouldRefresh: shouldRefreshTakenOverTranscript
  });

  useEffect(() => {
    activeTakenOverAgentSessionIdRef.current = activeTakenOverAgentSessionSummaryId ?? "";
  }, [activeTakenOverAgentSessionSummaryId]);

  useEffect(() => {
    activeTakenOverAgentSessionRef.current = activeTakenOverAgentSession;
  }, [activeTakenOverAgentSession]);

  return {
    activeTakenOverAgentSessionIdRef,
    refreshTakenOverTranscriptNow,
    scheduleTakenOverTranscriptRefresh
  };
}
