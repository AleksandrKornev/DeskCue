export function resetDashboardScroll() {
  if (typeof window === "undefined") {
    return;
  }

  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  window.requestAnimationFrame(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  });
}

export function resolveNavigateAgentSessionId({
  nextAgentSessionId,
  routeAgentSessionId,
  selectedAgentSessionId
}: {
  nextAgentSessionId?: string;
  routeAgentSessionId: string;
  selectedAgentSessionId: string;
}) {
  return nextAgentSessionId ?? (routeAgentSessionId || selectedAgentSessionId);
}
