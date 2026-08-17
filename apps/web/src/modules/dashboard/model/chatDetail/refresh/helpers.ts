import type { SessionTab } from "@models/sessionTabs";
import { resolveAgentChatTranscriptDetail } from "@modules/dashboard/model/chatDetail/requests/agentChatDetailRequests";
import type {
  AgentChatDetailLoadReason,
  AgentChatDetailResourceSnapshot
} from "@modules/dashboard/model/chatDetail/resource/agentChatDetailResource";
import { AGENT_SESSION_PASSIVE_REFRESH_MIN_INTERVAL_MS } from "@modules/dashboard/model/liveUpdates/helpers";

import type {
  AgentChatDetailReadTranscriptDetail,
  AgentChatDetailRefreshOptions
} from "./types";

export function readDefaultTranscriptDetail(activeTab: SessionTab) {
  return resolveAgentChatTranscriptDetail(activeTab, { summaryOnOverview: true });
}

export function resolveAgentChatDetailReadTranscriptDetail(
  readTranscriptDetail: AgentChatDetailReadTranscriptDetail | undefined
) {
  return readTranscriptDetail ?? readDefaultTranscriptDetail;
}

export function isPassiveAgentChatDetailRefreshReason(
  reason: AgentChatDetailLoadReason | undefined
) {
  return reason === "focus" || reason === "mobile-resume" || reason === "reconnect" || reason === "visibility";
}

export function shouldSkipPassiveAgentChatDetailRefresh({
  minIntervalMs,
  now,
  options,
  snapshot,
  updatedAt
}: {
  minIntervalMs: number;
  now: number;
  options: AgentChatDetailRefreshOptions;
  snapshot: AgentChatDetailResourceSnapshot;
  updatedAt?: string | null;
}) {
  if (updatedAt || !isPassiveAgentChatDetailRefreshReason(options.reason)) {
    return false;
  }

  if (
    !snapshot.detail || snapshot.isStale || snapshot.status === "loading" ||
    snapshot.status === "refreshing" || snapshot.status === "error" ||
    snapshot.lastValidatedAt === null
  ) {
    return false;
  }

  const passiveCooldownMs = Math.max(
    AGENT_SESSION_PASSIVE_REFRESH_MIN_INTERVAL_MS,
    minIntervalMs
  );
  return now - snapshot.lastValidatedAt < passiveCooldownMs;
}

export function mergeAgentChatDetailRefreshOptions(
  current: AgentChatDetailRefreshOptions | null,
  next: AgentChatDetailRefreshOptions
): AgentChatDetailRefreshOptions {
  return {
    allowDuringPromptPolling:
      current?.allowDuringPromptPolling === true || next.allowDuringPromptPolling === true,
    force: current?.force === true || next.force === true,
    fullTranscript: current?.fullTranscript === true || next.fullTranscript === true,
    reason: next.reason ?? current?.reason
  };
}

export function shouldDeferAgentChatDetailRefreshWhileHidden(
  reason: AgentChatDetailLoadReason | undefined
) {
  if (reason === "prompt-watchdog" || typeof document === "undefined") {
    return false;
  }
  return document.visibilityState === "hidden";
}
