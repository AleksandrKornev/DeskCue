import { useState } from "react";

import type { DashboardCache } from "@models/dashboardCache";
import type {
  DashboardStore,
  DashboardStoreOptions
} from "@modules/dashboard/model/store";

import { readDashboardCache } from "./storage";

export function useDashboardCachedState(
  store: DashboardStore,
  options?: DashboardStoreOptions
) {
  const [cachedState] = useState<DashboardCache>(() => {
    const nextCachedState = readDashboardCache();
    store.hydrateFromCache(nextCachedState, options);
    return nextCachedState;
  });

  return cachedState;
}
