import type { Duplex } from "node:stream";
import { WebSocket } from "ws";

import { PREVIEW_PROXY_LIMITS } from "./previewProxyLimits.ts";
import type { PreviewWebSocketMetricTracker } from "./runtime/previewProxyMetrics.ts";

export function readWebSocketProtocols(value: string | undefined) {
  return value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
}

export function rejectPreviewUpgrade(socket: Duplex, status: number, message: string) {
  socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
}

function sendWebSocketMessage(target: WebSocket, data: Buffer, binary: boolean) {
  if (target.readyState !== WebSocket.OPEN) return;
  if (target.bufferedAmount > PREVIEW_PROXY_LIMITS.maxWebSocketBufferedBytes) {
    target.close(1013, "Preview WebSocket consumer is too slow");
    return;
  }
  target.send(data, { binary });
}

function isForwardableCloseCode(code: number) {
  return (
    (code >= 1000 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) ||
    (code >= 3000 && code <= 4999)
  );
}

function closeWithPeerStatus(target: WebSocket, code: number, reason: Buffer) {
  if (isForwardableCloseCode(code)) {
    target.close(code, reason.toString());
    return;
  }
  // 1005/1006/1015 are local sentinel values and are forbidden on the wire.
  target.close();
}

export function relayPreviewWebSockets(
  client: WebSocket,
  upstream: WebSocket,
  metrics?: PreviewWebSocketMetricTracker
) {
  const queued: Array<{ data: Buffer; binary: boolean }> = [];
  let queuedBytes = 0;
  client.on("message", (data, binary) => {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
    metrics?.addClientBytes(buffer.byteLength);
    if (upstream.readyState === WebSocket.CONNECTING) {
      queuedBytes += buffer.byteLength;
      if (queuedBytes > PREVIEW_PROXY_LIMITS.maxWebSocketBufferedBytes) {
        client.close(1009, "Preview WebSocket queue exceeded");
        return;
      }
      queued.push({ data: buffer, binary });
      return;
    }
    sendWebSocketMessage(upstream, buffer, binary);
  });
  upstream.once("open", () => {
    for (const item of queued) sendWebSocketMessage(upstream, item.data, item.binary);
    queued.length = 0;
  });
  upstream.on("message", (data, binary) => {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
    metrics?.addUpstreamBytes(buffer.byteLength);
    sendWebSocketMessage(
      client,
      buffer,
      binary
    );
  });
  client.once("close", (code, reason) => {
    if (upstream.readyState === WebSocket.OPEN) closeWithPeerStatus(upstream, code, reason);
    else upstream.terminate();
  });
  upstream.once("close", (code, reason) => {
    if (client.readyState === WebSocket.OPEN) closeWithPeerStatus(client, code, reason);
    else client.terminate();
  });
}
