import type { AgentSessionSummary } from "@deskcue/protocol";

export type AgentSessionsLoadState = "loading" | "ready" | "failed";

export const AGENT_SESSIONS_INVALIDATED_EVENT =
  "deskcue:agent-sessions-invalidated";

export const AGENT_SESSION_SUMMARY_UPDATED_EVENT =
  "deskcue:agent-session-summary-updated";

export type AgentSessionSummaryUpdatedEventDetail = {
  session: AgentSessionSummary;
};
