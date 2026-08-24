import { dirname } from "node:path";
import WebSocket from "ws";

import {
  CLOUD_RELAY_PROTOCOL_VERSION,
  CLOUD_RELAY_STREAM
} from "@deskcue/protocol/cloud";
import type {
  CloudConnectionStatusResponse,
  CloudEnrollmentAttemptResponse,
  CloudRelayClientFrame,
  ConnectCloudInput,
  StartCloudEnrollmentAttemptInput,
  UpdateCloudPermissionsInput,
  UpdateCloudSessionDisclosureInput
} from "@deskcue/protocol/cloud";
import type { DaemonEventBus } from "#application/ports";
import { daemonConfig } from "#config/daemonConfig";
import { DESKCUE_VERSION } from "#config/deskCueVersion";
import { logger } from "#infrastructure/logging/logger";
import { SqliteCloudConnectorStore } from "#persistence/cloud/cloudConnectorStore";
import type { CloudConnectorProfile } from "#persistence/cloud/cloudConnectorStore";
import { CloudEnrollmentAttemptRepository } from "#persistence/cloud/cloudEnrollmentAttemptRepository";
import type { SqliteDatabaseContext } from "#persistence/connection/sqliteConnection";

import { CloudRemoteControlExecutor } from "./cloudRemoteControlExecutor.ts";
import { CloudRemoteReadExecutor } from "./cloudRemoteReadExecutor.ts";
import { CloudRemoteRealtimeBridge } from "./cloudRemoteRealtimeBridge.ts";
import { CloudRemoteRequestHandler } from "./cloudRemoteRequestHandler.ts";
import type { RemoteControlExecutor, RemoteReadExecutor } from "./cloudRemoteRequestHandler.ts";
import {
  resolveCloudSessionRoute
} from "./cloudSessionProjection.ts";
import type { CloudProjectionSource } from "./cloudSessionProjection.ts";
import { toCloudErrorCode } from "./connector/cloudConnectorError.ts";
import { CloudConnectorHttpClient } from "./connector/cloudConnectorHttpClient.ts";
import type { CloudConnectionToken } from "./connector/cloudConnectorHttpClient.ts";
import { CloudConnectorOutboxSender } from "./connector/cloudConnectorOutboxSender.ts";
import { CloudConnectorRelayFrameRouter } from "./connector/cloudConnectorRelayFrameRouter.ts";
import { CloudEnrollmentAttemptCoordinator } from "./connector/cloudEnrollmentAttemptCoordinator.ts";
import { CloudEnrollmentCoordinator } from "./connector/cloudEnrollmentCoordinator.ts";
import { CloudProjectionCoordinator } from "./connector/cloudProjectionCoordinator.ts";
import { CloudRelayNegotiation } from "./connector/cloudRelayNegotiation.ts";
import { CloudRelaySocketTransport } from "./connector/cloudRelaySocketTransport.ts";
import { EncryptedFileCloudSecretStore } from "./connector/cloudSecretStore.ts";
import { CloudConnectorPermissions } from "./connector/lifecycle/cloudConnectorPermissions.ts";
import { CloudRelayConnectionLoop } from "./connector/lifecycle/cloudRelayConnectionLoop.ts";
import { CloudConnectorPreviewCoordinator } from "./preview/cloudConnectorPreviewCoordinator.ts";
import {
  CloudPreviewDataPlane,
  deriveCloudPreviewDataUrl
} from "./preview/cloudPreviewDataPlane.ts";
import type { CloudPreviewTargetResolver } from "./preview/cloudPreviewRequestPolicy.ts";

const CLOUD_OUTBOUND_MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

export type CloudConnectorServiceOptions = {
  fetchImplementation?: typeof fetch;
  remoteReadExecutor?: RemoteReadExecutor;
  remoteControlExecutor?: RemoteControlExecutor;
  remoteRealtimeDaemonOrigin?: string;
  cloudMaxBufferedBytes?: number;
  previewTargetResolver?: CloudPreviewTargetResolver;
};

export { deriveCloudPreviewDataUrl };

