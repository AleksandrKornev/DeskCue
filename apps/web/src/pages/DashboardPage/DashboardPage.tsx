import { useSearchParams } from "react-router";

import { parseSourceId } from "@models/dashboardRoute";
import { DashboardShell } from "@modules/dashboard";
import type { DashboardState } from "@modules/dashboard";

type DashboardPageProps = {
  dashboard: DashboardState;
};

export function DashboardPage({ dashboard }: DashboardPageProps) {
  const [searchParams] = useSearchParams();

  return (
    <DashboardShell
      dashboard={dashboard}
      routeState={{
        kind: "dashboard",
        sessionId: null,
        tab: "overview",
        sourceId: parseSourceId(searchParams.get("source")),
        agentSessionId: searchParams.get("agent") ?? "",
        overlay: null
      }}
    />
  );
}
