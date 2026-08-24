import type { AgentSessionSummary, SessionSummary } from "@deskcue/protocol";
import type { LiveUpdatesConnectionState } from "@models/liveUpdatesConnection";
import {
  formatManagedSessionSubtitle,
  formatManagedSessionTitle
} from "@models/sessionDisplay";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

export function formatConnectionAge(lastSyncedAt: string | null, now: number) {
  if (!lastSyncedAt) return null;

  const lastSyncedTime = new Date(lastSyncedAt).getTime();

  if (Number.isNaN(lastSyncedTime)) return null;

  const elapsedMs = Math.max(0, now - lastSyncedTime);

  if (elapsedMs < 10 * SECOND_MS) return "now";
  if (elapsedMs < MINUTE_MS) return `${Math.floor(elapsedMs / SECOND_MS)}s ago`;
  if (elapsedMs < HOUR_MS) return `${Math.floor(elapsedMs / MINUTE_MS)}m ago`;

  return `${Math.floor(elapsedMs / HOUR_MS)}h ago`;
}

export function getLiveConnectionCopy(
  connection: LiveUpdatesConnectionState,
  now: number
) {
  const age = formatConnectionAge(connection.lastSyncedAt, now);
  const lastUpdateLabel = age ? `last update ${age}` : "not updated yet";

  if (connection.status === "live") {
    return {
      label: "Live",
      detail: age === "now" ? "updated now" : lastUpdateLabel,
      compactDetail: age === "now" ? "updated" : age ? `update ${age}` : "not updated"
    };
  }

  if (connection.status === "connecting") {
    return {
      label: "Connecting",
      detail: age ? lastUpdateLabel : "opening live updates",
      compactDetail: age ?? "opening"
    };
  }

  if (connection.status === "reconnecting") {
    return {
      label: "Reconnecting",
      detail: lastUpdateLabel,
      compactDetail: age ?? "not synced"
    };
  }

  return {
    label: "Host offline",
    detail: lastUpdateLabel,
    compactDetail: age ?? "not synced"
  };
}

export function getLiveConnectionFreshnessLabel(
  copy: ReturnType<typeof getLiveConnectionCopy>
) {
  const freshness = copy.detail
    .replace(/^updated\s+/i, "")
    .replace(/^last update\s+/i, "");
  return `Last update ${freshness}`;
}

export function findSourceAgentSession(
  session: SessionSummary,
  agentSessions: AgentSessionSummary[]
) {
  if (!session.sourceSessionId) return null;

  return agentSessions.find(
    (agentSession) =>
      agentSession.agentId === session.adapterId &&
      agentSession.sourceSessionId === session.sourceSessionId
  ) ?? null;
}

export function formatSwitcherTitle(
  session: SessionSummary,
  sourceAgentSession: AgentSessionSummary | null
) {
  return sourceAgentSession?.title ?? formatManagedSessionTitle(session);
}

export function formatSwitcherSubtitle(
  session: SessionSummary,
  sourceAgentSession: AgentSessionSummary | null
) {
  return sourceAgentSession?.workspaceName ?? formatManagedSessionSubtitle(session);
}
