import { createHash, randomUUID } from "node:crypto";
import WebSocket from "ws";

import {
  CLOUD_RELAY_PROTOCOL_VERSION,
  REMOTE_REALTIME_CHUNK_BYTES,
  REMOTE_REALTIME_MAX_CLIENT_MESSAGE_BYTES,
  REMOTE_REALTIME_MAX_SERVER_MESSAGE_BYTES,
  parseRemoteRealtimePath
} from "@deskcue/protocol/cloud";
import type { CloudRelayClientFrame, RemoteRealtimeServerFrame } from "@deskcue/protocol/cloud";
import { createCloudProcessLocalAuthorization } from "#security/cloudProcessLocalCredential";

const CLOUD_HTTP_TIMEOUT_MS = 10_000;
const CLOUD_REMOTE_REALTIME_MAX_STREAMS = 4;
const CLOUD_REMOTE_REALTIME_MAX_PENDING_MESSAGES = 4;
const CLOUD_REMOTE_REALTIME_MESSAGE_TIMEOUT_MS = 15_000;

type PendingRemoteRealtimeMessage = {
  bodyBytes: number;
  chunkCount: number;
  bodySha256: string;
  chunks: Array<Buffer | undefined>;
  expiryTimer: NodeJS.Timeout;
};

type RemoteRealtimeStream = {
  socket: WebSocket;
  pendingMessages: Map<string, PendingRemoteRealtimeMessage>;
  openTimer: NodeJS.Timeout | null;
};

type CloudRemoteRealtimeBridgeOptions = {
  daemonOrigin: string;
  sendCloudFrame: (frame: CloudRelayClientFrame) => boolean;
};

function splitBuffer(body: Buffer, chunkBytes: number) {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < body.byteLength; offset += chunkBytes) {
    chunks.push(body.subarray(offset, Math.min(body.byteLength, offset + chunkBytes)));
  }
  return chunks;
}

function clearPendingMessages(stream: RemoteRealtimeStream) {
  if (stream.openTimer) clearTimeout(stream.openTimer);
  stream.openTimer = null;
  for (const pending of stream.pendingMessages.values()) {
    clearTimeout(pending.expiryTimer);
  }
  stream.pendingMessages.clear();
}

function normalizeWebSocketCloseCode(code: number) {
  return code >= 1_000 && code <= 4_999 && ![1_004, 1_005, 1_006, 1_015].includes(code)
    ? code
    : 1_000;
}

export class CloudRemoteRealtimeBridge {
  private readonly daemonOrigin: string;
  private readonly sendCloudFrame: (frame: CloudRelayClientFrame) => boolean;
  private readonly streams = new Map<string, RemoteRealtimeStream>();

  constructor({ daemonOrigin, sendCloudFrame }: CloudRemoteRealtimeBridgeOptions) {
    const realtimeOrigin = new URL(daemonOrigin);
    if (realtimeOrigin.protocol !== "http:" || realtimeOrigin.hostname !== "127.0.0.1" ||
        realtimeOrigin.pathname !== "/" || realtimeOrigin.search || realtimeOrigin.hash ||
        realtimeOrigin.username || realtimeOrigin.password) {
      throw new Error("Cloud remote realtime requires a trusted loopback daemon origin.");
    }
    this.daemonOrigin = realtimeOrigin.origin;
    this.sendCloudFrame = sendCloudFrame;
  }

