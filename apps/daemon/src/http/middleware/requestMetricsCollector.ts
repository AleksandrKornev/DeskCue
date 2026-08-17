import type { RequestMetricsResponse } from "@deskcue/protocol";
import { readWebSocketMetricsSnapshot } from "#realtime/live/metrics";

export type RequestMetrics = Record<string, unknown>;

type RequestMetricSample = {
  arrayBuffersDeltaBytes: number;
  durationMs: number;
  etagHit: boolean;
  externalDeltaBytes: number;
  heapUsedDeltaBytes: number;
  readMode: string | null;
  responseBytes: number;
  rssBytes: number;
  rssDeltaBytes: number;
  sessionId: string | null;
  sessionKind: "agent-session" | "managed-session" | null;
  statusCode: number;
  timestamp: number;
};

const REQUEST_METRIC_SAMPLE_LIMIT_PER_ENDPOINT = 512;

/** Owns the bounded request sample window and diagnostics aggregation. */
function buildSessionSnapshots(
  endpointEntries: Array<[string, RequestMetricSample[]]>
): RequestMetricsResponse["sessions"] {
  const snapshots = new Map<string, {
    endpoint: string;
    requestCount: number;
    responseBytes: number;
    sessionId: string;
    sessionKind: "agent-session" | "managed-session";
  }>();
  for (const [endpoint, samples] of endpointEntries) {
    for (const sample of samples) {
      if (!sample.sessionId || !sample.sessionKind) continue;
      const key = `${sample.sessionKind}\u0000${sample.sessionId}\u0000${endpoint}`;
      const existing = snapshots.get(key) ?? {
        endpoint,
        requestCount: 0,
        responseBytes: 0,
        sessionId: sample.sessionId,
        sessionKind: sample.sessionKind
      };
      existing.requestCount += 1;
      existing.responseBytes += sample.responseBytes;
      snapshots.set(key, existing);
    }
  }
  return Array.from(snapshots.values()).sort((left, right) => {
    const bytesDelta = right.responseBytes - left.responseBytes;
    return bytesDelta === 0
      ? `${left.sessionKind}:${left.sessionId}:${left.endpoint}`.localeCompare(
        `${right.sessionKind}:${right.sessionId}:${right.endpoint}`
      )
      : bytesDelta;
  });
}

function countSamplesBy<TSample>(samples: TSample[], readKey: (sample: TSample) => string) {
  const counts = new Map<string, number>();
  for (const sample of samples) {
    const key = readKey(sample);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([key, count]) => ({ key, count }));
}

function readMax(values: number[]) {
  return values.length > 0 ? Math.max(...values) : 0;
}

function roundMetricAverage(total: number, count: number) {
  return count > 0 ? Math.round((total / count) * 1000) / 1000 : 0;
}

function buildEndpointMemorySnapshot(samples: RequestMetricSample[]) {
  return {
    averageArrayBuffersDeltaBytes: roundMetricAverage(
      samples.reduce((sum, sample) => sum + sample.arrayBuffersDeltaBytes, 0), samples.length
    ),
    averageExternalDeltaBytes: roundMetricAverage(
      samples.reduce((sum, sample) => sum + sample.externalDeltaBytes, 0), samples.length
    ),
    averageHeapUsedDeltaBytes: roundMetricAverage(
      samples.reduce((sum, sample) => sum + sample.heapUsedDeltaBytes, 0), samples.length
    ),
    averageRssDeltaBytes: roundMetricAverage(
      samples.reduce((sum, sample) => sum + sample.rssDeltaBytes, 0), samples.length
    ),
    maxArrayBuffersDeltaBytes: readMax(samples.map((sample) => sample.arrayBuffersDeltaBytes)),
    maxExternalDeltaBytes: readMax(samples.map((sample) => sample.externalDeltaBytes)),
    maxHeapUsedDeltaBytes: readMax(samples.map((sample) => sample.heapUsedDeltaBytes)),
    maxRssBytes: readMax(samples.map((sample) => sample.rssBytes)),
    maxRssDeltaBytes: readMax(samples.map((sample) => sample.rssDeltaBytes))
  };
}

function readPercentile(sortedValues: number[], percentile: number) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * percentile) - 1)
  );
  return sortedValues[index] ?? 0;
}

