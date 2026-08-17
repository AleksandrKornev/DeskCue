export type LiveUpdatesConnectionStatus =
  | "connecting"
  | "live"
  | "reconnecting"
  | "offline";

export interface LiveUpdatesConnectionState {
  status: LiveUpdatesConnectionStatus;
  lastSyncedAt: string | null;
}

export const LIVE_UPDATES_OFFLINE_MESSAGE =
  "DeskCue is offline — live updates will resume when the connection returns";
export const LIVE_UPDATES_RECONNECT_MESSAGE = "Live updates disconnected. Reconnecting...";

export const initialLiveUpdatesConnectionState: LiveUpdatesConnectionState = {
  status: "connecting",
  lastSyncedAt: null
};
