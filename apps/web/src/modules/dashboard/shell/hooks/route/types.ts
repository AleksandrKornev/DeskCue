import type { RouteViewState } from "@models/dashboardRoute";
import type { useDeskCueDashboard } from "@modules/dashboard/model";

type DashboardState = ReturnType<typeof useDeskCueDashboard>;

export type UseDashboardShellRouteOrchestrationArgs = {
  dashboard: DashboardState;
  routeState: RouteViewState;
};

export type UseDashboardRouteScrollResetArgs = {
  isExitingToDashboardFrame: boolean;
  routeState: RouteViewState;
  setIsExitingToDashboardFrame: (value: boolean) => void;
};
