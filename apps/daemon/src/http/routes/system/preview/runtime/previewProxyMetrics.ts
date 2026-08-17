import type {
  PreviewProxyAdmissionSnapshot,
  PreviewProxyDiagnosticsSnapshot,
  PreviewProxyLatencySnapshot
} from "@deskcue/protocol";

import { PREVIEW_PROXY_LIMITS } from "../previewProxyLimits.ts";
import type { PreviewAdmissionKind, PreviewAdmissionRejection } from "./previewProxyAdmission.ts";

const PREVIEW_LATENCY_SAMPLE_LIMIT = 256;

export type PreviewHttpMetricTracker = {
  addRequestBytes: (bytes: number) => void;
  addResponseBytes: (bytes: number) => void;
  finish: (statusCode: number) => void;
};

export type PreviewWebSocketMetricTracker = {
  addClientBytes: (bytes: number) => void;
  addUpstreamBytes: (bytes: number) => void;
  finish: () => void;
  recordError: () => void;
};

function createRejectionCounters() {
  const counters = () => ({ closed: 0, global: 0, owner: 0, viewer: 0 });
  return { http: counters(), websocket: counters() };
}

function normalizeBytes(bytes: number) {
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : 0;
}

function addMetric(current: number, delta: number) {
  return Math.min(Number.MAX_SAFE_INTEGER, current + delta);
}

function readPercentile(values: number[], percentile: number) {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.ceil(values.length * percentile) - 1);
  return values[Math.max(0, index)] ?? 0;
}

function buildLatencySnapshot(values: number[]): PreviewProxyLatencySnapshot {
  const sorted = [...values].sort((left, right) => left - right);
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    averageMs: values.length > 0 ? Math.round((total / values.length) * 1000) / 1000 : 0,
    count: values.length,
    maxMs: sorted.at(-1) ?? 0,
    p50Ms: readPercentile(sorted, 0.5),
    p95Ms: readPercentile(sorted, 0.95),
    sampleLimit: PREVIEW_LATENCY_SAMPLE_LIMIT
  };
}

/** Bounded, identifier-free operational metrics for the Preview proxy. */
export class PreviewProxyMetrics {
  private activeHttpRequests = 0;
  private activeWebSockets = 0;
  private httpErrorCount = 0;
  private httpRequestBytes = 0;
  private httpRequestCount = 0;
  private httpResponseBytes = 0;
  private readonly latenciesMs: number[] = [];
  private readonly rejected = createRejectionCounters();
  private websocketClientBytes = 0;
  private websocketConnectionCount = 0;
  private websocketErrorCount = 0;
  private websocketUpstreamBytes = 0;

  startHttp(): PreviewHttpMetricTracker {
    const startedAt = performance.now();
    this.activeHttpRequests += 1;
    this.httpRequestCount = addMetric(this.httpRequestCount, 1);
    let finished = false;
    return {
      addRequestBytes: (bytes) => {
        this.httpRequestBytes = addMetric(this.httpRequestBytes, normalizeBytes(bytes));
      },
      addResponseBytes: (bytes) => {
        this.httpResponseBytes = addMetric(this.httpResponseBytes, normalizeBytes(bytes));
      },
      finish: (statusCode) => {
        if (finished) return;
        finished = true;
        this.activeHttpRequests = Math.max(0, this.activeHttpRequests - 1);
        if (statusCode >= 400) this.httpErrorCount = addMetric(this.httpErrorCount, 1);
        this.recordLatency(performance.now() - startedAt);
      }
    };
  }

  startWebSocket(): PreviewWebSocketMetricTracker {
    this.activeWebSockets += 1;
    this.websocketConnectionCount = addMetric(this.websocketConnectionCount, 1);
    let finished = false;
    return {
      addClientBytes: (bytes) => {
        this.websocketClientBytes = addMetric(this.websocketClientBytes, normalizeBytes(bytes));
      },
      addUpstreamBytes: (bytes) => {
        this.websocketUpstreamBytes = addMetric(this.websocketUpstreamBytes, normalizeBytes(bytes));
      },
      finish: () => {
        if (finished) return;
        finished = true;
        this.activeWebSockets = Math.max(0, this.activeWebSockets - 1);
      },
      recordError: () => {
        this.websocketErrorCount = addMetric(this.websocketErrorCount, 1);
      }
    };
  }

  recordAdmissionRejection(
    kind: PreviewAdmissionKind,
    reason: PreviewAdmissionRejection
  ) {
    this.rejected[kind][reason] = addMetric(this.rejected[kind][reason], 1);
  }

  readSnapshot(admission: PreviewProxyAdmissionSnapshot): PreviewProxyDiagnosticsSnapshot {
    return {
      admission,
      latency: buildLatencySnapshot(this.latenciesMs),
      limits: {
        httpGlobal: PREVIEW_PROXY_LIMITS.maxConcurrentRequests,
        httpPerOwner: PREVIEW_PROXY_LIMITS.maxConcurrentRequestsPerOwner,
        httpPerViewer: PREVIEW_PROXY_LIMITS.maxConcurrentRequestsPerViewer,
        websocketGlobal: PREVIEW_PROXY_LIMITS.maxConcurrentWebSockets,
        websocketPerOwner: PREVIEW_PROXY_LIMITS.maxConcurrentWebSocketsPerOwner,
        websocketPerViewer: PREVIEW_PROXY_LIMITS.maxConcurrentWebSocketsPerViewer
      },
      totals: {
        httpErrorCount: this.httpErrorCount,
        httpRequestBytes: this.httpRequestBytes,
        httpRequestCount: this.httpRequestCount,
        httpResponseBytes: this.httpResponseBytes,
        rejectedHttp: { ...this.rejected.http },
        rejectedWebSocket: { ...this.rejected.websocket },
        websocketClientBytes: this.websocketClientBytes,
        websocketConnectionCount: this.websocketConnectionCount,
        websocketErrorCount: this.websocketErrorCount,
        websocketUpstreamBytes: this.websocketUpstreamBytes
      }
    };
  }

  private recordLatency(durationMs: number) {
    this.latenciesMs.push(Math.max(0, Math.round(durationMs * 1000) / 1000));
    while (this.latenciesMs.length > PREVIEW_LATENCY_SAMPLE_LIMIT) this.latenciesMs.shift();
  }
}
