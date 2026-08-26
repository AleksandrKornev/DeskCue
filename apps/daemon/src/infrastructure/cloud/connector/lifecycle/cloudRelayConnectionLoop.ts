import { logger } from "#infrastructure/logging/logger";
import type { CloudConnectorProfile, SqliteCloudConnectorStore } from "#persistence/cloud/cloudConnectorStore";

import type { CloudConnectionToken } from "../cloudConnectorHttpClient.ts";
import type { CloudEnrollmentCoordinator } from "../cloudEnrollmentCoordinator.ts";

const CLOUD_RECONNECT_MAX_MS = 30_000;

type CloudRelayConnectionLoopOptions = {
  attachSocket: (
    profile: CloudConnectorProfile,
    connection: CloudConnectionToken,
    connectionEpoch: number
  ) => Promise<void>;
  enrollment: CloudEnrollmentCoordinator;
  getConnectionEpoch: () => number;
  isClosed: () => boolean;
  readLifecycleSignal: () => AbortSignal;
  store: SqliteCloudConnectorStore;
  toErrorCode: (error: unknown) => string;
};

export class CloudRelayConnectionLoop {
  private connectAttempt = 0;
  private connectPromise: Promise<void> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: CloudRelayConnectionLoopOptions) {}

  get pending() {
    return this.connectPromise;
  }

  clear() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  resetAttempts() {
    this.connectAttempt = 0;
  }

  schedule(delayMs: number) {
    if (this.options.isClosed()) return;

    try {
      if (!this.options.store.readActiveProfile()) return;
    } catch {
      logger.warn("DeskCue Cloud reconnect scheduling failed", {
        errorCode: "cloud_connector_state_unavailable"
      });
      return;
    }

    this.clear();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.runConnectAttempt().catch(() => {
        logger.warn("DeskCue Cloud connection boundary rejected", {
          errorCode: "cloud_connection_boundary_failed"
        });
      });
    }, delayMs);
    this.reconnectTimer.unref?.();
  }

  scheduleReconnect() {
    this.connectAttempt += 1;
    const exponential = Math.min(CLOUD_RECONNECT_MAX_MS, 1_000 * 2 ** Math.min(this.connectAttempt, 5));
    const jitter = Math.floor(Math.random() * Math.max(1, exponential / 4));

    this.schedule(exponential + jitter);
  }

  private runConnectAttempt() {
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this.openRelay().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private async openRelay() {
    const connectionEpoch = this.options.getConnectionEpoch();
    let profile: CloudConnectorProfile | null = null;
    try {
      profile = this.options.store.readActiveProfile();
      if (!profile || !profile.machineId || this.options.isClosed()) return;

      this.options.store.updateState(profile.id, "connecting", { errorCode: null, negotiated: false });
      const connection = await this.options.enrollment.createConnectionToken(
        profile,
        this.options.readLifecycleSignal()
      );

      if (this.options.isClosed() || this.options.getConnectionEpoch() !== connectionEpoch ||
          this.options.store.readActiveProfile()?.id !== profile.id) return;

      await this.options.attachSocket(profile, connection, connectionEpoch);
    } catch (error) {
      this.handleOpenRelayFailure(profile, connectionEpoch, error);
    }
  }

  private handleOpenRelayFailure(
    profile: CloudConnectorProfile | null,
    connectionEpoch: number,
    error: unknown
  ) {
    if (this.options.isClosed() || this.options.getConnectionEpoch() !== connectionEpoch) return;

    try {
      if (!profile) {
        logger.warn("DeskCue Cloud connection state is unavailable", {
          errorCode: "cloud_connector_state_unavailable"
        });
        return;
      }

      if (this.options.store.readActiveProfile()?.id !== profile.id) return;

      const errorCode = this.options.toErrorCode(error);
      const revoked = errorCode === "connection_http_401";

      this.options.store.updateState(profile.id, revoked ? "revoked" : "degraded", { errorCode });

      if (!revoked) this.scheduleReconnect();
      logger.warn("DeskCue Cloud connection attempt failed", { errorCode });
    } catch {
      logger.warn("DeskCue Cloud connection failure recovery failed", {
        errorCode: "cloud_connector_state_unavailable"
      });
    }
  }
}
