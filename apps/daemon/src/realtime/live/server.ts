import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";

import { isCompatibleProtocolMetadata } from "@deskcue/protocol";
import type { ServerEvent, SessionDetail, SessionSummary } from "@deskcue/protocol";
import { accessDeviceStore } from "#access/accessDevices";
import type { DaemonApplication } from "#application/daemonApplication";
import { daemonConfig } from "#config/daemonConfig";
import { isTrustedLoopbackBrowserRequest } from "#http/hostClient";
import {
  isAllowedOrigin,
  readAccessTokenFromWebSocketRequest
} from "#http/routes/access/accessControl";
import { isAuthorizedCloudInternalWebSocketRequest } from "#http/routes/access/cloudInternalRequestAuth";
import { logger } from "#infrastructure/logging/logger";

import { createAgentSessionRealtimeSync } from "../agentSessionRealtimeSync.ts";
import { WebSocketHeartbeat } from "../heartbeat.ts";
import { bindLiveUpdatesConnection, sanitizeWebSocketRequestPath } from "./connection.ts";
import {
  recordWebSocketConnection,
  recordWebSocketDisconnect,
  recordWebSocketReplayedEvent,
  recordWebSocketSkippedLogEvent
} from "./metrics.ts";
import { sendWebSocketPayload } from "./outbound.ts";
import { LiveSessionPresence } from "../presence.ts";
import {
  readClientIdFromRequestUrl,
  readReplayCursorFromRequestUrl,
  ServerEventReplayBuffer
} from "../serverEventReplay.ts";
import {
  createProtocolHelloEvent,
  prepareServerEventForRealtime,
  serializeServerEvent
} from "../serverEvents.ts";

export { sanitizeWebSocketRequestPath };

type LiveUpdatesOptions = {
  accessToken?: string | null;
  authRequired?: boolean;
  allowedOrigins?: string[];
  application: DaemonApplication;
  decorateSession: <T extends SessionSummary | SessionDetail>(session: T) => T;
  server: Server;
};

export type LiveUpdatesController = {
  close: (callback: () => void) => void;
  getViewerCountForSession: (sessionId: string) => number;
};

const LIVE_AGENT_SESSION_SYNC_LIMIT = 64;
const LIVE_INITIAL_SOURCE_DETAIL_LIMIT = 8;
const BACKGROUND_AGENT_SESSION_SYNC_LIMIT = 64;
const BACKGROUND_INITIAL_SOURCE_DETAIL_LIMIT = 8;
const LOOPBACK_ACCESS_DEVICE_ID = "loopback-client";
const CLOUD_CONNECTOR_ACCESS_DEVICE_ID = "cloud-connector";
const ACCESS_RECHECK_EXEMPT_DEVICE_IDS = new Set([
  LOOPBACK_ACCESS_DEVICE_ID,
  CLOUD_CONNECTOR_ACCESS_DEVICE_ID
]);
export const MAX_WEBSOCKET_INBOUND_PAYLOAD_BYTES = 64 * 1024;

function replayServerEvents(
  socket: WebSocket,
  requestUrl: string | undefined,
  decorateSession: <T extends SessionSummary | SessionDetail>(session: T) => T,
  eventReplay: ServerEventReplayBuffer
) {
  const afterCursor = readReplayCursorFromRequestUrl(requestUrl);
  if (!afterCursor || socket.readyState !== socket.OPEN) {
    return;
  }

  const clientId = readClientIdFromRequestUrl(requestUrl);
  for (const event of eventReplay.readAfter(afterCursor)) {
    if (socket.readyState !== socket.OPEN) {
      return;
    }

    const sent = sendWebSocketPayload(
      socket,
      serializeServerEvent(event, decorateSession),
      {
        cursor: event.cursor ?? null,
        eventType: event.type,
        replay: true
      }
    );
    if (!sent) {
      return;
    }
    recordWebSocketReplayedEvent();
  }

  logger.info("WebSocket replay completed", {
    afterCursor,
    clientId
  });
}

function isAccessMonitorWebSocket(requestUrl: string | undefined) {
  if (!requestUrl) {
    return false;
  }

  try {
    return new URL(requestUrl, "http://deskcue.local").searchParams.get("mode") === "access";
  } catch {
    return false;
  }
}

function hasCompatibleProtocolRequest(requestUrl: string | undefined) {
  if (!requestUrl) return false;
  try {
    const query = new URL(requestUrl, "http://deskcue.local").searchParams;
    const rawVersion = query.get("protocolVersion");
    const version = rawVersion !== null && /^\d+$/.test(rawVersion)
      ? Number(rawVersion)
      : null;
    return isCompatibleProtocolMetadata(
      version,
      query.getAll("protocolCapability")
    );
  } catch {
    return false;
  }
}

