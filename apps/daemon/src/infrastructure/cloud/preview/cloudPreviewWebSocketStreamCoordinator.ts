import { createHash, randomUUID } from "node:crypto";

import {
  CLOUD_PREVIEW_CHUNK_BYTES,
  CLOUD_PREVIEW_MAX_CREDIT_BYTES,
  CLOUD_PREVIEW_MAX_WS_STREAMS,
  CLOUD_PREVIEW_PROTOCOL_VERSION,
  CLOUD_PREVIEW_WS_MAX_MESSAGE_BYTES
} from "@deskcue/protocol/cloud";
import type {
  CloudPreviewClientFrame,
  CloudPreviewHeader,
  CloudPreviewServerFrame
} from "@deskcue/protocol/cloud";

import { CloudPreviewRequestPolicy } from "./cloudPreviewRequestPolicy.ts";
import type { AuthorizedCloudPreviewRequest } from "./cloudPreviewRequestPolicy.ts";

const INITIAL_CREDIT_BYTES = 64 * 1024;
const MAX_PENDING_WS_MESSAGES = 4;
const MAX_STREAM_LIFETIME_MS = 30_000;

export type CloudPreviewWebSocketSession = {
  close(code: number, reason: string): void;
  headers: CloudPreviewHeader[];
  protocol: string | null;
  send(body: Buffer, binary: boolean): void;
};

export type CloudPreviewWebSocketEvents = {
  onClose(code: number, reason: string): void;
  onMessage(body: Buffer, binary: boolean): void;
};

type CloudPreviewWebSocketStreamCoordinatorOptions = {
  isActiveEpoch(epoch: number): boolean;
  openWebSocket?: (
    request: AuthorizedCloudPreviewRequest & { protocols: string[]; signal: AbortSignal },
    events: CloudPreviewWebSocketEvents
  ) => Promise<CloudPreviewWebSocketSession>;
  policy: CloudPreviewRequestPolicy;
  sendFrame(frame: CloudPreviewClientFrame): boolean;
};

type IncomingWsMessage = {
  binary: boolean;
  bodyBytes: number;
  bodySha256: string;
  chunkCount: number;
  chunks: Buffer[];
  nextSequence: number;
};

type OutgoingWsMessage = {
  binary: boolean;
  body: Buffer;
  messageId: string;
  offset: number;
  sequence: number;
  started: boolean;
};

type WebSocketStream = {
  controller: AbortController;
  deadline: NodeJS.Timeout;
  epoch: number;
  incomingCredit: number;
  incomingMessages: Map<string, IncomingWsMessage>;
  outgoingCredit: number;
  outgoingMessages: OutgoingWsMessage[];
  session: CloudPreviewWebSocketSession | null;
};

function now() {
  return new Date().toISOString();
}

export class CloudPreviewWebSocketStreamCoordinator {
  private readonly streams = new Map<string, WebSocketStream>();
  private readonly opening = new Set<string>();

  constructor(private readonly options: CloudPreviewWebSocketStreamCoordinatorOptions) {}

