import WebSocket from "ws";

import type { CloudRelayAck, CloudRelayEnvelope } from "@deskcue/protocol/cloud";
import { SqliteCloudConnectorStore } from "#persistence/cloud/cloudConnectorStore";
import type { CloudConnectorProfile } from "#persistence/cloud/cloudConnectorStore";

import type { CloudProjectionCoordinator } from "./cloudProjectionCoordinator.ts";
import type { CloudRelaySocketTransport } from "./cloudRelaySocketTransport.ts";

type CloudConnectorOutboxSenderOptions = {
  store: SqliteCloudConnectorStore;
  projectionCoordinator: CloudProjectionCoordinator;
  socketTransport: CloudRelaySocketTransport;
  readSocket: () => WebSocket | null;
  onRelayEventFailure: (
    profile: CloudConnectorProfile,
    socket: WebSocket,
    connectionEpoch: number,
    errorCode: string,
    closeCode: number,
    closeReason: string
  ) => void;
};

/** Owns durable relay outbox sequencing and its single in-flight envelope. */
export class CloudConnectorOutboxSender {
  private inFlightEnvelope: CloudRelayEnvelope | null = null;
  private nextServerSequence = 1;

  constructor(private readonly options: CloudConnectorOutboxSenderOptions) {}

  reset() {
    this.inFlightEnvelope = null;
  }

  setNextServerSequence(nextServerSequence: number) {
    this.nextServerSequence = nextServerSequence;
  }

  handleAck(profile: CloudConnectorProfile, frame: CloudRelayAck) {
    const inFlight = this.inFlightEnvelope;
    if (
      !inFlight ||
      frame.messageId !== inFlight.messageId ||
      frame.ackedSequence !== inFlight.sequence
    ) {
      throw new Error("Cloud relay acknowledgement does not match the in-flight event.");
    }
    this.inFlightEnvelope = null;
    if (frame.accepted) {
      this.options.store.acknowledge(profile.id, frame.messageId, frame.ackedSequence);
      this.nextServerSequence = frame.ackedSequence + 1;
      this.sendNext(profile);
      return;
    }
    this.options.store.reject(profile.id, frame.messageId, frame.error.code, frame.error.retryable);
    this.options.store.updateState(profile.id, "degraded", {
      errorCode: `relay_ack_${frame.error.code.toLowerCase()}`
    });
    const socket = this.options.readSocket();
    if (socket) this.options.socketTransport.close(socket, 1011, "relay event rejected");
  }

  sendNext(profile: CloudConnectorProfile) {
    const socket = this.options.readSocket();
    if (
      this.inFlightEnvelope ||
      !this.options.socketTransport.isOpen(socket) ||
      this.options.store.readActiveProfile()?.state !== "connected"
    ) return;
    const envelope = this.options.store.readEnvelope(profile.id, this.nextServerSequence);
    if (!envelope) return;
    this.options.socketTransport.sendJson(socket, envelope, {
      beforeSend: () => {
        this.inFlightEnvelope = envelope;
        this.options.store.markAttempt(profile.id, envelope.messageId);
      },
      onFrameTooLarge: () => {
        this.options.store.reject(profile.id, envelope.messageId, "local_frame_too_large", false);
        this.options.store.updateState(profile.id, "degraded", { errorCode: "local_frame_too_large" });
      },
      onSendError: () => {
        if (this.inFlightEnvelope?.messageId === envelope.messageId) this.inFlightEnvelope = null;
      },
      frameTooLargeReason: "relay frame too large",
      sendErrorReason: "relay send failed"
    });
  }

  projectAndSend(profile: CloudConnectorProfile, connectionEpoch: number) {
    const finish = () => {
      try {
        this.sendNext(profile);
      } catch {
        const socket = this.options.readSocket();
        if (socket) {
          this.options.onRelayEventFailure(
            profile,
            socket,
            connectionEpoch,
            "relay_send_failed",
            1011,
            "relay send failed"
          );
        }
      }
    };
    void this.options.projectionCoordinator.projectNow().then(finish, finish);
  }
}
