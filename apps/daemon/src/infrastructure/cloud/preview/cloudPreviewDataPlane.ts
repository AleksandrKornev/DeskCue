import WebSocket from "ws";

import { logger } from "#infrastructure/logging/logger";

import { CloudPreviewDataSocketTransport } from "./cloudPreviewDataSocketTransport.ts";
import { CloudPreviewProxyTransport } from "./cloudPreviewLoopbackTransport.ts";
import { CloudPreviewRequestPolicy } from "./cloudPreviewRequestPolicy.ts";
import type { CloudPreviewTargetResolver } from "./cloudPreviewRequestPolicy.ts";
import { CloudPreviewStreamBridge } from "./cloudPreviewStreamBridge.ts";
import type { CloudConnectionToken } from "../connector/cloudConnectorHttpClient.ts";

export type CloudPreviewDataPlaneOpenOptions = {
  connection: CloudConnectionToken;
  isCurrent: () => boolean;
  onConnectionClosed: () => void;
};

export function deriveCloudPreviewDataUrl(relayUrl: string) {
  const url = new URL(relayUrl);
  if ((url.protocol !== "ws:" && url.protocol !== "wss:") ||
      url.username || url.password || url.search || url.hash ||
      !/^\/relay\/machines\/[A-Za-z0-9_-]+$/.test(url.pathname)) {
    throw new Error("connection_invalid_relay_url");
  }
  url.pathname = `${url.pathname}/preview`;
  return url.toString();
}

/** Owns the dedicated Preview socket, stream bridge, and loopback proxy lifecycle. */
export class CloudPreviewDataPlane {
  private bridge: CloudPreviewStreamBridge | null = null;
  private epoch = 0;
  private socket: WebSocket | null = null;
  private targetResolver: CloudPreviewTargetResolver | null;
  private readonly proxyTransport = new CloudPreviewProxyTransport();
  private readonly socketTransport: CloudPreviewDataSocketTransport;

  constructor(
    maxBufferedBytes: number,
    targetResolver: CloudPreviewTargetResolver | null
  ) {
    this.socketTransport = new CloudPreviewDataSocketTransport(maxBufferedBytes);
    this.targetResolver = targetResolver;
  }

  isConfigured() {
    return Boolean(this.targetResolver);
  }

  configureTargetResolver(resolver: CloudPreviewTargetResolver) {
    this.targetResolver = resolver;
  }

  async open(options: CloudPreviewDataPlaneOpenOptions) {
    const resolver = this.targetResolver;
    if (!resolver || !options.isCurrent()) return;
    const previewUrl = deriveCloudPreviewDataUrl(options.connection.relayUrl);
    const previewEpoch = ++this.epoch;
    let sessionSocket: WebSocket | null = null;
    const bridge = new CloudPreviewStreamBridge({
      executeHttp: (request) => this.proxyTransport.executeHttp(request),
      openWebSocket: (request, events) => this.proxyTransport.openWebSocket(request, events),
      policy: new CloudPreviewRequestPolicy(resolver),
      sendFrame: (frame) => Boolean(
        sessionSocket &&
        this.socket === sessionSocket &&
        options.isCurrent() &&
        this.socketTransport.send(sessionSocket, frame)
      )
    });
    bridge.activateEpoch(previewEpoch);
    const session = this.socketTransport.open({
      connectionToken: options.connection.connectionToken,
      previewUrl,
      isCurrent: () => Boolean(
        sessionSocket &&
        this.socket === sessionSocket &&
        this.bridge === bridge &&
        options.isCurrent()
      ),
      onFrame: (frame, socket) => {
        if (socket !== this.socket || !options.isCurrent()) return;
        void bridge.handleFrame(frame, previewEpoch).catch(() => {
          this.socketTransport.close(socket, 1011, "preview bridge failed");
        });
      },
      onFailure: (_socket, errorCode) => {
        logger.warn("DeskCue Cloud Preview transport rejected a frame", { errorCode });
      },
      onClose: (socket, code, reasonCode) => {
        if (socket !== this.socket) return;
        this.socket = null;
        if (this.bridge === bridge) this.bridge = null;
        bridge.close();
        if (code !== 1000) {
          logger.warn("DeskCue Cloud Preview data connection closed", { code, reasonCode });
        }
        if (options.isCurrent()) options.onConnectionClosed();
      }
    });
    sessionSocket = session.socket;
    this.socket = session.socket;
    this.bridge = bridge;
    await session.opened;
  }

  disconnect() {
    this.epoch += 1;
    const bridge = this.bridge;
    const socket = this.socket;
    this.bridge = null;
    this.socket = null;
    bridge?.close();
    if (socket) {
      this.socketTransport.close(socket, 1000, "DeskCue Cloud Preview stopped");
    }
  }

  close() {
    this.disconnect();
    this.proxyTransport.close();
  }
}
