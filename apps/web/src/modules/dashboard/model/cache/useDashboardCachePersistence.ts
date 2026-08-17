import { useEffect } from "react";

import type { DashboardCache } from "@models/dashboardCache";

import { writeDashboardCache } from "./storage";

export function useDashboardCachePersistence(value: DashboardCache) {
  useEffect(() => {
    writeDashboardCache(value);
  }, [value]);
}