  handleFrame(frame: RemoteRealtimeServerFrame) {
    if (frame.type === "remote.realtime.open") {
      this.openStream(frame);
      return;
    }
    const stream = this.streams.get(frame.streamId);
    if (!stream) return;
    if (frame.type === "remote.realtime.close") {
      this.streams.delete(frame.streamId);
      clearPendingMessages(stream);
      stream.socket.close(normalizeWebSocketCloseCode(frame.code), "cloud_realtime_closed");
      return;
    }
    if (frame.type === "remote.realtime.client.message.start") {
      this.startClientMessage(stream, frame);
      return;
    }
    const pending = stream.pendingMessages.get(frame.messageId);
    if (!pending) return;
    if (frame.type === "remote.realtime.client.message.chunk") {
      if (frame.index >= pending.chunkCount || pending.chunks[frame.index]) {
        clearTimeout(pending.expiryTimer);
        stream.pendingMessages.delete(frame.messageId);
        stream.socket.close(1008, "invalid realtime message chunks");
        return;
      }
      const chunk = Buffer.from(frame.data, "base64");
      if (chunk.byteLength > REMOTE_REALTIME_CHUNK_BYTES) {
        clearTimeout(pending.expiryTimer);
        stream.pendingMessages.delete(frame.messageId);
        stream.socket.close(1009, "realtime chunk too large");
        return;
      }
      pending.chunks[frame.index] = chunk;
      return;
    }
    clearTimeout(pending.expiryTimer);
    stream.pendingMessages.delete(frame.messageId);
    if (frame.bodySha256 !== pending.bodySha256 || pending.chunks.some((chunk) => !chunk)) {
      stream.socket.close(1008, "incomplete realtime message");
      return;
    }
    const body = Buffer.concat(pending.chunks as Buffer[]);
    if (body.byteLength !== pending.bodyBytes ||
        body.byteLength > REMOTE_REALTIME_MAX_CLIENT_MESSAGE_BYTES ||
        createHash("sha256").update(body).digest("hex") !== pending.bodySha256) {
      stream.socket.close(1008, "invalid realtime message digest");
      return;
    }
    try {
      JSON.parse(body.toString("utf8"));
    } catch {
      stream.socket.close(1007, "invalid realtime JSON");
      return;
    }
    if (stream.socket.readyState !== WebSocket.OPEN) {
      stream.socket.close(1011, "local realtime not open");
      return;
    }
    stream.socket.send(body.toString("utf8"));
  }

  closeAll() {
    const streams = [...this.streams.values()];
    this.streams.clear();
    for (const stream of streams) {
      clearPendingMessages(stream);
      if (stream.socket.readyState !== WebSocket.CLOSED) {
        stream.socket.close(1000, "Cloud connector stopped");
      }
    }
  }

  private openStream(frame: Extract<RemoteRealtimeServerFrame, { type: "remote.realtime.open" }>) {
    if (this.streams.size >= CLOUD_REMOTE_REALTIME_MAX_STREAMS ||
        this.streams.has(frame.streamId) ||
        Date.parse(frame.deadlineAt) <= Date.now()) {
      this.sendClosed(frame.streamId, 1008, "realtime_open_rejected");
      return;
    }
    let path: string;
    try {
      path = parseRemoteRealtimePath(frame.path);
    } catch {
      this.sendClosed(frame.streamId, 1008, "realtime_path_rejected");
      return;
    }
    const localSocket = new WebSocket(
      `${this.daemonOrigin.replace(/^http:/, "ws:")}${path}`,
      {
        headers: { authorization: createCloudProcessLocalAuthorization() },
        handshakeTimeout: CLOUD_HTTP_TIMEOUT_MS,
        maxPayload: REMOTE_REALTIME_MAX_SERVER_MESSAGE_BYTES,
        perMessageDeflate: false
      }
    );
    const stream: RemoteRealtimeStream = {
      socket: localSocket,
      pendingMessages: new Map(),
      openTimer: null
    };
    this.streams.set(frame.streamId, stream);
    const openTimeoutMs = Math.min(
      CLOUD_HTTP_TIMEOUT_MS,
      Math.max(0, Date.parse(frame.deadlineAt) - Date.now())
    );
    stream.openTimer = setTimeout(() => {
      if (this.streams.get(frame.streamId) !== stream ||
          localSocket.readyState === WebSocket.OPEN) return;
      localSocket.close(1008, "realtime open deadline exceeded");
    }, openTimeoutMs);
    stream.openTimer.unref?.();
    localSocket.once("open", () => {
      if (stream.openTimer) clearTimeout(stream.openTimer);
      stream.openTimer = null;
      if (this.streams.get(frame.streamId) !== stream) {
        localSocket.close(1000, "stale realtime stream");
        return;
      }
      this.sendCloudFrame({
        type: "remote.realtime.opened",
        protocolVersion: CLOUD_RELAY_PROTOCOL_VERSION,
        streamId: frame.streamId,
        openedAt: new Date().toISOString()
      });
    });
    localSocket.on("message", (data, isBinary) => {
      if (isBinary) {
        localSocket.close(1003, "binary realtime messages are not supported");
        return;
      }
      const body = Buffer.isBuffer(data) ? data : Buffer.from(data.toString(), "utf8");
      if (body.byteLength > REMOTE_REALTIME_MAX_SERVER_MESSAGE_BYTES) {
        localSocket.close(1009, "realtime message too large");
        return;
      }
      this.sendServerMessage(frame.streamId, body);
    });
    localSocket.once("error", () => {
      if (localSocket.readyState !== WebSocket.CLOSED) {
        localSocket.close(1011, "local realtime unavailable");
      }
    });
    localSocket.once("close", (code) => {
      if (stream.openTimer) clearTimeout(stream.openTimer);
      stream.openTimer = null;
      if (this.streams.get(frame.streamId) !== stream) return;
      this.streams.delete(frame.streamId);
      clearPendingMessages(stream);
      this.sendClosed(frame.streamId, normalizeWebSocketCloseCode(code), "local_realtime_closed");
    });
  }