export function createLiveUpdates({
  accessToken,
  authRequired,
  allowedOrigins,
  application,
  decorateSession,
  server
}: LiveUpdatesOptions): LiveUpdatesController {
  const wsClients = new Set<WebSocket>();
  const liveUpdateClients = new Set<WebSocket>();
  const clientDeviceIds = new Map<WebSocket, string | null>();
  const heartbeat = new WebSocketHeartbeat(wsClients);
  const presence = new LiveSessionPresence();
  const eventReplay = new ServerEventReplayBuffer();
  const readAuthRequired = () => authRequired ?? daemonConfig.authRequired;
  const readAllowedOrigins = () => allowedOrigins ?? daemonConfig.allowedOrigins;
  const hasLiveUpdateClients = () => liveUpdateClients.size > 0;

  const wsServer = new WebSocketServer({
    maxPayload: MAX_WEBSOCKET_INBOUND_PAYLOAD_BYTES,
    noServer: true,
    verifyClient(info, callback) {
      const currentAuthRequired = readAuthRequired();
      const token = readAccessTokenFromWebSocketRequest(info.req);
      const device = accessToken === undefined
        ? accessDeviceStore.authenticateToken(token)
        : token === accessToken && token
          ? { id: "test-device", label: "Test device" }
          : null;
      const isLoopbackClient = isTrustedLoopbackBrowserRequest(info.req);
      const isCloudConnector = isAuthorizedCloudInternalWebSocketRequest(info.req);

      if (!isAllowedOrigin(info.origin, readAllowedOrigins(), currentAuthRequired)) {
        callback(false, 403, "Forbidden origin");
        return;
      }

      if (!hasCompatibleProtocolRequest(info.req.url)) {
        callback(false, 426, "DeskCue protocol upgrade required");
        return;
      }

      if (
        currentAuthRequired &&
        !device &&
        !isLoopbackClient &&
        !isCloudConnector
      ) {
        callback(false, 401, "DeskCue access token is required");
        return;
      }

      (info.req as typeof info.req & { deskcueAccessDeviceId?: string | null }).deskcueAccessDeviceId =
        device?.id ?? (isCloudConnector
          ? CLOUD_CONNECTOR_ACCESS_DEVICE_ID
          : isLoopbackClient ? LOOPBACK_ACCESS_DEVICE_ID : null);

      callback(true);
    }
  });
  const handleUpgrade = (
    request: import("node:http").IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer
  ) => {
    let pathname: string;
    try {
      pathname = new URL(request.url ?? "/", "http://deskcue.local").pathname;
    } catch {
      return;
    }
    if (pathname !== "/ws") return;
    wsServer.handleUpgrade(request, socket, head, (client) => {
      wsServer.emit("connection", client, request);
    });
  };
  server.on("upgrade", handleUpgrade);

  const getViewerCountForSession = (sessionId: string) =>
    presence.getViewerCountForSession(sessionId);

  const broadcastServerEvent = (event: ServerEvent) => {
    const eventWithCursor = eventReplay.assignCursor(prepareServerEventForRealtime(event));
    const payload = serializeServerEvent(eventWithCursor, decorateSession);

    for (const client of liveUpdateClients) {
      if (client.readyState !== client.OPEN) {
        continue;
      }

      if (
        event.type === "session.log" &&
        !presence.isClientViewingSessionLogs(client, event.payload.sessionId)
      ) {
        recordWebSocketSkippedLogEvent();
        continue;
      }

      sendWebSocketPayload(client, payload, {
        cursor: eventWithCursor.cursor ?? null,
        eventType: eventWithCursor.type
      });
    }
  };

  const notifyPresenceChangedSessions = (...sessionIds: Array<string | null | undefined>) => {
    const sessionsById = new Map(
      application.managedSessions
        .listSessions()
        .map((session) => [session.id, session] satisfies [string, SessionSummary])
    );

    for (const sessionId of new Set(sessionIds.filter((value): value is string => Boolean(value)))) {
      const session = sessionsById.get(sessionId);
      if (!session) {
        continue;
      }

      broadcastServerEvent({
        type: "session.updated",
        payload: session
      });
    }
  };

  const syncAgentSessionsRealtime = createAgentSessionRealtimeSync(
    application,
    hasLiveUpdateClients
  );

  const handleApplicationEvent = (event: ServerEvent) => {
    broadcastServerEvent(event);
  };
  application.events.on("event", handleApplicationEvent);

  const agentSessionSyncTimer = setInterval(() => {
    if (!hasLiveUpdateClients()) {
      return;
    }

    void syncAgentSessionsRealtime({
      initialSourceDetailLimit: LIVE_INITIAL_SOURCE_DETAIL_LIMIT,
      publishSummaries: true,
      sourceSessionLimit: LIVE_AGENT_SESSION_SYNC_LIMIT,
      syncManagedSessions: true,
      trackExternalTurns: true
    });
  }, daemonConfig.agentSessionSyncIntervalMs);
  agentSessionSyncTimer.unref();
  void syncAgentSessionsRealtime({
    initialSourceDetailLimit: LIVE_INITIAL_SOURCE_DETAIL_LIMIT,
    publishSummaries: hasLiveUpdateClients(),
    sourceSessionLimit: LIVE_AGENT_SESSION_SYNC_LIMIT,
    syncManagedSessions: hasLiveUpdateClients(),
    trackExternalTurns: hasLiveUpdateClients()
  });

  const sourceAgentNotificationSyncTimer = setInterval(() => {
    if (hasLiveUpdateClients()) {
      return;
    }

    void syncAgentSessionsRealtime({
      initialSourceDetailLimit: BACKGROUND_INITIAL_SOURCE_DETAIL_LIMIT,
      publishSummaries: false,
      sourceSessionLimit: BACKGROUND_AGENT_SESSION_SYNC_LIMIT,
      syncManagedSessions: false,
      trackExternalTurns: true
    });
  }, daemonConfig.sourceAgentNotificationPollingIntervalMs);
  sourceAgentNotificationSyncTimer.unref();
  void syncAgentSessionsRealtime({
    initialSourceDetailLimit: BACKGROUND_INITIAL_SOURCE_DETAIL_LIMIT,
    publishSummaries: false,
    sourceSessionLimit: BACKGROUND_AGENT_SESSION_SYNC_LIMIT,
    syncManagedSessions: false,
    trackExternalTurns: true
  });

  const accessRecheckTimer = setInterval(() => {
    if (!readAuthRequired()) {
      return;
    }

    for (const client of wsClients) {
      const deviceId = clientDeviceIds.get(client) ?? null;
      const active = accessToken === undefined
        ? accessDeviceStore.isDeviceActive(deviceId)
        : deviceId === "test-device";

      if (!ACCESS_RECHECK_EXEMPT_DEVICE_IDS.has(deviceId ?? "") && !active) {
        client.close(4001, "DeskCue access token is required");
      }
    }
  }, 1000);
  accessRecheckTimer.unref();

  wsServer.on("connection", (socket, request) => {
    clientDeviceIds.set(
      socket,
      (request as typeof request & { deskcueAccessDeviceId?: string | null }).deskcueAccessDeviceId ?? null
    );
    socket.once("close", () => {
      clientDeviceIds.delete(socket);
    });

    if (isAccessMonitorWebSocket(request.url)) {
      const requestPath = sanitizeWebSocketRequestPath(request.url);
      wsClients.add(socket);
      heartbeat.add(socket);
      recordWebSocketConnection("access-monitor", null);
      logger.info("WebSocket access monitor connected", {
        path: requestPath,
        ip: request.socket.remoteAddress ?? null,
        clients: wsClients.size
      });

      socket.on("close", () => {
        heartbeat.delete(socket);
        wsClients.delete(socket);
        recordWebSocketDisconnect("access-monitor", null);
        logger.info("WebSocket access monitor disconnected", {
          path: requestPath,
          ip: request.socket.remoteAddress ?? null,
          clients: wsClients.size
        });
      });
      socket.on("error", (error: Error) => {
        logger.warn("WebSocket access monitor error", {
          path: requestPath,
          ip: request.socket.remoteAddress ?? null,
          message: error.message
        });
      });
      return;
    }

    liveUpdateClients.add(socket);
    socket.once("close", () => {
      liveUpdateClients.delete(socket);
    });

    bindLiveUpdatesConnection({
      heartbeat,
      notifyPresenceChangedSessions,
      presence,
      request,
      socket,
      wsClients
    });
    sendWebSocketPayload(
      socket,
      serializeServerEvent(createProtocolHelloEvent(), decorateSession),
      {
        cursor: null,
        eventType: "protocol.hello"
      }
    );
    setImmediate(() => {
      replayServerEvents(socket, request.url, decorateSession, eventReplay);
    });
  });

  return {
    close(callback) {
      clearInterval(agentSessionSyncTimer);
      clearInterval(sourceAgentNotificationSyncTimer);
      clearInterval(accessRecheckTimer);
      heartbeat.close();
      eventReplay.clear();
      application.events.off?.("event", handleApplicationEvent);
      server.off("upgrade", handleUpgrade);

      for (const socket of [...wsClients]) {
        socket.terminate();
      }

      wsServer.close(callback);
    },
    getViewerCountForSession
  };
}
