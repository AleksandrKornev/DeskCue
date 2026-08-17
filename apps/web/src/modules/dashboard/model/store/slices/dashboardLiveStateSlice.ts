import type {
  OverviewResponse,
  SessionSummary,
  WorkspaceSummary
} from "@deskcue/protocol";
import type { LiveUpdatesConnectionState } from "@models/liveUpdatesConnection";
import {
  LIVE_UPDATES_OFFLINE_MESSAGE,
  LIVE_UPDATES_RECONNECT_MESSAGE
} from "@models/liveUpdatesConnection";

import {
  buildLiveUpdatesConnectingState,
  buildLiveUpdatesOfflineState,
  buildLiveUpdatesReconnectingState,
  buildLiveUpdatesSyncedState
} from "./liveUpdatesState";
import {
  addOverviewWorkspaceSummary,
  mergeOverviewSessionSummary,
  touchOverviewSessionActivity
} from "./overviewState";

export type DashboardLiveState = {
  error: string;
  eventStreamAttempt: number;
  liveUpdatesConnection: LiveUpdatesConnectionState;
  overview: OverviewResponse;
};

export function mergeOverviewSession(
  state: DashboardLiveState,
  summary: SessionSummary
) {
  state.overview = mergeOverviewSessionSummary(state.overview, summary);
}

export function touchOverviewSession(
  state: DashboardLiveState,
  sessionId: string,
  timestamp: string
) {
  state.overview = touchOverviewSessionActivity(state.overview, sessionId, timestamp);
}

export function addWorkspaceSummary(
  state: DashboardLiveState,
  summary: WorkspaceSummary
) {
  state.overview = addOverviewWorkspaceSummary(state.overview, summary);
}

export function clearLiveUpdatesReconnectError(state: DashboardLiveState) {
  if (
    state.error === LIVE_UPDATES_OFFLINE_MESSAGE ||
    state.error === LIVE_UPDATES_RECONNECT_MESSAGE
  ) {
    state.error = "";
  }
}

export function setLiveUpdatesConnecting(state: DashboardLiveState) {
  state.liveUpdatesConnection = buildLiveUpdatesConnectingState(state.liveUpdatesConnection);
}

export function markLiveUpdatesSynced(
  state: DashboardLiveState,
  syncedAt = new Date().toISOString()
) {
  state.liveUpdatesConnection = buildLiveUpdatesSyncedState(syncedAt);
}

export function setLiveUpdatesReconnecting(state: DashboardLiveState) {
  state.liveUpdatesConnection = buildLiveUpdatesReconnectingState(state.liveUpdatesConnection);
}

export function setLiveUpdatesOffline(state: DashboardLiveState) {
  state.liveUpdatesConnection = buildLiveUpdatesOfflineState(state.liveUpdatesConnection);
}