export class CloudConnectorService {
  private closed = false;
  private started = false;
  private connectionEpoch = 0;
  private connectionLifecycleController = new AbortController();
  private enrollmentPromise: Promise<CloudConnectionStatusResponse> | null = null;
  private permissionsPromise: Promise<CloudConnectionStatusResponse> | null = null;
  private socket: WebSocket | null = null;
  private readonly store: SqliteCloudConnectorStore;
  private readonly enrollment: CloudEnrollmentCoordinator;
  private readonly enrollmentAttempts: CloudEnrollmentAttemptCoordinator;
  private readonly projectionCoordinator: CloudProjectionCoordinator;
  private readonly relayNegotiation = new CloudRelayNegotiation();
  private readonly outboxSender: CloudConnectorOutboxSender;
  private readonly permissions: CloudConnectorPermissions;
  private readonly relayFrameRouter: CloudConnectorRelayFrameRouter;
  private readonly relayConnectionLoop: CloudRelayConnectionLoop;
  private readonly remoteRequestHandler: CloudRemoteRequestHandler<WebSocket>;
  private readonly remoteRealtimeBridge: CloudRemoteRealtimeBridge;
  private readonly previewCoordinator: CloudConnectorPreviewCoordinator;
  private readonly socketTransport: CloudRelaySocketTransport;

