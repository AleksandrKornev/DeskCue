export interface DaemonLogEntry {
  timestamp: string | null;
  level: string;
  message: string;
  context: Record<string, unknown> | null;
}

export interface DaemonLogsResponse {
  entries: DaemonLogEntry[];
  filePath: string | null;
  truncated: boolean;
}

export interface RequestMetricEndpointSnapshot {
  endpoint: string;
  count: number;
  averageDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  responseBytes: number;
  averageResponseBytes: number;
  memory: RequestMetricMemorySnapshot;
  etagHitCount: number;
  etagHitRate: number;
  statusCounts: Array<{
    statusCode: number;
    count: number;
  }>;
  readModes: Array<{
    readMode: string;
    count: number;
  }>;
  latestAt: string | null;
}

export interface RequestMetricMemorySnapshot {
  averageArrayBuffersDeltaBytes: number;
  averageExternalDeltaBytes: number;
  averageHeapUsedDeltaBytes: number;
  averageRssDeltaBytes: number;
  maxArrayBuffersDeltaBytes: number;
  maxExternalDeltaBytes: number;
  maxHeapUsedDeltaBytes: number;
  maxRssBytes: number;
  maxRssDeltaBytes: number;
}

export interface RequestMetricSessionSnapshot {
  endpoint: string;
  requestCount: number;
  responseBytes: number;
  sessionId: string;
  sessionKind: "agent-session" | "managed-session";
}

export interface WebSocketMetricsSnapshot {
  accessMonitorClients: number;
  acknowledgedCursor: string | null;
  ackCount: number;
  activeClients: number;
  activeLiveClients: number;
  backpressureDisconnectCount: number;
  bufferedEventBytes: number;
  bufferedEventCount: number;
  connectionCount: number;
  disconnectedCount: number;
  droppedEventCount: number;
  latestCursor: string | null;
  malformedClientEventCount: number;
  oversizedEventCount: number;
  reconnectCount: number;
  replayedEventCount: number;
  sendErrorCount: number;
  sentEventCount: number;
  skippedLogEventCount: number;
}

export interface RequestMetricsResponse {
  sampleLimitPerEndpoint: number;
  endpoints: RequestMetricEndpointSnapshot[];
  sessions: RequestMetricSessionSnapshot[];
  websocket: WebSocketMetricsSnapshot;
}

export interface PreviewProxyAdmissionSnapshot {
  activeHttpOwners: number;
  activeHttpRequests: number;
  activeHttpViewers: number;
  activeWebSocketOwners: number;
  activeWebSockets: number;
  activeWebSocketViewers: number;
  closed: boolean;
}

export interface PreviewProxyLatencySnapshot {
  averageMs: number;
  count: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
  sampleLimit: number;
}

export interface PreviewProxyRejectionSnapshot {
  closed: number;
  global: number;
  owner: number;
  viewer: number;
}

export interface PreviewProxyDiagnosticsSnapshot {
  admission: PreviewProxyAdmissionSnapshot;
  latency: PreviewProxyLatencySnapshot;
  limits: {
    httpGlobal: number;
    httpPerOwner: number;
    httpPerViewer: number;
    websocketGlobal: number;
    websocketPerOwner: number;
    websocketPerViewer: number;
  };
  totals: {
    httpErrorCount: number;
    httpRequestBytes: number;
    httpRequestCount: number;
    httpResponseBytes: number;
    rejectedHttp: PreviewProxyRejectionSnapshot;
    rejectedWebSocket: PreviewProxyRejectionSnapshot;
    websocketClientBytes: number;
    websocketConnectionCount: number;
    websocketErrorCount: number;
    websocketUpstreamBytes: number;
  };
}
