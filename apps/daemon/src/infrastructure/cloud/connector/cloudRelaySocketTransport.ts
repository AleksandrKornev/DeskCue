import WebSocket from "ws";

import { CLOUD_RELAY_MAX_FRAME_BYTES, parseCloudRelayServerJson } from "@deskcue/protocol/cloud";
import type { CloudRelayHello } from "@deskcue/protocol/cloud";

import { CLOUD_CONNECTOR_HTTP_TIMEOUT_MS } from "./cloudConnectorHttpClient.ts";
import type { CloudConnectionToken } from "./cloudConnectorHttpClient.ts";
import { toSafeCloudRelayCloseReasonCode } from "../cloudRelayLogSafety.ts";

export type CloudRelayServerFrame = ReturnType<typeof parseCloudRelayServerJson>;

type CloudRelayEventFailure = {
  socket: WebSocket;
  errorCode: string;
  closeCode: number;
  closeReason: string;
};

type CloudRelaySocketSessionOptions = {
  connection: CloudConnectionToken;
  isCurrent: () => boolean;
  createHello: () => CloudRelayHello;
  onFrame: (frame: CloudRelayServerFrame, socket: WebSocket) => void;
  onEventFailure: (failure: CloudRelayEventFailure) => void;
  onClose: (socket: WebSocket, code: number, reasonCode: string) => void;
};

type CloudRelaySendHooks = {
  beforeSend?: () => void;
  onFrameTooLarge?: () => void;
  onSendError?: () => void;
  frameTooLargeReason?: string;
  sendErrorReason?: string;
};

export type CloudRelaySocketSession = {
  socket: WebSocket;
  opened: Promise<void>;
};

/** Owns one bounded WebSocket transport session and isolates all emitter callbacks. */
export class CloudRelaySocketTransport {
  constructor(private readonly maxBufferedBytes: number) {
    if (!Number.isSafeInteger(maxBufferedBytes) || maxBufferedBytes < 1) {
      throw new Error("Cloud outbound buffered byte limit is invalid.");
    }
  }

  open(options: CloudRelaySocketSessionOptions): CloudRelaySocketSession {
    const socket = new WebSocket(options.connection.relayUrl, {
      headers: { Authorization: `Bearer ${options.connection.connectionToken}` },
      maxPayload: CLOUD_RELAY_MAX_FRAME_BYTES,
      perMessageDeflate: false,
      handshakeTimeout: CLOUD_CONNECTOR_HTTP_TIMEOUT_MS
    });
    let settleOpen!: () => void;
    const opened = new Promise<void>((resolve) => {
      settleOpen = resolve;
    });
    let settled = false;
    let welcomeTimer: NodeJS.Timeout | null = null;
    const finishOpen = () => {
      if (settled) return;
      settled = true;
      settleOpen();
    };
    const fail = (errorCode: string, closeCode: number, closeReason: string) => {
      this.invokeSafely(() => options.onEventFailure({
        socket,
        errorCode,
        closeCode,
        closeReason
      }));
      this.close(socket, closeCode, closeReason);
    };

    socket.once("open", () => {
      try {
        if (!options.isCurrent()) {
          this.close(socket, 1000, "stale Cloud connection");
          return;
        }
        if (!this.sendJson(socket, options.createHello())) return;
        welcomeTimer = setTimeout(() => {
          fail("relay_welcome_timeout", 1008, "relay welcome timeout");
        }, CLOUD_CONNECTOR_HTTP_TIMEOUT_MS);
        welcomeTimer.unref?.();
      } catch {
        fail("relay_open_failed", 1011, "relay open failed");
      } finally {
        finishOpen();
      }
    });
    socket.on("message", (data, isBinary) => {
      if (!options.isCurrent()) return;
      if (isBinary) {
        this.close(socket, 1003, "binary frames are not supported");
        return;
      }
      try {
        const frame = parseCloudRelayServerJson(data.toString());
        if (frame.type === "relay.welcome" && welcomeTimer) {
          clearTimeout(welcomeTimer);
          welcomeTimer = null;
        }
        options.onFrame(frame, socket);
      } catch {
        fail("invalid_server_frame", 1002, "invalid relay frame");
      }
    });
    socket.once("error", finishOpen);
    socket.once("close", (code, reason) => {
      if (welcomeTimer) clearTimeout(welcomeTimer);
      welcomeTimer = null;
      finishOpen();
      this.invokeSafely(
        () => options.onClose(socket, code, toSafeCloudRelayCloseReasonCode(reason)),
        () => fail("relay_close_handler_failed", 1011, "relay close handler failed")
      );
    });
    return { socket, opened };
  }

  isOpen(socket: WebSocket | null): socket is WebSocket {
    return socket?.readyState === WebSocket.OPEN;
  }

  sendJson(socket: WebSocket, frame: unknown, hooks: CloudRelaySendHooks = {}) {
    if (!this.isOpen(socket)) return false;
    let serialized: string;
    try {
      serialized = JSON.stringify(frame);
    } catch {
      this.invokeSafely(hooks.onSendError);
      this.close(socket, 1011, "Cloud frame serialization failed");
      return false;
    }
    const frameBytes = Buffer.byteLength(serialized, "utf8");
    if (frameBytes > CLOUD_RELAY_MAX_FRAME_BYTES) {
      this.invokeSafely(hooks.onFrameTooLarge);
      this.close(socket, 1009, hooks.frameTooLargeReason ?? "Cloud frame too large");
      return false;
    }
    if (socket.bufferedAmount + frameBytes > this.maxBufferedBytes) {
      this.close(socket, 1013, "Cloud outbound backpressure exceeded");
      return false;
    }
    try {
      hooks.beforeSend?.();
      socket.send(serialized, (error) => {
        if (!error) return;
        this.invokeSafely(hooks.onSendError);
        this.close(socket, 1011, hooks.sendErrorReason ?? "Cloud frame send failed");
      });
      return true;
    } catch {
      this.invokeSafely(hooks.onSendError);
      this.close(socket, 1011, hooks.sendErrorReason ?? "Cloud frame send failed");
      return false;
    }
  }

  close(socket: WebSocket, code: number, reason: string) {
    try {
      socket.close(code, reason);
    } catch {
      // The transport boundary must never let a WebSocket implementation
      // failure escape into the daemon event loop.
    }
  }

  private invokeSafely(callback?: () => void, onError?: () => void) {
    try {
      callback?.();
    } catch {
      try {
        onError?.();
      } catch {
        // Secondary recovery callbacks are isolated from EventEmitter.
      }
    }
  }
}