  constructor(
    sqliteContext: SqliteDatabaseContext,
    events: DaemonEventBus,
    projections: CloudProjectionSource,
    options: CloudConnectorServiceOptions = {}
  ) {
    const daemonOrigin = `http://127.0.0.1:${daemonConfig.daemonPort}`;

    this.store = new SqliteCloudConnectorStore(sqliteContext);
    const remoteReadExecutor = options.remoteReadExecutor ?? new CloudRemoteReadExecutor({
      daemonOrigin,
      resolveSessionRoute: async (cloudSessionId) => {
        const identity = this.store.readIdentity();

        if (!identity) return null;

        return resolveCloudSessionRoute(identity.installationId, projections, cloudSessionId);
      }
    });
    const remoteControlExecutor = options.remoteControlExecutor ?? new CloudRemoteControlExecutor({
      daemonOrigin
    });
    const cloudMaxBufferedBytes = options.cloudMaxBufferedBytes ?? CLOUD_OUTBOUND_MAX_BUFFERED_BYTES;
    const secrets = new EncryptedFileCloudSecretStore(dirname(sqliteContext.databaseFilePath));
    const httpClient = new CloudConnectorHttpClient(options.fetchImplementation);

    this.enrollment = new CloudEnrollmentCoordinator({
      daemonVersion: DESKCUE_VERSION,
      store: this.store,
      secrets,
      httpClient
    });
    this.enrollmentAttempts = new CloudEnrollmentAttemptCoordinator({
      attempts: new CloudEnrollmentAttemptRepository(sqliteContext.database),
      enrollment: this.enrollment,
      secrets,
      httpClient,
      onConnected: (input) => this.connectApprovedAttempt(input)
    });
    this.socketTransport = new CloudRelaySocketTransport(cloudMaxBufferedBytes);
    const previewDataPlane = new CloudPreviewDataPlane(
      cloudMaxBufferedBytes,
      options.previewTargetResolver ?? null
    );

    this.projectionCoordinator = new CloudProjectionCoordinator({
      events,
      store: this.store,
      projections,
      readConnectionEpoch: () => this.connectionEpoch,
      onProjectionReady: (profile) => this.outboxSender.sendNext(profile),
      onProjectionError: (errorCode) => {
        if (errorCode === "outbox_capacity_reached") {
          if (this.socket) this.socketTransport.close(this.socket, 1013, "Cloud outbox capacity reached");
        }

        logger.warn("DeskCue Cloud projection failed", { errorCode });
      }
    });
    this.remoteRequestHandler = new CloudRemoteRequestHandler({
      store: this.store,
      readExecutor: remoteReadExecutor,
      controlExecutor: remoteControlExecutor,
      sendCloudFrame: (connection, frame) => this.sendCloudFrame(frame, connection),
      closeConnection: (connection, code, reason) => {
        this.socketTransport.close(connection, code, reason);
      },
      isCurrentConnection: (connection, profileId) =>
        this.socket === connection && this.store.readActiveProfile()?.id === profileId
    });
    this.remoteRealtimeBridge = new CloudRemoteRealtimeBridge({
      daemonOrigin: options.remoteRealtimeDaemonOrigin ?? daemonOrigin,
      sendCloudFrame: (frame) => this.sendCloudFrame(frame)
    });
    this.outboxSender = new CloudConnectorOutboxSender({
      store: this.store,
      projectionCoordinator: this.projectionCoordinator,
      socketTransport: this.socketTransport,
      readSocket: () => this.socket,
      onRelayEventFailure: (...args) => this.handleRelayEventFailure(...args)
    });
    this.previewCoordinator = new CloudConnectorPreviewCoordinator({
      dataPlane: previewDataPlane,
      enrollment: this.enrollment,
      socketTransport: this.socketTransport,
      store: this.store,
      readSocket: () => this.socket,
      readConnectionEpoch: () => this.connectionEpoch,
      readLifecycleSignal: () => this.connectionLifecycleController.signal,
      isClosed: () => this.closed,
      isRemotePreviewNegotiated: () => this.relayNegotiation.remotePreview,
      toErrorCode: (error) => toCloudErrorCode(error)
    });
    this.relayConnectionLoop = new CloudRelayConnectionLoop({
      attachSocket: (profile, connection, connectionEpoch) => this.attachSocket(profile, connection, connectionEpoch),
      enrollment: this.enrollment,
      getConnectionEpoch: () => this.connectionEpoch,
      isClosed: () => this.closed,
      readLifecycleSignal: () => this.connectionLifecycleController.signal,
      store: this.store,
      toErrorCode: (error) => toCloudErrorCode(error)
    });
    this.relayFrameRouter = new CloudConnectorRelayFrameRouter({
      store: this.store,
      relayNegotiation: this.relayNegotiation,
      remoteRequestHandler: this.remoteRequestHandler,
      remoteRealtimeBridge: this.remoteRealtimeBridge,
      outboxSender: this.outboxSender,
      socketTransport: this.socketTransport,
      readSocket: () => this.socket,
      onWelcome: (profile) => {
        this.relayConnectionLoop.resetAttempts();
        this.outboxSender.projectAndSend(profile, this.connectionEpoch);
        if (profile.remotePreviewEnabled && this.relayNegotiation.remotePreview) {
          this.previewCoordinator.start(profile, this.connectionEpoch);
        }
      }
    });
    this.permissions = new CloudConnectorPermissions({
      enrollment: this.enrollment,
      store: this.store,
      advanceConnectionEpoch: () => this.advanceConnectionEpoch(),
      clearReconnectTimer: () => this.relayConnectionLoop.clear(),
      disconnectSocket: () => this.disconnectSocket(),
      getConnectPromise: () => this.relayConnectionLoop.pending,
      getConnectionEpoch: () => this.connectionEpoch,
      getStatus: () => this.getStatus(),
      isClosed: () => this.closed,
      readLifecycleSignal: () => this.connectionLifecycleController.signal,
      scheduleConnect: (delayMs) => this.relayConnectionLoop.schedule(delayMs),
      toErrorCode: (error) => toCloudErrorCode(error)
    });
  }

  configurePreviewTargetResolver(
    resolver: CloudPreviewTargetResolver
  ) {
    if (this.started) throw new Error("cloud_preview_resolver_must_be_configured_before_start");

    this.previewCoordinator.configureTargetResolver(resolver);
  }

  start() {
    if (this.started || this.closed) return;

    this.started = true;
    this.projectionCoordinator.start();
    this.enrollmentAttempts.start();
    if (this.store.readActiveProfile()) this.relayConnectionLoop.schedule(0);
  }

  getStatus(): CloudConnectionStatusResponse {
    return this.enrollment.getStatus(this.socketTransport.isOpen(this.socket));
  }

