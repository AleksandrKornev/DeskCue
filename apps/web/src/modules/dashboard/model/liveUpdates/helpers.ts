import type { AgentSessionDetail } from "@deskcue/protocol";
import type { PendingChatPrompt } from "@models/promptDelivery";
import type { SessionTab } from "@models/sessionTabs";

export const AGENT_SESSION_DETAIL_REFRESH_DELAY_MS = 900;
export const AGENT_SESSION_PASSIVE_REFRESH_MIN_INTERVAL_MS = 15_000;
export const SELECTED_AGENT_SESSION_REFRESH_MIN_INTERVAL_MS = 15_000;
export const TAKEN_OVER_AGENT_SESSION_REFRESH_MIN_INTERVAL_MS = 5_000;
export const LIVE_UPDATES_CONNECT_TIMEOUT_MS = 5000;
export const LIVE_UPDATES_RECONNECT_NOTICE_DELAY_MS = 1000;
export const LIVE_UPDATES_RECONNECT_DELAY_MS = 500;
export const PROMPT_REPLY_SYNC_WATCHDOG_DELAY_MS = 10_000;

export function getBackpressuredRefreshDelay(
  lastRefreshStartedAt: number,
  minIntervalMs: number
) {
  const elapsedMs = Date.now() - lastRefreshStartedAt;
  return Math.max(
    AGENT_SESSION_DETAIL_REFRESH_DELAY_MS,
    minIntervalMs - elapsedMs
  );
}

export function hasDetailAtLeastAsFreshAsEvent(
  detail: AgentSessionDetail | null,
  sessionId: string,
  updatedAt?: string | null
) {
  if (!updatedAt || detail?.id !== sessionId) {
    return false;
  }

  const detailTime = new Date(detail.updatedAt).getTime();
  const eventTime = new Date(updatedAt).getTime();
  if (Number.isNaN(detailTime) || Number.isNaN(eventTime)) {
    return detail.updatedAt === updatedAt;
  }

  return detailTime >= eventTime;
}

export function usesTakenOverAgentTranscript(activeTab: SessionTab) {
  return activeTab === "overview" || activeTab === "activity" || activeTab === "diff";
}

export function isPromptForActiveSelection(
  prompt: PendingChatPrompt | null,
  selectedSessionId: string,
  selectedSourceSessionId: string | null
) {
  if (!prompt) {
    return false;
  }

  if (prompt.sessionId) {
    return prompt.sessionId === selectedSessionId;
  }

  if (prompt.sourceSessionId) {
    return prompt.sourceSessionId === selectedSourceSessionId;
  }

  return false;
}
