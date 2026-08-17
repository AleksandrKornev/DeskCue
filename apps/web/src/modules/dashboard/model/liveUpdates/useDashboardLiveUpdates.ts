import { startTransition, useCallback, useEffect, useRef } from "react";

import type { AgentSessionDetail } from "@deskcue/protocol";
import { useDashboardPromptReplyWatchdog } from "@modules/dashboard/model/prompt/useDashboardPromptReplyWatchdog";
import { buildManagedSessionLoadOptionsForTab } from "@modules/dashboard/model/selection/managedSessionLoadOptions";

import type { UseDashboardLiveUpdatesArgs } from "./types";
import { useDashboardAgentSessionRefreshes } from "./useDashboardAgentSessionRefreshes";
import { useDashboardLiveUpdatesSocket } from "./useDashboardLiveUpdatesSocket";

export function useDashboardLiveUpdates(args: UseDashboardLiveUpdatesArgs) {
  const {
    activeTab,
    activeTabRef,
    activeTakenOverAgentSession,
    activeTakenOverAgentSessionSummaryId,
    eventStreamAttempt,
    selectedSession,
    selectedSessionId,
    selectedAgentSessionId,
    selectedAgentSessionRef,
    selectedAgentSessionIdRef,
    selectedSessionIdRef,
    selectedSessionRef,
    pendingChatPrompt,
    store,
    loadSession,
  } = args;

  const promptReplyPollingActiveRef = useRef(false);
  const loadSessionRef = useRef(loadSession);

  const applyFetchedActiveTakenOverAgentSessionDetail = useCallback((session: AgentSessionDetail) => {
    startTransition(() => {
      store.mergeActiveTakenOverAgentSessionDetail(session);
    });
  }, [store]);

  const {
    activeTakenOverAgentSessionIdRef,
    refreshTakenOverTranscriptNow,
    scheduleSelectedAgentSessionRefresh,
    scheduleTakenOverTranscriptRefresh
  } = useDashboardAgentSessionRefreshes({
    activeTabRef,
    activeTakenOverAgentSession,
    activeTakenOverAgentSessionSummaryId,
    applyFetchedAgentSessionDetail: applyFetchedActiveTakenOverAgentSessionDetail,
    promptReplyPollingActiveRef,
    selectedAgentSessionId,
    selectedAgentSessionIdRef,
    selectedAgentSessionRef,
    store
  });

  useEffect(() => {
    loadSessionRef.current = loadSession;
  }, [loadSession]);

  useDashboardPromptReplyWatchdog({
    activeTab,
    activeTabRef,
    activeTakenOverAgentSessionSummaryId,
    activeTakenOverAgentSessionIdRef,
    applyFetchedAgentSessionDetail: applyFetchedActiveTakenOverAgentSessionDetail,
    loadSessionRef,
    pendingChatPrompt,
    promptReplyPollingActiveRef,
    selectedSession,
    selectedSessionId,
    selectedSessionIdRef,
    selectedAgentSessionIdRef
  });

  useEffect(() => {
    const refreshActiveChatAfterWake = (reason: "focus" | "mobile-resume") => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }

      if (selectedAgentSessionIdRef.current) {
        scheduleSelectedAgentSessionRefresh(undefined, {
          reason
        });
      }

      if (activeTakenOverAgentSessionIdRef.current) {
        refreshTakenOverTranscriptNow(undefined, {
          allowDuringPromptPolling: true,
          reason
        });
      }

      const selectedManagedSessionId = selectedSessionIdRef.current;
      if (selectedManagedSessionId) {
        void loadSessionRef.current(
          selectedManagedSessionId,
          buildManagedSessionLoadOptionsForTab(activeTabRef.current, {
            silent: true
          })
        );
      }
    };

    const handleOnline = () => {
      refreshActiveChatAfterWake("mobile-resume");
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshActiveChatAfterWake("mobile-resume");
      }
    };
    const handleFocus = () => {
      refreshActiveChatAfterWake("focus");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    activeTabRef,
    activeTakenOverAgentSessionIdRef,
    loadSessionRef,
    refreshTakenOverTranscriptNow,
    scheduleSelectedAgentSessionRefresh,
    selectedAgentSessionIdRef,
    selectedSessionIdRef
  ]);

  useDashboardLiveUpdatesSocket({
    activeTab,
    activeTabRef,
    activeTakenOverAgentSessionIdRef,
    eventStreamAttempt,
    loadSessionRef,
    refreshTakenOverTranscriptNow,
    scheduleTakenOverTranscriptRefresh,
    scheduleSelectedAgentSessionRefresh,
    selectedAgentSessionIdRef,
    selectedSessionId,
    selectedSessionIdRef,
    selectedSessionRef,
    store
  });
}
