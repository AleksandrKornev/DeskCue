import WebSocket from "ws";

import { CLOUD_PREVIEW_MAX_FRAME_BYTES, parseCloudPreviewServerJson } from "@deskcue/protocol/cloud";
import type { CloudPreviewClientFrame, CloudPreviewServerFrame } from "@deskcue/protocol/cloud";

import { toSafeCloudRelayCloseReasonCode } from "../cloudRelayLogSafety.ts";
import { CLOUD_CONNECTOR_HTTP_TIMEOUT_MS } from "../connector/cloudConnectorHttpClient.ts";

const DEFAULT_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

export type CloudPreviewDataSocketSession = {
  opened: Promise<void>;
  socket: WebSocket;
};

export type CloudPreviewDataSocketOptions = {
  connectionToken: string;
  isCurrent: () => boolean;
  onClose: (socket: WebSocket, code: number, reasonCode: string) => void;
  onFailure: (socket: WebSocket, errorCode: string) => void;
  onFrame: (frame: CloudPreviewServerFrame, socket: WebSocket) => void;
  previewUrl: string;
};

function invokeSafely(callback: () => void) {
  try {
    callback();
  } catch {
    // EventEmitter callbacks must not escape into the daemon process.
  }
}

/** Dedicated bounded transport for Preview frames; it performs no relay handshake. */
export class CloudPreviewDataSocketTransport {
  constructor(private readonly maxBufferedBytes = DEFAULT_MAX_BUFFERED_BYTES) {}

  open(options: CloudPreviewDataSocketOptions): CloudPreviewDataSocketSession {
    const socket = new WebSocket(options.previewUrl, {
      headers: { Authorization: `Bearer ${options.connectionToken}` },
      handshakeTimeout: CLOUD_CONNECTOR_HTTP_TIMEOUT_MS,
      maxPayload: CLOUD_PREVIEW_MAX_FRAME_BYTES,
      perMessageDeflate: false
    });
    let resolveOpened!: () => void;
    let rejectOpened!: (error: Error) => void;
    const opened = new Promise<void>((resolve, reject) => {
      resolveOpened = resolve;
      rejectOpened = reject;
    });
    let settled = false;
    const settleSuccess = () => {
      if (settled) return;
      settled = true;
      resolveOpened();
    };
    const fail = (errorCode: string, reason: string) => {
      if (!settled) {
        settled = true;
        rejectOpened(new Error(errorCode));
      }
      invokeSafely(() => options.onFailure(socket, errorCode));
      this.close(socket, 1002, reason);
    };

    socket.once("open", () => {
      if (!options.isCurrent()) {
        this.close(socket, 1000, "stale preview connection");
        rejectOpened(new Error("preview_connection_stale"));
        settled = true;
        return;
      }
      settleSuccess();
    });
    socket.on("message", (data, isBinary) => {
      if (!options.isCurrent()) return;
      if (isBinary) {
        fail("preview_binary_frame", "binary preview frames are not supported");
        return;
      }
      try {
        options.onFrame(parseCloudPreviewServerJson(data.toString()), socket);
      } catch {
        fail("preview_invalid_server_frame", "invalid preview frame");
      }
    });
    socket.once("error", () => {
      if (!settled) {
        settled = true;
        rejectOpened(new Error("preview_socket_error"));
      }
    });
    socket.once("close", (code, reason) => {
      if (!settled) {
        settled = true;
        rejectOpened(new Error("preview_socket_closed"));
      }
      invokeSafely(() => options.onClose(
        socket,
        code,
        toSafeCloudRelayCloseReasonCode(reason)
      ));
    });
    return { opened, socket };
  }

  send(socket: WebSocket, frame: CloudPreviewClientFrame) {
    if (socket.readyState !== WebSocket.OPEN) return false;
    let serialized: string;
    try {
      serialized = JSON.stringify(frame);
    } catch {
      this.close(socket, 1011, "preview serialization failed");
      return false;
    }
    const bytes = Buffer.byteLength(serialized);
    if (bytes > CLOUD_PREVIEW_MAX_FRAME_BYTES) {
      this.close(socket, 1009, "preview frame too large");
      return false;
    }
    if (socket.bufferedAmount + bytes > this.maxBufferedBytes) {
      this.close(socket, 1013, "preview backpressure exceeded");
      return false;
    }
    try {
      socket.send(serialized, (error) => {
        if (error) this.close(socket, 1011, "preview send failed");
      });
      return true;
    } catch {
      this.close(socket, 1011, "preview send failed");
      return false;
    }
  }

  close(socket: WebSocket, code: number, reason: string) {
    try {
      socket.close(code, reason);
    } catch {
      // WebSocket implementation failures stay inside the transport boundary.
    }
  }
}
