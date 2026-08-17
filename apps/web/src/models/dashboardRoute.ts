import type { AgentKind } from "@deskcue/protocol";
import { sessionTabs } from "@models/sessionTabs";
import type { SessionTab } from "@models/sessionTabs";

const validAgentKinds = new Set<AgentKind>(["codex", "claude-code", "other"]);
const validSessionTabs = new Set<SessionTab>(sessionTabs.map((tab) => tab.key));

export type OverlayMode = "tools" | null;

export type RouteViewState = {
  kind: "dashboard" | "session";
  sessionId: string | null;
  tab: SessionTab;
  sourceId: AgentKind | "all";
  agentSessionId: string;
  overlay: OverlayMode;
};

export function parseSourceId(value: string | null): AgentKind | "all" {
  if (!value) {
    return "all";
  }

  return validAgentKinds.has(value as AgentKind) ? (value as AgentKind) : "all";
}

export function parseSessionTab(value: string | undefined): SessionTab {
  if (!value) {
    return "overview";
  }

  return validSessionTabs.has(value as SessionTab) ? (value as SessionTab) : "overview";
}

export function parseOverlayMode(value: string | null): OverlayMode {
  if (value === "tools") {
    return value;
  }

  return null;
}

export function buildRouteSearch(input: {
  sourceId: AgentKind | "all";
  agentSessionId: string;
  overlay: OverlayMode;
  includeOverlay?: boolean;
}) {
  const params = new URLSearchParams();

  if (input.sourceId !== "all") {
    params.set("source", input.sourceId);
  }

  if (input.agentSessionId) {
    params.set("agent", input.agentSessionId);
  }

  if (input.includeOverlay && input.overlay) {
    params.set("overlay", input.overlay);
  }

  const nextSearch = params.toString();
  return nextSearch ? `?${nextSearch}` : "";
}

export function buildSessionPath(sessionId: string, tab: SessionTab) {
  return `/sessions/${encodeURIComponent(sessionId)}/${tab}`;
}
