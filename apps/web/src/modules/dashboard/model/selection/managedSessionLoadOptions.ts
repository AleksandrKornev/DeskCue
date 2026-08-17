import type { SessionTab } from "@models/sessionTabs";
import { MANAGED_SESSION_DEBUG_LOG_TAIL } from "@modules/dashboard/model/data/dashboardConstants";
import type { LoadOptions } from "@modules/dashboard/model/data/dashboardLoad";

export function buildManagedSessionLoadOptionsForTab(
  activeTab: SessionTab,
  baseOptions: Pick<LoadOptions, "force" | "silent"> = {}
): LoadOptions {
  if (activeTab === "logs") {
    return {
      ...baseOptions,
      debugLogTail: MANAGED_SESSION_DEBUG_LOG_TAIL,
      sessionView: "debug"
    };
  }

  if (activeTab === "diff") {
    return {
      ...baseOptions,
      sessionView: "diff"
    };
  }

  return {
    ...baseOptions,
    sessionView: "chat"
  };
}