  private startClientMessage(
    stream: RemoteRealtimeStream,
    frame: Extract<RemoteRealtimeServerFrame, { type: "remote.realtime.client.message.start" }>
  ) {
    if (stream.pendingMessages.size >= CLOUD_REMOTE_REALTIME_MAX_PENDING_MESSAGES ||
        stream.pendingMessages.has(frame.messageId)) {
      stream.socket.close(1008, "realtime message capacity exceeded");
      return;
    }
    const expiryTimer = setTimeout(() => {
      if (!stream.pendingMessages.delete(frame.messageId)) return;
      stream.socket.close(1008, "realtime message expired");
    }, CLOUD_REMOTE_REALTIME_MESSAGE_TIMEOUT_MS);
    expiryTimer.unref?.();
    stream.pendingMessages.set(frame.messageId, {
      bodyBytes: frame.bodyBytes,
      chunkCount: frame.chunkCount,
      bodySha256: frame.bodySha256,
      chunks: new Array<Buffer | undefined>(frame.chunkCount),
      expiryTimer
    });
  }

  private sendServerMessage(streamId: string, body: Buffer) {
    const messageId = `rtm_${randomUUID()}`;
    const bodySha256 = createHash("sha256").update(body).digest("hex");
    const chunks = splitBuffer(body, REMOTE_REALTIME_CHUNK_BYTES);
    if (!this.sendCloudFrame({
      type: "remote.realtime.server.message.start",
      protocolVersion: CLOUD_RELAY_PROTOCOL_VERSION,
      streamId,
      messageId,
      bodyBytes: body.byteLength,
      chunkCount: chunks.length,
      bodySha256,
      sentAt: new Date().toISOString()
    })) return;
    for (const [index, chunk] of chunks.entries()) {
      if (!this.sendCloudFrame({
        type: "remote.realtime.server.message.chunk",
        protocolVersion: CLOUD_RELAY_PROTOCOL_VERSION,
        streamId,
        messageId,
        index,
        data: chunk.toString("base64")
      })) return;
    }
    this.sendCloudFrame({
      type: "remote.realtime.server.message.end",
      protocolVersion: CLOUD_RELAY_PROTOCOL_VERSION,
      streamId,
      messageId,
      bodySha256,
      sentAt: new Date().toISOString()
    });
  }

  private sendClosed(streamId: string, code: number, reason: string) {
    this.sendCloudFrame({
      type: "remote.realtime.closed",
      protocolVersion: CLOUD_RELAY_PROTOCOL_VERSION,
      streamId,
      code,
      reason,
      closedAt: new Date().toISOString()
    });
  }
}
