import type { MutableRefObject } from "react";

import type { AgentSessionDetail, SessionDetail } from "@deskcue/protocol";
import type { PendingChatPrompt } from "@models/promptDelivery";
import type { SessionTab } from "@models/sessionTabs";
import type { LoadOptions } from "@modules/dashboard/model/data/dashboardLoad";
import type { DashboardStore } from "@modules/dashboard/model/store";

export interface UseDashboardLiveUpdatesArgs {
  store: DashboardStore;
  eventStreamAttempt: number;
  activeTab: SessionTab;
  activeTabRef: MutableRefObject<SessionTab>;
  selectedSessionId: string;
  selectedSession: SessionDetail | null;
  selectedAgentSessionId: string;
  selectedSessionIdRef: MutableRefObject<string>;
  selectedAgentSessionIdRef: MutableRefObject<string>;
  selectedAgentSessionRef: MutableRefObject<AgentSessionDetail | null>;
  selectedSessionRef: MutableRefObject<SessionDetail | null>;
  activeTakenOverAgentSessionSummaryId: string | null;
  activeTakenOverAgentSession: AgentSessionDetail | null;
  pendingChatPrompt: PendingChatPrompt | null;
  loadSession: (sessionId: string, options?: LoadOptions) => Promise<SessionDetail | null>;
}

export interface UseDashboardAgentSessionRefreshesArgs {
  activeTabRef: MutableRefObject<SessionTab>;
  activeTakenOverAgentSession: AgentSessionDetail | null;
  activeTakenOverAgentSessionSummaryId: string | null;
  applyFetchedAgentSessionDetail: (session: AgentSessionDetail) => void;
  promptReplyPollingActiveRef: MutableRefObject<boolean>;
  selectedAgentSessionId: string;
  selectedAgentSessionIdRef: MutableRefObject<string>;
  selectedAgentSessionRef: MutableRefObject<AgentSessionDetail | null>;
  store: DashboardStore;
}

export type ScheduleTakenOverTranscriptRefreshOptions = {
  allowDuringPromptPolling?: boolean;
};

export type UseTakenOverAgentSessionRefreshArgs = {
  activeTabRef: MutableRefObject<SessionTab>;
  activeTakenOverAgentSession: AgentSessionDetail | null;
  activeTakenOverAgentSessionSummaryId: string | null;
  applyFetchedAgentSessionDetail: (session: AgentSessionDetail) => void;
  promptReplyPollingActiveRef: MutableRefObject<boolean>;
};

export interface UseDashboardLiveUpdatesSocketArgs {
  activeTab: SessionTab;
  activeTabRef: MutableRefObject<SessionTab>;
  activeTakenOverAgentSessionIdRef: MutableRefObject<string>;
  eventStreamAttempt: number;
  loadSessionRef: MutableRefObject<
    (sessionId: string, options?: LoadOptions) => Promise<SessionDetail | null>
  >;
  refreshTakenOverTranscriptNow: (
    updatedAt?: string | null,
    options?: {
      allowDuringPromptPolling?: boolean;
      fullTranscript?: boolean;
      reason?: "reconnect" | "live-event";
    }
  ) => void;
  scheduleTakenOverTranscriptRefresh: (
    updatedAt?: string | null,
    options?: ScheduleTakenOverTranscriptRefreshOptions
  ) => void;
  scheduleSelectedAgentSessionRefresh: (
    updatedAt?: string | null,
    options?: { allowDuringPromptPolling?: boolean; reason?: "reconnect" | "live-event" }
  ) => void;
  selectedAgentSessionIdRef: MutableRefObject<string>;
  selectedSessionId: string;
  selectedSessionIdRef: MutableRefObject<string>;
  selectedSessionRef: MutableRefObject<SessionDetail | null>;
  store: DashboardStore;
}