  async open(
    frame: Extract<CloudPreviewServerFrame, { type: "preview.ws.open" }>,
    epoch: number
  ) {
    if (!this.options.openWebSocket ||
        this.streams.size + this.opening.size >= CLOUD_PREVIEW_MAX_WS_STREAMS ||
        this.streams.has(frame.streamId) || this.opening.has(frame.streamId)) {
      return this.sendClose(frame.streamId, 1013, "preview_unavailable");
    }
    this.opening.add(frame.streamId);
    try {
      const request = await this.options.policy.authorize({
        headers: frame.headers,
        method: "GET",
        owner: { id: frame.owner.ownerId, kind: frame.owner.kind },
        pathAndQuery: frame.path,
        transport: "websocket",
        viewerId: frame.viewerId
      });
      if (!this.options.isActiveEpoch(epoch)) return false;
      const controller = new AbortController();
      const deadline = this.createDeadline(frame.streamId, frame.deadlineAt);
      const stream: WebSocketStream = {
        controller,
        deadline,
        epoch,
        incomingCredit: INITIAL_CREDIT_BYTES,
        incomingMessages: new Map(),
        outgoingCredit: 0,
        outgoingMessages: [],
        session: null
      };
      this.streams.set(frame.streamId, stream);
      const session = await this.options.openWebSocket({
        ...request,
        protocols: frame.protocols,
        signal: controller.signal
      }, {
        onClose: (code, reason) => this.close(frame.streamId, code, reason, true),
        onMessage: (body, binary) => this.queueServerMessage(frame.streamId, body, binary)
      });
      if (this.streams.get(frame.streamId) !== stream ||
          !this.options.isActiveEpoch(stream.epoch)) {
        session.close(1000, "stale_preview_stream");
        return false;
      }
      stream.session = session;
      clearTimeout(stream.deadline);
      if (!this.options.sendFrame({
        type: "preview.ws.opened",
        protocolVersion: CLOUD_PREVIEW_PROTOCOL_VERSION,
        streamId: frame.streamId,
        protocol: session.protocol,
        headers: session.headers,
        openedAt: now()
      })) return this.close(frame.streamId, 1013, "transport_failed", false);
      return this.sendCredit(frame.streamId, INITIAL_CREDIT_BYTES);
    } catch {
      return this.close(frame.streamId, 1013, "preview_unavailable", true);
    } finally {
      this.opening.delete(frame.streamId);
    }
  }

  startMessage(
    frame: Extract<CloudPreviewServerFrame, { type: "preview.ws.message.start" }>
  ) {
    const stream = this.streams.get(frame.streamId);
    if (!stream?.session || stream.incomingMessages.size >= MAX_PENDING_WS_MESSAGES ||
        stream.incomingMessages.has(frame.messageId)) return false;
    stream.incomingMessages.set(frame.messageId, {
      binary: frame.binary,
      bodyBytes: frame.bodyBytes,
      bodySha256: frame.bodySha256,
      chunkCount: frame.chunkCount,
      chunks: [],
      nextSequence: 0
    });
    return true;
  }

  acceptChunk(
    frame: Extract<CloudPreviewServerFrame, { type: "preview.ws.message.chunk" }>
  ) {
    const stream = this.streams.get(frame.streamId);
    const message = stream?.incomingMessages.get(frame.messageId);
    if (!stream || !message) return false;
    const chunk = Buffer.from(frame.data, "base64");
    const received = message.chunks.reduce((total, item) => total + item.byteLength, 0);
    if (frame.sequence !== message.nextSequence || chunk.byteLength > stream.incomingCredit ||
        received + chunk.byteLength > message.bodyBytes) {
      return this.close(frame.streamId, 1008, "invalid_preview_message", true);
    }
    message.chunks.push(chunk);
    message.nextSequence += 1;
    stream.incomingCredit -= chunk.byteLength;
    stream.incomingCredit += chunk.byteLength;
    return this.sendCredit(frame.streamId, chunk.byteLength);
  }

  finishMessage(
    frame: Extract<CloudPreviewServerFrame, { type: "preview.ws.message.end" }>
  ) {
    const stream = this.streams.get(frame.streamId);
    const message = stream?.incomingMessages.get(frame.messageId);
    if (!stream?.session || !message) return false;
    stream.incomingMessages.delete(frame.messageId);
    const body = Buffer.concat(message.chunks);
    if (message.nextSequence !== message.chunkCount || body.byteLength !== message.bodyBytes ||
        frame.bodySha256 !== message.bodySha256 ||
        createHash("sha256").update(body).digest("hex") !== message.bodySha256) {
      return this.close(frame.streamId, 1008, "invalid_preview_message", true);
    }
    stream.session.send(body, message.binary);
    return true;
  }

  addServerCredit(streamId: string, creditBytes: number) {
    const stream = this.streams.get(streamId);
    if (!stream || stream.outgoingCredit + creditBytes > CLOUD_PREVIEW_MAX_CREDIT_BYTES) {
      return stream ? this.close(streamId, 1008, "invalid_preview_credit", true) : false;
    }
    stream.outgoingCredit += creditBytes;
    return this.pumpServerMessages(streamId, stream);
  }

