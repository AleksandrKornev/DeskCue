import type { RouteViewState } from "@models/dashboardRoute";
import type { useDeskCueDashboard } from "@modules/dashboard/model";

export type DashboardState = ReturnType<typeof useDeskCueDashboard>;

export type UseDashboardShellControllerArgs = {
  dashboard: DashboardState;
  routeState: RouteViewState;
};
