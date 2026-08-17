import assert from "node:assert/strict";
import test from "node:test";

import { PreviewProxyAdmission } from "./previewProxyAdmission.ts";
import { PreviewProxyMetrics } from "./previewProxyMetrics.ts";

test("preview diagnostics aggregate bounded traffic metrics without scope identifiers", () => {
  const admission = new PreviewProxyAdmission();
  const metrics = new PreviewProxyMetrics();

  for (let index = 0; index < 300; index += 1) {
    const request = metrics.startHttp();
    request.addRequestBytes(10);
    request.addResponseBytes(20);
    request.finish(index % 10 === 0 ? 502 : 200);
  }
  const websocket = metrics.startWebSocket();
  websocket.addClientBytes(30);
  websocket.addUpstreamBytes(40);
  websocket.recordError();
  websocket.finish();
  metrics.recordAdmissionRejection("http", "viewer");
  metrics.recordAdmissionRejection("websocket", "global");

  const snapshot = metrics.readSnapshot(admission.readSnapshot());
  assert.equal(snapshot.latency.count, snapshot.latency.sampleLimit);
  assert.equal(snapshot.latency.sampleLimit, 256);
  assert.equal(snapshot.totals.httpRequestCount, 300);
  assert.equal(snapshot.totals.httpErrorCount, 30);
  assert.equal(snapshot.totals.httpRequestBytes, 3_000);
  assert.equal(snapshot.totals.httpResponseBytes, 6_000);
  assert.equal(snapshot.totals.websocketConnectionCount, 1);
  assert.equal(snapshot.totals.websocketErrorCount, 1);
  assert.equal(snapshot.totals.websocketClientBytes, 30);
  assert.equal(snapshot.totals.websocketUpstreamBytes, 40);
  assert.equal(snapshot.totals.rejectedHttp.viewer, 1);
  assert.equal(snapshot.totals.rejectedWebSocket.global, 1);
  assert.equal(JSON.stringify(snapshot).includes("chat-"), false);
  assert.equal(JSON.stringify(snapshot).includes("viewer-"), false);
});