  connect(input: ConnectCloudInput): Promise<CloudConnectionStatusResponse> {
    if (this.closed) return Promise.reject(new Error("cloud_connector_closed"));

    this.enrollmentAttempts.cancel();
    if (this.enrollmentPromise) return this.enrollmentPromise;

    this.enrollmentPromise = this.enroll(input).finally(() => {
      this.enrollmentPromise = null;
    });
    return this.enrollmentPromise;
  }

  async disconnect(): Promise<CloudConnectionStatusResponse> {
    this.advanceConnectionEpoch();
    this.relayConnectionLoop.clear();
    this.disconnectSocket();
    this.previewCoordinator.reset();
    this.enrollment.disconnect();
    this.enrollmentAttempts.cancel();
    return this.getStatus();
  }

  async updateSessionLabelDisclosure(
    input: UpdateCloudSessionDisclosureInput
  ): Promise<CloudConnectionStatusResponse> {
    const profile = this.store.readActiveProfile();

    if (!profile) throw new Error("cloud_connector_not_connected");

    this.store.updateSessionLabelDisclosure(profile.id, input.enabled);
    await this.projectionCoordinator.projectNow();
    return this.getStatus();
  }

  updatePermissions(
    input: UpdateCloudPermissionsInput
  ): Promise<CloudConnectionStatusResponse> {
    if (this.closed) return Promise.reject(new Error("cloud_connector_closed"));
    if (this.permissionsPromise) return Promise.reject(new Error("cloud_permissions_update_in_progress"));

    this.permissionsPromise = this.permissions.apply(input).finally(() => {
      this.permissionsPromise = null;
    });
    return this.permissionsPromise;
  }

  createEnrollmentAttempt(
    input: StartCloudEnrollmentAttemptInput
  ): Promise<CloudEnrollmentAttemptResponse> {
    return this.enrollmentAttempts.create(input);
  }

  getEnrollmentAttempt(): CloudEnrollmentAttemptResponse {
    return this.enrollmentAttempts.read();
  }

  cancelEnrollmentAttempt(): CloudEnrollmentAttemptResponse {
    return this.enrollmentAttempts.cancel();
  }

  async close() {
    if (this.closed) return;

    this.closed = true;
    this.advanceConnectionEpoch();
    this.relayConnectionLoop.clear();
    this.disconnectSocket();
    const pending: Promise<unknown>[] = [
      this.remoteRequestHandler.close(),
      this.projectionCoordinator.close(),
      this.previewCoordinator.close(),
      this.enrollmentAttempts.close()
    ];

    if (this.relayConnectionLoop.pending) pending.push(this.relayConnectionLoop.pending);
    if (this.enrollmentPromise) pending.push(this.enrollmentPromise);
    if (this.permissionsPromise) pending.push(this.permissionsPromise);
    await Promise.allSettled(pending);
  }

  private async enroll(input: ConnectCloudInput): Promise<CloudConnectionStatusResponse> {
    const enrollmentEpoch = this.advanceConnectionEpoch();
    const lifecycleSignal = this.connectionLifecycleController.signal;

    this.relayConnectionLoop.clear();

    this.disconnectSocket();
    await this.enrollment.enroll(input, {
      signal: lifecycleSignal,
      isCurrent: () => !this.closed && this.connectionEpoch === enrollmentEpoch
    });

    await this.projectionCoordinator.projectNow();
    this.relayConnectionLoop.schedule(0);
    return this.getStatus();
  }

  private async connectApprovedAttempt(input: StartCloudEnrollmentAttemptInput & {
    machineId: string;
    machineCredential: string;
  }) {
    if (this.closed) throw new Error("cloud_connector_closed");

    this.advanceConnectionEpoch();
    this.relayConnectionLoop.clear();
    this.disconnectSocket();
    this.enrollment.completeAttempt(input);
    await this.projectionCoordinator.projectNow();
    this.relayConnectionLoop.schedule(0);
  }

