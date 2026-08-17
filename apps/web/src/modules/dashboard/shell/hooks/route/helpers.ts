import type { RouteViewState } from "@models/dashboardRoute";

export function resetWindowScroll() {
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
}

export function restoreWindowScroll(top: number) {
  const maximumTop = Math.max(document.documentElement.scrollHeight - window.innerHeight, 0);
  window.scrollTo({
    top: Math.min(Math.max(top, 0), maximumTop),
    left: 0,
    behavior: "auto"
  });
}

export function shouldResetWindowScrollOnSessionRoute({
  agentSessionId,
  kind,
  tab
}: Pick<RouteViewState, "agentSessionId" | "kind" | "tab">) {
  if (kind !== "session") {
    return false;
  }

  return tab !== "overview" || !agentSessionId;
}
