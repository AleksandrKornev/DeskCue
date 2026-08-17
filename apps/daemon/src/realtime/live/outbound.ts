import { Buffer } from "node:buffer";
import type { WebSocket } from "ws";

import { logger } from "#infrastructure/logging/logger";

import {
  recordWebSocketBackpressureDisconnect,
  recordWebSocketDroppedEvent,
  recordWebSocketOversizedEvent,
  recordWebSocketSendError,
  recordWebSocketSentEvent
} from "./metrics.ts";

export const MAX_WEBSOCKET_BUFFERED_BYTES = 1024 * 1024;
export const MAX_WEBSOCKET_EVENT_BYTES = 256 * 1024;

type SendWebSocketPayloadOptions = {
  cursor: string | null;
  eventType: string;
  replay?: boolean;
};

export function sendWebSocketPayload(
  socket: WebSocket,
  payload: string,
  { cursor, eventType, replay = false }: SendWebSocketPayloadOptions
) {
  if (socket.readyState !== socket.OPEN) {
    return false;
  }

  const payloadBytes = Buffer.byteLength(payload);
  if (payloadBytes > MAX_WEBSOCKET_EVENT_BYTES) {
    recordWebSocketDroppedEvent();
    recordWebSocketOversizedEvent();
    logger.warn("WebSocket event exceeds the outbound byte limit", {
      cursor,
      eventType,
      payloadBytes,
      replay
    });
    return false;
  }

  if (socket.bufferedAmount + payloadBytes > MAX_WEBSOCKET_BUFFERED_BYTES) {
    recordWebSocketBackpressureDisconnect();
    recordWebSocketDroppedEvent();
    logger.warn("WebSocket client disconnected due to outbound backpressure", {
      bufferedBytes: socket.bufferedAmount,
      cursor,
      eventType,
      payloadBytes,
      replay
    });
    socket.terminate();
    return false;
  }

  try {
    socket.send(payload, (error) => {
      if (!error) {
        return;
      }

      recordWebSocketSendError();
      logger.warn("WebSocket event delivery failed", {
        cursor,
        eventType,
        message: error.message,
        replay
      });
      socket.terminate();
    });
    recordWebSocketSentEvent(cursor);
    return true;
  } catch (error) {
    recordWebSocketSendError();
    logger.warn("WebSocket event delivery threw", {
      cursor,
      eventType,
      message: error instanceof Error ? error.message : String(error),
      replay
    });
    socket.terminate();
    return false;
  }
}
