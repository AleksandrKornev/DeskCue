import type { CloudConnectionStatusResponse, UpdateCloudPermissionsInput } from "@deskcue/protocol/cloud";
import type { CloudConnectorProfile, SqliteCloudConnectorStore } from "#persistence/cloud/cloudConnectorStore";

import type { CloudEnrollmentCoordinator } from "../cloudEnrollmentCoordinator.ts";

type CloudConnectorPermissionsOptions = {
  enrollment: CloudEnrollmentCoordinator;
  store: SqliteCloudConnectorStore;
  advanceConnectionEpoch: () => number;
  clearReconnectTimer: () => void;
  disconnectSocket: () => void;
  getConnectPromise: () => Promise<void> | null;
  getConnectionEpoch: () => number;
  getStatus: () => CloudConnectionStatusResponse;
  isClosed: () => boolean;
  readLifecycleSignal: () => AbortSignal;
  scheduleConnect: (delayMs: number) => void;
  toErrorCode: (error: unknown) => string;
};

function permissionsFromProfile(profile: CloudConnectorProfile): UpdateCloudPermissionsInput {
  return {
    allowRemoteRead: profile.remoteReadEnabled,
    allowRemoteFiles: profile.remoteFilesEnabled,
    allowRemoteControl: profile.remoteControlEnabled,
    allowRemotePreview: profile.remotePreviewEnabled
  };
}

function intersectPermissions(
  current: UpdateCloudPermissionsInput,
  desired: UpdateCloudPermissionsInput
): UpdateCloudPermissionsInput {
  return {
    allowRemoteRead: current.allowRemoteRead && desired.allowRemoteRead,
    allowRemoteFiles: current.allowRemoteFiles && desired.allowRemoteFiles,
    allowRemoteControl: current.allowRemoteControl && desired.allowRemoteControl,
    allowRemotePreview: current.allowRemotePreview && desired.allowRemotePreview
  };
}

function permissionsEqual(left: UpdateCloudPermissionsInput, right: UpdateCloudPermissionsInput) {
  return left.allowRemoteRead === right.allowRemoteRead &&
    left.allowRemoteFiles === right.allowRemoteFiles &&
    left.allowRemoteControl === right.allowRemoteControl &&
    left.allowRemotePreview === right.allowRemotePreview;
}

export class CloudConnectorPermissions {
  constructor(private readonly options: CloudConnectorPermissionsOptions) {}

  async apply(input: UpdateCloudPermissionsInput): Promise<CloudConnectionStatusResponse> {
    const profile = this.options.store.readActiveProfile();

    if (!profile) throw new Error("cloud_connector_not_connected");

    const current = permissionsFromProfile(profile);
    const repairsFailedSync = profile.lastErrorCode?.startsWith("capabilities_") === true;

    if (permissionsEqual(current, input) && !repairsFailedSync) return this.options.getStatus();

    const safePermissions = intersectPermissions(current, input);
    const hasRevocations = !permissionsEqual(current, safePermissions);
    let updateEpoch = this.options.getConnectionEpoch();
    let staleConnect: Promise<void> | null = null;

    if (hasRevocations) {
      staleConnect = this.options.getConnectPromise();
      updateEpoch = this.options.advanceConnectionEpoch();
      this.options.clearReconnectTimer();
      this.options.disconnectSocket();
      this.options.store.updatePermissions(profile.id, safePermissions);
      this.options.store.updateState(profile.id, "connecting", { errorCode: null, negotiated: false });
    }

    try {
      await this.options.enrollment.replaceCapabilities(profile, input, this.options.readLifecycleSignal());
    } catch (error) {
      if (hasRevocations && !this.options.isClosed() && this.options.getConnectionEpoch() === updateEpoch &&
          this.options.store.readActiveProfile()?.id === profile.id) {
        this.options.store.updateState(profile.id, "degraded", {
          errorCode: this.options.toErrorCode(error),
          negotiated: false
        });
      }

      throw error;
    }

    if (!hasRevocations) {
      staleConnect = this.options.getConnectPromise();
      updateEpoch = this.options.advanceConnectionEpoch();
      this.options.clearReconnectTimer();
      this.options.disconnectSocket();
    }

    if (this.options.isClosed() || this.options.getConnectionEpoch() !== updateEpoch ||
        this.options.store.readActiveProfile()?.id !== profile.id) {
      throw new Error("cloud_permissions_update_cancelled");
    }

    this.options.store.updatePermissions(profile.id, input);
    this.options.store.updateState(profile.id, "connecting", { errorCode: null, negotiated: false });
    if (staleConnect) await Promise.allSettled([staleConnect]);
    if (this.options.isClosed() || this.options.getConnectionEpoch() !== updateEpoch ||
        this.options.store.readActiveProfile()?.id !== profile.id) {
      throw new Error("cloud_permissions_update_cancelled");
    }

    this.options.scheduleConnect(0);
    return this.options.getStatus();
  }
}
