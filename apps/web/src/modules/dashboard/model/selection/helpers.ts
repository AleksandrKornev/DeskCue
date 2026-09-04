import type { SessionDetail } from "@deskcue/protocol";
import type { SessionTab } from "@models/sessionTabs";
import type {
  AgentChatDetailResourceSnapshot,
  AgentChatDetailResourceStatus
} from "@modules/dashboard/model/chatDetail";
import { resolveAgentChatTranscriptDetail } from "@modules/dashboard/model/chatDetail/requests/agentChatDetailRequests";

const SELECTED_AGENT_SESSION_LOAD_ERROR_MESSAGE =
  "This local transcript may have changed or the daemon may be unavailable. Return to chats or try again.";

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

export function resolveSelectedAgentSessionLoadError(
  enabled: boolean,
  selectedAgentSessionId: string,
  snapshot: AgentChatDetailResourceSnapshot
) {
  if (!enabled || !selectedAgentSessionId) return null;
  if (snapshot.sessionId !== selectedAgentSessionId) return null;
  if (!snapshot.error || snapshot.detail) return null;

  return SELECTED_AGENT_SESSION_LOAD_ERROR_MESSAGE;
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
