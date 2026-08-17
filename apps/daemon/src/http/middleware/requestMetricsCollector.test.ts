import assert from "node:assert/strict";
import test from "node:test";

import { RequestMetricsCollector } from "./requestMetricsCollector.ts";

test("request samples are isolated per collector lifecycle", () => {
  const first = new RequestMetricsCollector();
  const second = new RequestMetricsCollector();
  const memory = process.memoryUsage();
  first.record({
    durationMs: 12,
    finishedMemory: memory,
    metrics: { endpoint: "agent.transcript" },
    startedMemory: memory,
    responseBytes: 42,
    statusCode: 200
  });

  assert.equal(first.readSnapshot().endpoints[0]?.count, 1);
  assert.equal(second.readSnapshot().endpoints.length, 0);
});