  close(streamId: string, code: number, reason: string, notifyCloud: boolean) {
    const stream = this.streams.get(streamId);
    if (!stream) return notifyCloud ? this.sendClose(streamId, code, reason) : false;
    this.streams.delete(streamId);
    clearTimeout(stream.deadline);
    stream.controller.abort();
    if (!notifyCloud) stream.session?.close(code, reason);
    return notifyCloud ? this.sendClose(streamId, code, reason) : true;
  }

  abortAll(reason: string) {
    for (const streamId of [...this.streams.keys()]) {
      this.close(streamId, 1013, reason, false);
    }
  }

  private queueServerMessage(streamId: string, body: Buffer, binary: boolean) {
    const stream = this.streams.get(streamId);
    if (!stream) return;
    if (body.byteLength > CLOUD_PREVIEW_WS_MAX_MESSAGE_BYTES ||
        stream.outgoingMessages.length >= MAX_PENDING_WS_MESSAGES) {
      this.close(streamId, 1009, "preview_message_capacity", false);
      return;
    }
    stream.outgoingMessages.push({
      binary,
      body: Buffer.from(body),
      messageId: `preview_message_${randomUUID()}`,
      offset: 0,
      sequence: 0,
      started: false
    });
    this.pumpServerMessages(streamId, stream);
  }

  private pumpServerMessages(streamId: string, stream: WebSocketStream) {
    while (stream.outgoingMessages.length > 0) {
      const message = stream.outgoingMessages[0];
      if (!message.started) {
        if (stream.outgoingCredit < message.body.byteLength) return true;
        message.started = true;
        if (!this.options.sendFrame({
          type: "preview.ws.message.start",
          protocolVersion: CLOUD_PREVIEW_PROTOCOL_VERSION,
          streamId,
          direction: "server",
          messageId: message.messageId,
          binary: message.binary,
          bodyBytes: message.body.byteLength,
          chunkCount: Math.ceil(message.body.byteLength / CLOUD_PREVIEW_CHUNK_BYTES),
          bodySha256: createHash("sha256").update(message.body).digest("hex"),
          sentAt: now()
        })) return false;
      }
      while (message.offset < message.body.byteLength) {
        const bytes = Math.min(CLOUD_PREVIEW_CHUNK_BYTES, message.body.byteLength - message.offset);
        if (stream.outgoingCredit < bytes) return true;
        const chunk = message.body.subarray(message.offset, message.offset + bytes);
        if (!this.options.sendFrame({
          type: "preview.ws.message.chunk",
          protocolVersion: CLOUD_PREVIEW_PROTOCOL_VERSION,
          streamId,
          direction: "server",
          messageId: message.messageId,
          sequence: message.sequence,
          data: chunk.toString("base64")
        })) return false;
        message.offset += bytes;
        message.sequence += 1;
        stream.outgoingCredit -= bytes;
      }
      if (message.offset !== message.body.byteLength) return true;
      const digest = createHash("sha256").update(message.body).digest("hex");
      if (!this.options.sendFrame({
        type: "preview.ws.message.end",
        protocolVersion: CLOUD_PREVIEW_PROTOCOL_VERSION,
        streamId,
        direction: "server",
        messageId: message.messageId,
        bodySha256: digest,
        sentAt: now()
      })) return false;
      stream.outgoingMessages.shift();
    }
    return true;
  }

  private sendCredit(streamId: string, creditBytes: number) {
    return this.options.sendFrame({
      type: "preview.flow.credit",
      protocolVersion: CLOUD_PREVIEW_PROTOCOL_VERSION,
      streamId,
      direction: "ws.client",
      creditBytes,
      sentAt: now()
    });
  }

  private sendClose(streamId: string, code: number, reason: string) {
    return this.options.sendFrame({
      type: "preview.ws.close",
      protocolVersion: CLOUD_PREVIEW_PROTOCOL_VERSION,
      streamId,
      source: "server",
      code,
      reason: Buffer.from(reason).subarray(0, 123).toString(),
      sentAt: now()
    });
  }

  private createDeadline(streamId: string, deadlineAt: string) {
    const timeout = setTimeout(() => {
      this.close(streamId, 1013, "deadline_exceeded", true);
    }, Math.min(MAX_STREAM_LIFETIME_MS, Math.max(0, Date.parse(deadlineAt) - Date.now())));
    timeout.unref?.();
    return timeout;
  }
}
