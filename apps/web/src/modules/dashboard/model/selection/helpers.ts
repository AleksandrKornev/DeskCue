import type { SessionDetail } from "@deskcue/protocol";
import type { SessionTab } from "@models/sessionTabs";
import type { AgentChatDetailResourceStatus } from "@modules/dashboard/model/chatDetail";
import { resolveAgentChatTranscriptDetail } from "@modules/dashboard/model/chatDetail/requests/agentChatDetailRequests";

export function resolveSelectedAgentSessionTranscriptDetail(
  activeTab: SessionTab,
  selectedSession: SessionDetail | null
) {
  if (!selectedSession || selectedSession.sourceSessionId) {
    return "summary";
  }

  return resolveAgentChatTranscriptDetail(activeTab, { summaryOnOverview: false });
}

export function shouldShowActiveTakenOverAgentSessionLoading(
  status: AgentChatDetailResourceStatus,
  hasVisibleCurrentSession: boolean
) {
  if (status === "refreshing") {
    return !hasVisibleCurrentSession;
  }
  return status === "idle" || status === "loading";
}

export function usesTakenOverAgentTranscript(activeTab: SessionTab) {
  return activeTab === "overview" || activeTab === "activity" || activeTab === "diff";
}

export function shouldAutoRefreshManagedSessionDiff(
  activeTab: SessionTab,
  selectedSessionId: string
) {
  return activeTab === "diff" && Boolean(selectedSessionId);
}