function buildEndpointSnapshot(
  endpoint: string,
  samples: RequestMetricSample[]
): RequestMetricsResponse["endpoints"][number] {
  const durations = samples.map((sample) => sample.durationMs).sort((left, right) => left - right);
  const responseBytes = samples.reduce((sum, sample) => sum + sample.responseBytes, 0);
  const etagHitCount = samples.filter((sample) => sample.etagHit).length;
  return {
    endpoint,
    count: samples.length,
    averageDurationMs: roundMetricAverage(durations.reduce((sum, value) => sum + value, 0), samples.length),
    p50DurationMs: readPercentile(durations, 0.5),
    p95DurationMs: readPercentile(durations, 0.95),
    p99DurationMs: readPercentile(durations, 0.99),
    responseBytes,
    averageResponseBytes: roundMetricAverage(responseBytes, samples.length),
    memory: buildEndpointMemorySnapshot(samples),
    etagHitCount,
    etagHitRate: roundMetricAverage(etagHitCount, samples.length),
    statusCounts: countSamplesBy(samples, (sample) => String(sample.statusCode))
      .map(({ key, count }) => ({ statusCode: Number(key), count }))
      .sort((left, right) => left.statusCode - right.statusCode),
    readModes: countSamplesBy(
      samples.filter((sample) => sample.readMode),
      (sample) => sample.readMode ?? "unknown"
    )
      .map(({ key, count }) => ({ readMode: key, count }))
      .sort((left, right) => left.readMode.localeCompare(right.readMode)),
    latestAt: samples.length > 0
      ? new Date(Math.max(...samples.map((sample) => sample.timestamp))).toISOString()
      : null
  };
}

function readMetricSessionScope(metrics: RequestMetrics | undefined): Pick<
  RequestMetricSample,
  "sessionId" | "sessionKind"
> {
  const agentSessionId = typeof metrics?.agentSessionId === "string" ? metrics.agentSessionId : null;
  if (agentSessionId) return { sessionId: agentSessionId, sessionKind: "agent-session" };
  const sessionId = typeof metrics?.sessionId === "string" ? metrics.sessionId : null;
  return sessionId
    ? { sessionId, sessionKind: "managed-session" }
    : { sessionId: null, sessionKind: null };
}

export class RequestMetricsCollector {
  private readonly samplesByEndpoint = new Map<string, RequestMetricSample[]>();

  record({
    durationMs,
    finishedMemory,
    metrics,
    startedMemory,
    responseBytes,
    statusCode
  }: {
    durationMs: number;
    finishedMemory: NodeJS.MemoryUsage;
    metrics: RequestMetrics | undefined;
    startedMemory: NodeJS.MemoryUsage;
    responseBytes: number | null;
    statusCode: number;
  }) {
    const endpoint = typeof metrics?.endpoint === "string" ? metrics.endpoint : null;
    if (!endpoint) return;

    const samples = this.samplesByEndpoint.get(endpoint) ?? [];
    samples.push({
      arrayBuffersDeltaBytes: finishedMemory.arrayBuffers - startedMemory.arrayBuffers,
      durationMs,
      etagHit: metrics?.etagHit === true,
      externalDeltaBytes: finishedMemory.external - startedMemory.external,
      heapUsedDeltaBytes: finishedMemory.heapUsed - startedMemory.heapUsed,
      readMode: typeof metrics?.readMode === "string" ? metrics.readMode : null,
      responseBytes: responseBytes ?? 0,
      rssBytes: finishedMemory.rss,
      rssDeltaBytes: finishedMemory.rss - startedMemory.rss,
      ...readMetricSessionScope(metrics),
      statusCode,
      timestamp: Date.now()
    });
    while (samples.length > REQUEST_METRIC_SAMPLE_LIMIT_PER_ENDPOINT) samples.shift();
    this.samplesByEndpoint.set(endpoint, samples);
  }

  readSnapshot(): RequestMetricsResponse {
    const endpointEntries = Array.from(this.samplesByEndpoint.entries());
    return {
      sampleLimitPerEndpoint: REQUEST_METRIC_SAMPLE_LIMIT_PER_ENDPOINT,
      endpoints: endpointEntries
        .map(([endpoint, samples]) => buildEndpointSnapshot(endpoint, samples))
        .sort((left, right) => left.endpoint.localeCompare(right.endpoint)),
      sessions: buildSessionSnapshots(endpointEntries),
      websocket: readWebSocketMetricsSnapshot()
    };
  }

  reset() {
    this.samplesByEndpoint.clear();
  }
}

export const requestMetricsCollector = new RequestMetricsCollector();
