import type { IncomingMessage } from "node:http";
import type { RawData, WebSocket } from "ws";

import type { ClientEvent } from "@deskcue/protocol";
import {
  ProtocolSchemaError,
  parseClientEvent as parseProtocolClientEvent
} from "@deskcue/protocol";
import { logger } from "#infrastructure/logging/logger";

import type { WebSocketHeartbeat } from "../heartbeat.ts";
import {
  recordWebSocketAck,
  recordWebSocketConnection,
  recordWebSocketDisconnect,
  recordWebSocketMalformedClientEvent
} from "./metrics.ts";
import type { LiveSessionPresence } from "../presence.ts";
import { readClientIdFromRequestUrl } from "../serverEventReplay.ts";

type BindLiveUpdatesConnectionOptions = {
  heartbeat: WebSocketHeartbeat;
  notifyPresenceChangedSessions: (...sessionIds: Array<string | null | undefined>) => void;
  presence: LiveSessionPresence;
  request: IncomingMessage;
  socket: WebSocket;
  wsClients: Set<WebSocket>;
};

export function sanitizeWebSocketRequestPath(path: string | undefined) {
  if (!path) {
    return null;
  }

  try {
    const url = new URL(path, "http://deskcue.local");
    for (const key of ["access_token", "deskcueToken", "token"]) {
      if (url.searchParams.has(key)) {
        url.searchParams.set(key, "[redacted]");
      }
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return path.replace(/([?&](?:access_token|deskcueToken|token)=)[^&#]*/gi, "$1[redacted]");
  }
}

function readClientEvent(rawMessage: RawData): ClientEvent | null {
  try {
    const text = Array.isArray(rawMessage)
      ? Buffer.concat(rawMessage).toString("utf8")
      : typeof rawMessage === "string"
        ? rawMessage
        : rawMessage.toString();
    return parseProtocolClientEvent(JSON.parse(text));
  } catch (error) {
    if (error instanceof ProtocolSchemaError || error instanceof SyntaxError) {
      return null;
    }

    return null;
  }
}

function readClientId(event: ClientEvent) {
  const clientId = "clientId" in event ? event.clientId : null;
  return typeof clientId === "string" ? clientId : null;
}

export function bindLiveUpdatesConnection({
  heartbeat,
  notifyPresenceChangedSessions,
  presence,
  request,
  socket,
  wsClients
}: BindLiveUpdatesConnectionOptions) {
  const requestPath = sanitizeWebSocketRequestPath(request.url);
  const requestClientId = readClientIdFromRequestUrl(request.url);
  wsClients.add(socket);
  heartbeat.add(socket);
  presence.addClient(socket);
  recordWebSocketConnection("live", requestClientId);
  logger.info("WebSocket client connected", {
    path: requestPath,
    ip: request.socket.remoteAddress ?? null,
    clients: wsClients.size
  });

  socket.on("message", (rawMessage: RawData) => {
    const event = readClientEvent(rawMessage);
    if (!event) {
      recordWebSocketMalformedClientEvent();
      logger.warn("Ignoring malformed WebSocket client event", {
        path: requestPath,
        ip: request.socket.remoteAddress ?? null
      });
      return;
    }

    if (event.type === "ack") {
      recordWebSocketAck(event.cursor, readClientId(event) ?? requestClientId);
      return;
    }

    const presenceChange = presence.updateClientSession(
      socket,
      event.sessionId,
      readClientId(event),
      event.sessionTab
    );
    if (!presenceChange) {
      return;
    }

    logger.info("WebSocket session presence updated", {
      path: requestPath,
      ip: request.socket.remoteAddress ?? null,
      previousSessionId: presenceChange.previousSessionId,
      sessionId: presenceChange.sessionId
    });
    notifyPresenceChangedSessions(
      presenceChange.previousSessionId,
      presenceChange.sessionId
    );
  });

  socket.on("close", () => {
    const activeSessionId = presence.deleteClient(socket);
    heartbeat.delete(socket);
    wsClients.delete(socket);
    recordWebSocketDisconnect("live", requestClientId);
    if (activeSessionId) {
      notifyPresenceChangedSessions(activeSessionId);
    }
    logger.info("WebSocket client disconnected", {
      path: requestPath,
      ip: request.socket.remoteAddress ?? null,
      clients: wsClients.size
    });
  });

  socket.on("error", (error: Error) => {
    logger.warn("WebSocket client error", {
      path: requestPath,
      ip: request.socket.remoteAddress ?? null,
      message: error.message
    });
  });
}
