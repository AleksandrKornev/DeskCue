import { makeAutoObservable } from "mobx";

import type { AgentKind } from "@deskcue/protocol";
import type { SessionTab } from "@models/sessionTabs";

export class DashboardNavigationStore {
  isAgentBrowserListMode = false;
  isDashboardPinned: boolean;
  openingAgentSessionId = "";
  pendingSendRouteSync = false;
  pendingDashboardExit = false;
  pendingSessionTabSelection: SessionTab | "" = "";
  pendingSourceRouteSelection: AgentKind | "all" | "" = "";
  pendingAgentRouteSelection = "";

  constructor(input: { isDashboardPinned: boolean }) {
    this.isDashboardPinned = input.isDashboardPinned;

    makeAutoObservable(
      this,
      {},
      {
        autoBind: true
      }
    );
  }

  setIsAgentBrowserListMode(value: boolean) {
    this.isAgentBrowserListMode = value;
  }

  setIsDashboardPinned(value: boolean) {
    this.isDashboardPinned = value;
  }

  setOpeningAgentSessionId(value: string) {
    this.openingAgentSessionId = value;
  }

  setPendingSendRouteSync(value: boolean) {
    this.pendingSendRouteSync = value;
  }

  setPendingDashboardExit(value: boolean) {
    this.pendingDashboardExit = value;
  }

  setPendingSessionTabSelection(value: SessionTab | "") {
    this.pendingSessionTabSelection = value;
  }

  setPendingSourceRouteSelection(value: AgentKind | "all" | "") {
    this.pendingSourceRouteSelection = value;
  }

  setPendingAgentRouteSelection(value: string) {
    this.pendingAgentRouteSelection = value;
  }

  resetConnectionScopedState() {
    this.isAgentBrowserListMode = false;
    this.isDashboardPinned = true;
    this.openingAgentSessionId = "";
    this.pendingSendRouteSync = false;
    this.pendingDashboardExit = false;
    this.pendingSessionTabSelection = "";
    this.pendingSourceRouteSelection = "";
    this.pendingAgentRouteSelection = "";
  }
}

export const dashboardNavigationStore = new DashboardNavigationStore({
  isDashboardPinned: true
});