  private attachSocket(
    profile: CloudConnectorProfile,
    connection: CloudConnectionToken,
    connectionEpoch: number
  ) {
    let sessionSocket: WebSocket | null = null;

    this.relayNegotiation.prepareForRelay();
    const session = this.socketTransport.open({
      connection,
      isCurrent: () =>
        !this.closed &&
        this.connectionEpoch === connectionEpoch &&
        this.socket === sessionSocket,
      createHello: () => ({
        type: "relay.hello",
        protocolVersion: CLOUD_RELAY_PROTOCOL_VERSION,
        machineId: profile.machineId!,
        daemonVersion: DESKCUE_VERSION,
        capabilities: this.relayNegotiation.offeredCapabilities(profile),
        resume: [{
          stream: CLOUD_RELAY_STREAM,
          ackedSequence: this.store.readLastAckedSequence(profile.id)
        }],
        sentAt: new Date().toISOString()
      }),
      onFrame: (frame) => this.relayFrameRouter.handle(profile, frame),
      onEventFailure: (failure) => this.handleRelayEventFailure(
        profile,
        failure.socket,
        connectionEpoch,
        failure.errorCode,
        failure.closeCode,
        failure.closeReason
      ),
      onClose: (socket, code, reasonCode) => {
        this.handleRelayClose(profile, socket, connectionEpoch, code, reasonCode);
      }
    });

    sessionSocket = session.socket;
    this.socket = session.socket;
    return session.opened;
  }

  private handleRelayEventFailure(
    profile: CloudConnectorProfile,
    socket: WebSocket,
    connectionEpoch: number,
    errorCode: string,
    closeCode: number,
    closeReason: string
  ) {
    if (!this.closed && this.connectionEpoch === connectionEpoch) {
      try {
        if (this.store.readActiveProfile()?.id === profile.id) {
          this.store.updateState(profile.id, "degraded", { errorCode });
        }
      } catch {
        logger.warn("DeskCue Cloud relay event recovery failed", {
          errorCode: "cloud_connector_state_unavailable"
        });
      }
    }

    this.socketTransport.close(socket, closeCode, closeReason);
  }

  private handleRelayClose(
    profile: CloudConnectorProfile,
    socket: WebSocket,
    connectionEpoch: number,
    code: number,
    reasonCode: string
  ) {
    try {
      if (code !== 1000) {
        logger.warn("DeskCue Cloud relay closed", {
          code,
          reasonCode
        });
      }

      if (this.socket !== socket) return;

      this.socket = null;
      this.previewCoordinator.disconnect();
      this.outboxSender.reset();
      this.relayNegotiation.reset();
      this.remoteRequestHandler.clearPending();
      this.remoteRealtimeBridge.closeAll();
      if (this.closed || this.connectionEpoch !== connectionEpoch) return;

      const current = this.store.readActiveProfile();

      if (current?.id !== profile.id || current.state === "revoked") return;

      this.store.updateState(profile.id, "degraded", {
        errorCode: current.lastErrorCode ?? "relay_disconnected"
      });

      this.relayConnectionLoop.scheduleReconnect();
    } catch {
      logger.warn("DeskCue Cloud relay close recovery failed", {
        errorCode: "cloud_connector_state_unavailable"
      });
    }
  }

  private sendCloudFrame(
    frame: CloudRelayClientFrame,
    expectedSocket: WebSocket | null = this.socket
  ) {
    const socket = expectedSocket;

    return Boolean(
      socket &&
      this.socket === socket &&
      this.socketTransport.sendJson(socket, frame)
    );
  }

  private disconnectSocket() {
    this.previewCoordinator.disconnect();
    const socket = this.socket;

    this.socket = null;

    this.outboxSender.reset();
    this.relayNegotiation.reset();
    this.remoteRequestHandler.clearPending();
    this.remoteRealtimeBridge.closeAll();
    if (socket) this.socketTransport.close(socket, 1000, "DeskCue Cloud connector stopped");
  }

  private advanceConnectionEpoch() {
    this.connectionLifecycleController.abort();
    this.connectionLifecycleController = new AbortController();
    this.connectionEpoch += 1;
    return this.connectionEpoch;
  }
}
