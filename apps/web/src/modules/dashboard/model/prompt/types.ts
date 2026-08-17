import type { MutableRefObject } from "react";

import type { AgentSessionDetail, OverviewResponse, SessionDetail } from "@deskcue/protocol";
import type { SessionUpdateResponse } from "@api/endpoint/sessions/types";
import type { PendingChatPrompt } from "@models/promptDelivery";
import type { SessionTab } from "@models/sessionTabs";
import type {
  PromptOperationState,
  UseDashboardCommandHandlersArgs
} from "@modules/dashboard/model/commands/types";
import type { LoadOptions } from "@modules/dashboard/model/data/dashboardLoad";

export type PromptDeliveryTarget = Pick<PendingChatPrompt, "sessionId" | "sourceSessionId">;

export type PromptInterruptResult = {
  externalStop: "claude_background" | "agent_process" | null;
  session: SessionUpdateResponse;
};

export type UsePromptDeliveryControllerArgs = {
  selectedSessionId: string;
  selectedSession: SessionDetail | null;
  selectedSessionIdRef: MutableRefObject<string>;
  selectedSessionRef: MutableRefObject<SessionDetail | null>;
  promptOperationRef: MutableRefObject<PromptOperationState>;
  activeTakenOverAgentSession: AgentSessionDetail | null;
  pendingChatPrompt: PendingChatPrompt | null;
  setSelectedSession: (value: SessionDetail | null) => void;
  setError: (value: string) => void;
  setPendingChatPrompt: (value: PendingChatPrompt | null) => void;
  setAwaitingChatReplySince: (value: string | null) => void;
  setIsWaitingForChatReply: (value: boolean) => void;
  setIsInterruptingPrompt: (value: boolean) => void;
  loadOverview: (options?: LoadOptions) => Promise<OverviewResponse>;
  loadSession: (sessionId: string, options?: LoadOptions) => Promise<SessionDetail | null>;
  refreshActiveTakenOverAgentSession: () => Promise<void>;
};

export interface UseDashboardPromptReplyWatchdogArgs {
  activeTab: SessionTab;
  activeTabRef: MutableRefObject<SessionTab>;
  activeTakenOverAgentSessionIdRef: MutableRefObject<string>;
  activeTakenOverAgentSessionSummaryId: string | null;
  applyFetchedAgentSessionDetail: (session: AgentSessionDetail) => void;
  loadSessionRef: MutableRefObject<(
    sessionId: string,
    options?: LoadOptions
  ) => Promise<SessionDetail | null>>;
  pendingChatPrompt: PendingChatPrompt | null;
  promptReplyPollingActiveRef: MutableRefObject<boolean>;
  selectedSession: SessionDetail | null;
  selectedSessionId: string;
  selectedSessionIdRef: MutableRefObject<string>;
  selectedAgentSessionIdRef: MutableRefObject<string>;
}

export type UseDashboardPromptCommandHandlerArgs = Pick<
  UseDashboardCommandHandlersArgs,
  | "overview"
  | "selectedAgentSessionId"
  | "selectedSessionId"
  | "selectedSession"
  | "selectedSessionIdRef"
  | "selectedSessionRef"
  | "promptOperationRef"
  | "promptDelivery"
  | "setSelectedWorkspaceId"
  | "setSelectedSessionId"
  | "setSelectedSession"
  | "setActiveTab"
  | "setError"
  | "loadAgentSessions"
  | "loadSession"
>;
