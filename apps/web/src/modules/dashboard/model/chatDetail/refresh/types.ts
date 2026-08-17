import type { MutableRefObject } from "react";

import type { AgentSessionDetail } from "@deskcue/protocol";
import type { SessionTab } from "@models/sessionTabs";
import type { AgentChatTranscriptDetail } from "@modules/dashboard/model/chatDetail/requests/agentChatDetailRequests";
import type { AgentChatDetailLoadReason } from "@modules/dashboard/model/chatDetail/resource/agentChatDetailResource";

export type AgentChatDetailRefreshOptions = {
  allowDuringPromptPolling?: boolean;
  force?: boolean;
  fullTranscript?: boolean;
  reason?: AgentChatDetailLoadReason;
};

export type AgentChatDetailReadTranscriptDetail = (
  activeTab: SessionTab
) => AgentChatTranscriptDetail;

export type UseAgentChatDetailRefreshSchedulerArgs = {
  activeTabRef: MutableRefObject<SessionTab>;
  applyFetchedAgentSessionDetail: (session: AgentSessionDetail) => void;
  currentDetailRef: MutableRefObject<AgentSessionDetail | null>;
  minIntervalMs: number;
  readTranscriptDetail?: AgentChatDetailReadTranscriptDetail;
  resetKey: string;
  sessionIdRef: MutableRefObject<string>;
  shouldRefresh?: (options: AgentChatDetailRefreshOptions) => boolean;
};
