import type { WebSocketMetricsSnapshot } from "@deskcue/protocol";

type WebSocketClientKind = "access-monitor" | "live";

const recentDisconnectedClientIds = new Map<string, number>();

let accessMonitorClients = 0;
let acknowledgedCursor: string | null = null;
let ackCount = 0;
let activeLiveClients = 0;
let backpressureDisconnectCount = 0;
let bufferedEventBytes = 0;
let connectionCount = 0;
let disconnectedCount = 0;
let droppedEventCount = 0;
let latestCursor: string | null = null;
let malformedClientEventCount = 0;
let oversizedEventCount = 0;
let reconnectCount = 0;
let replayedEventCount = 0;
let sendErrorCount = 0;
let sentEventCount = 0;
let skippedLogEventCount = 0;
let bufferedEventCount = 0;

const RECENT_RECONNECT_WINDOW_MS = 60_000;

function pruneRecentDisconnectedClientIds() {
  const now = Date.now();
  for (const [clientId, disconnectedAt] of recentDisconnectedClientIds.entries()) {
    if (now - disconnectedAt > RECENT_RECONNECT_WINDOW_MS) {
      recentDisconnectedClientIds.delete(clientId);
    }
  }
}

export function recordWebSocketConnection(kind: WebSocketClientKind, clientId: string | null) {
  connectionCount += 1;
  if (kind === "access-monitor") {
    accessMonitorClients += 1;
  } else {
    activeLiveClients += 1;
  }

  pruneRecentDisconnectedClientIds();
  if (clientId && recentDisconnectedClientIds.has(clientId)) {
    reconnectCount += 1;
    recentDisconnectedClientIds.delete(clientId);
  }
}

export function recordWebSocketDisconnect(kind: WebSocketClientKind, clientId: string | null) {
  disconnectedCount += 1;
  if (kind === "access-monitor") {
    accessMonitorClients = Math.max(0, accessMonitorClients - 1);
  } else {
    activeLiveClients = Math.max(0, activeLiveClients - 1);
  }

  if (clientId) {
    recentDisconnectedClientIds.set(clientId, Date.now());
  }
}

export function recordWebSocketAck(cursor: string, _clientId: string | null) {
  ackCount += 1;
  acknowledgedCursor = cursor;
}

export function recordWebSocketBufferedEvents(count: number, bytes = bufferedEventBytes) {
  bufferedEventCount = count;
  bufferedEventBytes = bytes;
}

export function recordWebSocketBackpressureDisconnect() {
  backpressureDisconnectCount += 1;
}

export function recordWebSocketDroppedEvent() {
  droppedEventCount += 1;
}

export function recordWebSocketMalformedClientEvent() {
  malformedClientEventCount += 1;
}

export function recordWebSocketOversizedEvent() {
  oversizedEventCount += 1;
}

export function recordWebSocketReplayedEvent() {
  replayedEventCount += 1;
}

export function recordWebSocketSentEvent(cursor: string | null) {
  sentEventCount += 1;
  latestCursor = cursor ?? latestCursor;
}

export function recordWebSocketSendError() {
  sendErrorCount += 1;
}

export function recordWebSocketSkippedLogEvent() {
  skippedLogEventCount += 1;
}

export function readWebSocketMetricsSnapshot(): WebSocketMetricsSnapshot {
  return {
    accessMonitorClients,
    acknowledgedCursor,
    ackCount,
    activeClients: accessMonitorClients + activeLiveClients,
    activeLiveClients,
    backpressureDisconnectCount,
    bufferedEventBytes,
    bufferedEventCount,
    connectionCount,
    disconnectedCount,
    droppedEventCount,
    latestCursor,
    malformedClientEventCount,
    oversizedEventCount,
    reconnectCount,
    replayedEventCount,
    sendErrorCount,
    sentEventCount,
    skippedLogEventCount
  };
}

export function resetWebSocketMetricsForTests() {
  recentDisconnectedClientIds.clear();
  accessMonitorClients = 0;
  acknowledgedCursor = null;
  ackCount = 0;
  activeLiveClients = 0;
  backpressureDisconnectCount = 0;
  bufferedEventBytes = 0;
  connectionCount = 0;
  disconnectedCount = 0;
  droppedEventCount = 0;
  latestCursor = null;
  malformedClientEventCount = 0;
  oversizedEventCount = 0;
  reconnectCount = 0;
  replayedEventCount = 0;
  sendErrorCount = 0;
  sentEventCount = 0;
  skippedLogEventCount = 0;
  bufferedEventCount = 0;
}
