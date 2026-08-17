import {
  CLOUD_RELAY_CAPABILITY,
  CLOUD_RELAY_STREAM,
  CLOUD_REMOTE_CONTROL_CAPABILITY,
  CLOUD_REMOTE_FILES_CAPABILITY,
  CLOUD_REMOTE_PREVIEW_CAPABILITY,
  CLOUD_REMOTE_READ_CAPABILITY,
  CLOUD_REMOTE_REALTIME_CAPABILITY
} from "@deskcue/protocol/cloud";
import type { CloudRelayWelcome } from "@deskcue/protocol/cloud";
import type { CloudConnectorProfile } from "#persistence/cloud/cloudConnectorStore";

export type CloudRelayWelcomeResult = {
  connectedAt: string;
  nextServerSequence: number;
};

function resolveProfileCapabilities(profile: CloudConnectorProfile) {
  return [
    CLOUD_RELAY_CAPABILITY,
    ...(profile.remoteReadEnabled ? [CLOUD_REMOTE_READ_CAPABILITY] : []),
    ...(profile.remoteReadEnabled ? [CLOUD_REMOTE_REALTIME_CAPABILITY] : []),
    ...(profile.remoteFilesEnabled ? [CLOUD_REMOTE_FILES_CAPABILITY] : []),
    ...(profile.remoteControlEnabled ? [CLOUD_REMOTE_CONTROL_CAPABILITY] : []),
    ...(profile.remotePreviewEnabled ? [CLOUD_REMOTE_PREVIEW_CAPABILITY] : [])
  ];
}

/** Validates the relay handshake and owns the negotiated capability state. */
export class CloudRelayNegotiation {
  private negotiatedRemoteControl = false;
  private negotiatedRemoteFiles = false;
  private negotiatedRemotePreview = false;
  private negotiatedRemoteRead = false;
  private negotiatedRemoteRealtime = false;
  private welcomeReceived = false;

  get remoteControl() { return this.negotiatedRemoteControl; }
  get remoteFiles() { return this.negotiatedRemoteFiles; }
  get remotePreview() { return this.negotiatedRemotePreview; }
  get remoteRead() { return this.negotiatedRemoteRead; }
  get remoteRealtime() { return this.negotiatedRemoteRealtime; }

  offeredCapabilities(profile: CloudConnectorProfile) {
    return resolveProfileCapabilities(profile);
  }

  prepareForRelay() {
    this.welcomeReceived = false;
  }

  acceptWelcome(
    profile: CloudConnectorProfile,
    frame: CloudRelayWelcome
  ): CloudRelayWelcomeResult {
    if (this.welcomeReceived) {
      throw new Error("Cloud relay sent more than one welcome frame.");
    }
    const offeredCapabilities = resolveProfileCapabilities(profile);
    if (
      frame.machineId !== profile.machineId ||
      !frame.negotiatedCapabilities.includes(CLOUD_RELAY_CAPABILITY) ||
      frame.negotiatedCapabilities.some(
        (capability) => !offeredCapabilities.includes(capability)
      )
    ) {
      throw new Error("Cloud relay welcome identity or capability mismatch.");
    }
    const position = frame.streamPositions.find((item) => item.stream === CLOUD_RELAY_STREAM);
    if (!position) throw new Error("Cloud relay welcome omitted the session stream.");
    this.negotiatedRemoteRead = frame.negotiatedCapabilities.includes(
      CLOUD_REMOTE_READ_CAPABILITY
    );
    this.negotiatedRemoteFiles = frame.negotiatedCapabilities.includes(
      CLOUD_REMOTE_FILES_CAPABILITY
    );
    this.negotiatedRemotePreview = frame.negotiatedCapabilities.includes(
      CLOUD_REMOTE_PREVIEW_CAPABILITY
    );
    this.negotiatedRemoteControl = frame.negotiatedCapabilities.includes(
      CLOUD_REMOTE_CONTROL_CAPABILITY
    );
    this.negotiatedRemoteRealtime = frame.negotiatedCapabilities.includes(
      CLOUD_REMOTE_REALTIME_CAPABILITY
    );
    this.welcomeReceived = true;
    return {
      connectedAt: frame.connectedAt,
      nextServerSequence: position.nextSequence
    };
  }

  reset() {
    this.negotiatedRemoteControl = false;
    this.negotiatedRemoteFiles = false;
    this.negotiatedRemotePreview = false;
    this.negotiatedRemoteRead = false;
    this.negotiatedRemoteRealtime = false;
    this.welcomeReceived = false;
  }
}
