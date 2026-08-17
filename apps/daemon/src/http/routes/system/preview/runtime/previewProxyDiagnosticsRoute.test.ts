import express from "express";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import test from "node:test";

import type { PreviewProxyDiagnosticsSnapshot } from "@deskcue/protocol";

import { PreviewProxyController } from "../previewProxy.ts";
import { PREVIEW_PROXY_LIMITS } from "../previewProxyLimits.ts";

function listen(server: Server) {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP server address.");
      resolve(address.port);
    });
  });
}

function close(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test("preview diagnostics route exposes bounded aggregate data without owner identifiers", async () => {
  const app = express();
  const controller = new PreviewProxyController({
    authRequired: () => false,
    resolveTarget: async () => null
  });
  controller.installTicketRoute(app);
  const server = createServer(app);
  controller.attach(server);
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/preview/diagnostics`);
    const payload = await response.json() as PreviewProxyDiagnosticsSnapshot;
    assert.equal(response.status, 200);
    assert.equal(payload.admission.activeHttpRequests, 0);
    assert.equal(payload.latency.sampleLimit, 256);
    assert.equal(payload.limits.httpGlobal > payload.limits.httpPerViewer, true);
    assert.equal(Object.hasOwn(payload, "owners"), false);
    assert.equal(Object.hasOwn(payload, "viewers"), false);
  } finally {
    await controller.close();
    await close(server);
  }
});

test("preview controller applies the per-viewer HTTP cap before the global cap", async () => {
  let releaseResponses = () => {};
  let signalArrived = () => {};
  const arrived = new Promise<void>((resolve) => {
    signalArrived = resolve;
  });
  const heldResponses: import("node:http").ServerResponse[] = [];
  const target = createServer((_request, response) => {
    heldResponses.push(response);
    if (heldResponses.length === PREVIEW_PROXY_LIMITS.maxConcurrentRequestsPerViewer) {
      signalArrived();
    }
  });
  const targetPort = await listen(target);
  const app = express();
  const controller = new PreviewProxyController({
    authRequired: () => false,
    resolveTarget: async () => ({
      networkMode: "device-direct",
      origin: `http://127.0.0.1:${targetPort}`,
      port: targetPort
    })
  });
  controller.installProxyRoutes(app);
  const server = createServer(app);
  controller.attach(server);
  const proxyPort = await listen(server);

  try {
    const activeRequests = Array.from(
      { length: PREVIEW_PROXY_LIMITS.maxConcurrentRequestsPerViewer },
      (_, index) => fetch(`http://127.0.0.1:${proxyPort}/api/preview/sessions/chat-${index}/hold`)
    );
    await arrived;
    const rejected = await fetch(
      `http://127.0.0.1:${proxyPort}/api/preview/sessions/one-more-chat/hold`
    );
    assert.equal(rejected.status, 503);
    assert.deepEqual(await rejected.json(), {
      error: "Preview proxy is busy. Try again shortly."
    });

    releaseResponses = () => {
      for (const response of heldResponses) response.end("ok");
    };
    releaseResponses();
    assert.equal((await Promise.all(activeRequests)).every((response) => response.status === 200), true);
    const diagnostics = controller.readDiagnostics();
    assert.equal(diagnostics.totals.rejectedHttp.viewer, 1);
    assert.equal(diagnostics.admission.activeHttpRequests, 0);
  } finally {
    releaseResponses();
    await controller.close();
    await close(server);
    await close(target);
  }
});
