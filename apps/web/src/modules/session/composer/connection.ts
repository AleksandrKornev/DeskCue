import type { LiveUpdatesConnectionStatus } from "@models/liveUpdatesConnection";

export function getComposerConnectionNotice(status: LiveUpdatesConnectionStatus | undefined) {
  if (status === "offline") return "Offline — your draft is saved and will be ready to send after reconnecting.";

  if (status === "reconnecting") {
    return "Reconnecting — your draft is saved and sending will resume when DeskCue is live.";
  }

  if (status === "connecting") return "Connecting to DeskCue — sending will be available when live updates start.";

  return null;
}

export function isComposerTransportAvailable(status: LiveUpdatesConnectionStatus | undefined) {
  return status === undefined || status === "live";
}
