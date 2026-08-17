import type {
  AgentKind,
  AgentSessionDetail,
  AgentSessionSummary,
  OverviewResponse,
  RuntimeSummary,
  SessionDetail
} from "@deskcue/protocol";

import type { PendingChatPrompt } from "./promptDelivery";

export type DashboardCache = {
  overview?: OverviewResponse;
  agentSessions?: AgentSessionSummary[];
  runtimes?: RuntimeSummary[];
  selectedSourceId?: AgentKind | "all";
  selectedAgentSessionId?: string;
  selectedAgentSession?: AgentSessionDetail | null;
  activeTakenOverAgentSession?: AgentSessionDetail | null;
  readyForReviewAgentSessionIds?: string[];
  selectedWorkspaceId?: string;
  selectedSessionId?: string;
  selectedSession?: SessionDetail | null;
  pendingChatPrompt?: PendingChatPrompt | null;
  awaitingChatReplySince?: string | null;
  isWaitingForChatReply?: boolean;
};
