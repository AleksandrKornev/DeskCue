import WebSocket from "ws";

import type { RemoteRealtimeServerFrame } from "@deskcue/protocol/cloud";
import { SqliteCloudConnectorStore } from "#persistence/cloud/cloudConnectorStore";
import type { CloudConnectorProfile } from "#persistence/cloud/cloudConnectorStore";

import type { CloudRemoteRealtimeBridge } from "../cloudRemoteRealtimeBridge.ts";
import type { CloudRemoteRequestHandler } from "../cloudRemoteRequestHandler.ts";
import type { CloudConnectorOutboxSender } from "./cloudConnectorOutboxSender.ts";
import type { CloudRelayNegotiation } from "./cloudRelayNegotiation.ts";
import type {
  CloudRelayServerFrame,
  CloudRelaySocketTransport
} from "./cloudRelaySocketTransport.ts";

type CloudConnectorRelayFrameRouterOptions = {
  store: SqliteCloudConnectorStore;
  relayNegotiation: CloudRelayNegotiation;
  remoteRequestHandler: CloudRemoteRequestHandler<WebSocket>;
  remoteRealtimeBridge: CloudRemoteRealtimeBridge;
  outboxSender: CloudConnectorOutboxSender;
  socketTransport: CloudRelaySocketTransport;
  readSocket: () => WebSocket | null;
  onWelcome: (profile: CloudConnectorProfile) => void;
};

/** Routes validated relay frames to capability-specific connector components. */
export class CloudConnectorRelayFrameRouter {
  constructor(private readonly options: CloudConnectorRelayFrameRouterOptions) {}

  handle(profile: CloudConnectorProfile, frame: CloudRelayServerFrame) {
    if (
      frame.type === "remote.read.request.start" ||
      frame.type === "remote.read.request.chunk" ||
      frame.type === "remote.read.request.end"
    ) {
      const socket = this.options.readSocket();
      if (socket) {
        this.options.remoteRequestHandler.handleReadFrame(
          {
            connection: socket,
            profile,
            negotiated: this.options.relayNegotiation.remoteRead,
            filesNegotiated: this.options.relayNegotiation.remoteFiles,
            previewNegotiated: this.options.relayNegotiation.remotePreview
          },
          frame
        );
      }
      return;
    }
    if (
      frame.type === "remote.control.request.start" ||
      frame.type === "remote.control.request.chunk" ||
      frame.type === "remote.control.request.end"
    ) {
      const socket = this.options.readSocket();
      if (socket) {
        this.options.remoteRequestHandler.handleControlFrame(
          {
            connection: socket,
            profile,
            negotiated: this.options.relayNegotiation.remoteControl,
            previewNegotiated: this.options.relayNegotiation.remotePreview
          },
          frame
        );
      }
      return;
    }
    if (frame.type.startsWith("remote.realtime.")) {
      this.handleRemoteRealtimeFrame(profile, frame as RemoteRealtimeServerFrame);
      return;
    }
    if (frame.type === "relay.rejected") {
      this.options.store.updateState(profile.id, frame.retryable ? "degraded" : "revoked", {
        errorCode: `relay_${frame.code.toLowerCase()}`
      });
      const socket = this.options.readSocket();
      if (socket) this.options.socketTransport.close(socket, 1008, "relay handshake rejected");
      return;
    }
    if (frame.type === "relay.welcome") {
      const welcome = this.options.relayNegotiation.acceptWelcome(profile, frame);
      this.options.outboxSender.setNextServerSequence(welcome.nextServerSequence);
      this.options.store.reconcileServerPosition(profile.id, welcome.nextServerSequence);
      this.options.store.updateState(profile.id, "connected", {
        connectedAt: welcome.connectedAt,
        errorCode: null,
        negotiated: true
      });
      this.options.onWelcome(profile);
      return;
    }
    if (frame.type !== "relay.ack") throw new Error("Unsupported Cloud relay frame.");
    this.options.outboxSender.handleAck(profile, frame);
  }

  private handleRemoteRealtimeFrame(
    profile: CloudConnectorProfile,
    frame: RemoteRealtimeServerFrame
  ) {
    if (!profile.remoteReadEnabled || !this.options.relayNegotiation.remoteRealtime) {
      const socket = this.options.readSocket();
      if (socket) {
        this.options.socketTransport.close(
          socket,
          1008,
          "remote realtime capability was not negotiated"
        );
      }
      return;
    }
    this.options.remoteRealtimeBridge.handleFrame(frame);
  }
}
