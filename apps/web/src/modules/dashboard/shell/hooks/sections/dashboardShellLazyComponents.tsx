import { lazy } from "react";

export const LazyAgentBrowserShell = lazy(() =>
  import("@modules/dashboard/shell/AgentBrowserShell").then((module) => ({
    default: module.AgentBrowserShell
  }))
);

export const LazyLiveSessionOverlay = lazy(() =>
  import("@modules/dashboard/shell/LiveSessionOverlay").then((module) => ({
    default: module.LiveSessionOverlay
  }))
);
