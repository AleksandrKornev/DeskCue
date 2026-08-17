import type { LiveUpdatesConnectionState } from "@models/liveUpdatesConnection";

export function buildLiveUpdatesConnectingState(
  current: LiveUpdatesConnectionState
): LiveUpdatesConnectionState {
  return {
    status: "connecting",
    lastSyncedAt: current.lastSyncedAt
  };
}

export function buildLiveUpdatesSyncedState(syncedAt: string): LiveUpdatesConnectionState {
  return {
    status: "live",
    lastSyncedAt: syncedAt
  };
}

export function buildLiveUpdatesReconnectingState(
  current: LiveUpdatesConnectionState
): LiveUpdatesConnectionState {
  return {
    status: "reconnecting",
    lastSyncedAt: current.lastSyncedAt
  };
}

export function buildLiveUpdatesOfflineState(
  current: LiveUpdatesConnectionState
): LiveUpdatesConnectionState {
  return {
    status: "offline",
    lastSyncedAt: current.lastSyncedAt
  };
}
