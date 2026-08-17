import { Navigate, useParams, useSearchParams } from "react-router";

import {
  parseOverlayMode,
  parseSessionTab,
  parseSourceId
} from "@models/dashboardRoute";
import { DashboardShell } from "@modules/dashboard";
import type { DashboardState } from "@modules/dashboard";

type ManagedSessionPageProps = {
  dashboard: DashboardState;
};

export function ManagedSessionPage({ dashboard }: ManagedSessionPageProps) {
  const [searchParams] = useSearchParams();
  const params = useParams();

  const sessionId = params.sessionId ?? null;

  if (!sessionId) {
    return <Navigate replace to="/" />;
  }

  return (
    <DashboardShell
      dashboard={dashboard}
      routeState={{
        kind: "session",
        sessionId,
        tab: parseSessionTab(params.tab),
        sourceId: parseSourceId(searchParams.get("source")),
        agentSessionId: searchParams.get("agent") ?? "",
        overlay: parseOverlayMode(searchParams.get("overlay"))
      }}
    />
  );
}
