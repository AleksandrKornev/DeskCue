import type { AgentSessionSummary, SessionSummary } from "@deskcue/protocol";
import type { LiveUpdatesConnectionState } from "@models/liveUpdatesConnection";
import {
  formatManagedSessionSubtitle,
  formatManagedSessionTitle
} from "@models/sessionDisplay";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const ATTENTION_SESSION_STATUS_LABELS = new Set([
  "control lost",
  "interrupt unconfirmed",
  "recovering",
  "retry required",
  "stopping"
]);

export function isAttentionSessionStatus(statusLabel?: string) {
  return Boolean(statusLabel && ATTENTION_SESSION_STATUS_LABELS.has(statusLabel));
}

export function isDangerSessionStatus(
  status: SessionSummary["status"],
  statusLabel?: string
) {
  if (status === "failed") return true;

  return status === "stopped" && (statusLabel?.trim().toLowerCase() ?? status) === "stopped";
}

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
    const compactDetail = age === "now"
      ? "Updated now"
      : age
        ? `Updated ${age}`
        : "Awaiting update";

    return {
      label: "Live",
      detail: age === "now" ? "updated now" : lastUpdateLabel,
      compactDetail,
      tooltipLabel: age ? compactDetail : "No update received yet"
    };
  }

  if (connection.status === "connecting") {
    return {
      label: "Connecting",
      detail: age ? lastUpdateLabel : "opening live updates",
      compactDetail: "Connecting",
      tooltipLabel: age ? `Last update ${age}` : "Opening live updates"
    };
  }

  if (connection.status === "reconnecting") {
    return {
      label: "Reconnecting",
      detail: lastUpdateLabel,
      compactDetail: "Reconnecting",
      tooltipLabel: age ? `Last update ${age}` : "No update received yet"
    };
  }

  return {
    label: "Updates offline",
    detail: lastUpdateLabel,
    compactDetail: "Updates offline",
    tooltipLabel: age ? `Last update ${age}` : "No update received yet"
  };
}

export function getLiveConnectionTooltipLabel(
  copy: ReturnType<typeof getLiveConnectionCopy>
) {
  if (copy.label === "Live") return copy.tooltipLabel;

  return `${copy.label} · ${copy.tooltipLabel}`;
}

export function getWorkspaceDisplayLabel(subtitle: string) {
  const normalizedSubtitle = subtitle.trim();

  if (!normalizedSubtitle) return "Workspace";

  return normalizedSubtitle.split(/[\\/]/u).filter(Boolean).at(-1) ?? normalizedSubtitle;
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
