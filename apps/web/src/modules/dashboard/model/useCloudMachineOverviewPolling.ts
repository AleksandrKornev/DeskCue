import { useEffect } from "react";

import type { AgentKind } from "@deskcue/protocol";
import { getDeskCueRuntime } from "@runtime";

import type { useDashboardLoaders } from "./data";

export function useCloudMachineOverviewPolling({
  agentSessionsQuery,
  loadAgentSessions,
  loadOverview,
  searchAgentSessions,
  selectedSourceId
}: {
  agentSessionsQuery: string | null;
  loadAgentSessions: ReturnType<typeof useDashboardLoaders>["loadAgentSessions"];
  loadOverview: ReturnType<typeof useDashboardLoaders>["loadOverview"];
  searchAgentSessions: ReturnType<typeof useDashboardLoaders>["searchAgentSessions"];
  selectedSourceId: AgentKind | "all";
}) {
  useEffect(() => {
    if (getDeskCueRuntime().mode !== "cloud-machine") return;

    let polling = false;
    let stopped = false;
    const refresh = () => {
      if (polling || document.visibilityState === "hidden") return;
      polling = true;
      const normalizedQuery = agentSessionsQuery?.trim() ?? "";
      const agentSessionsRequest = normalizedQuery
        ? searchAgentSessions(normalizedQuery, {
            silent: true,
            sourceId: selectedSourceId
          })
        : loadAgentSessions({
            silent: true,
            sourceId: selectedSourceId
          });
      void Promise.allSettled([
        loadOverview({ silent: true }),
        agentSessionsRequest
      ]).finally(() => {
        if (!stopped) polling = false;
      });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    agentSessionsQuery,
    loadAgentSessions,
    loadOverview,
    searchAgentSessions,
    selectedSourceId
  ]);
}
