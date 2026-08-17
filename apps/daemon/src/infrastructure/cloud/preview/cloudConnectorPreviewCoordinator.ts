import WebSocket from "ws";

import { logger } from "#infrastructure/logging/logger";
import { SqliteCloudConnectorStore } from "#persistence/cloud/cloudConnectorStore";
import type { CloudConnectorProfile } from "#persistence/cloud/cloudConnectorStore";

import { CloudPreviewDataPlane } from "./cloudPreviewDataPlane.ts";
import type { CloudPreviewTargetResolver } from "./cloudPreviewRequestPolicy.ts";
import type { CloudEnrollmentCoordinator } from "../connector/cloudEnrollmentCoordinator.ts";
import type { CloudRelaySocketTransport } from "../connector/cloudRelaySocketTransport.ts";

type CloudConnectorPreviewCoordinatorOptions = {
  dataPlane: CloudPreviewDataPlane;
  enrollment: CloudEnrollmentCoordinator;
  socketTransport: CloudRelaySocketTransport;
  store: SqliteCloudConnectorStore;
  readSocket: () => WebSocket | null;
  readConnectionEpoch: () => number;
  readLifecycleSignal: () => AbortSignal;
  isClosed: () => boolean;
  isRemotePreviewNegotiated: () => boolean;
  toErrorCode: (error: unknown) => string;
};

/** Owns the optional Preview data-plane connection lifecycle. */
export class CloudConnectorPreviewCoordinator {
  private connectPromise: Promise<void> | null = null;

  constructor(private readonly options: CloudConnectorPreviewCoordinatorOptions) {}

  configureTargetResolver(resolver: CloudPreviewTargetResolver) {
    this.options.dataPlane.configureTargetResolver(resolver);
  }

  disconnect() {
    this.options.dataPlane.disconnect();
  }

  reset() {
    this.options.dataPlane.close();
  }

  async close() {
    this.options.dataPlane.close();
    if (this.connectPromise) await Promise.allSettled([this.connectPromise]);
  }

  start(profile: CloudConnectorProfile, connectionEpoch: number) {
    if (
      this.connectPromise ||
      !this.options.dataPlane.isConfigured() ||
      !profile.remotePreviewEnabled ||
      !this.options.isRemotePreviewNegotiated()
    ) return;
    const mainSocket = this.options.readSocket();
    if (!mainSocket) return;
    const lifecycleSignal = this.options.readLifecycleSignal();
    this.connectPromise = this.open(
      profile,
      connectionEpoch,
      lifecycleSignal,
      mainSocket
    ).catch((error) => {
      if (
        !this.options.isClosed() &&
        this.options.readConnectionEpoch() === connectionEpoch &&
        this.options.readSocket() === mainSocket &&
        profile.remotePreviewEnabled &&
        this.options.isRemotePreviewNegotiated()
      ) {
        logger.warn("DeskCue Cloud Preview data connection failed", {
          errorCode: this.options.toErrorCode(error)
        });
        this.options.socketTransport.close(mainSocket, 1013, "Cloud Preview data connection failed");
      }
    }).finally(() => {
      this.connectPromise = null;
      this.restartAfterConnectionChange(mainSocket);
    });
  }

  private restartAfterConnectionChange(previousMainSocket: WebSocket) {
    const currentSocket = this.options.readSocket();
    if (!currentSocket || currentSocket === previousMainSocket ||
        !this.options.isRemotePreviewNegotiated()) return;
    try {
      const currentProfile = this.options.store.readActiveProfile();
      if (currentProfile?.remotePreviewEnabled) {
        this.start(currentProfile, this.options.readConnectionEpoch());
      }
    } catch {
      logger.warn("DeskCue Cloud Preview reconnect state is unavailable", {
        errorCode: "cloud_connector_state_unavailable"
      });
    }
  }

  private async open(
    profile: CloudConnectorProfile,
    connectionEpoch: number,
    lifecycleSignal: AbortSignal,
    mainSocket: WebSocket
  ) {
    if (!profile.remotePreviewEnabled || !this.options.isRemotePreviewNegotiated()) return;
    if (!this.isConnectionAllowed(profile, connectionEpoch, mainSocket)) return;
    const connection = await this.options.enrollment.createConnectionToken(profile, lifecycleSignal);
    if (!this.isConnectionAllowed(profile, connectionEpoch, mainSocket)) return;
    await this.options.dataPlane.open({
      connection,
      isCurrent: () => this.isConnectionAllowed(profile, connectionEpoch, mainSocket),
      onConnectionClosed: () => {
        this.options.socketTransport.close(mainSocket, 1013, "Cloud Preview data connection closed");
      }
    });
  }

  private isConnectionAllowed(
    profile: CloudConnectorProfile,
    connectionEpoch: number,
    mainSocket: WebSocket
  ) {
    return !this.options.isClosed() &&
      this.options.readConnectionEpoch() === connectionEpoch &&
      this.options.readSocket() === mainSocket &&
      this.options.store.readActiveProfile()?.id === profile.id &&
      profile.remotePreviewEnabled &&
      this.options.isRemotePreviewNegotiated();
  }
}
