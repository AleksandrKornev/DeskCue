import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WebSocketServer } from "ws";

import type { CloudPreviewClientFrame, ServerEvent } from "@deskcue/protocol";
import type { DaemonEventBus } from "#application/ports";
import { SqliteDatabaseContext } from "#persistence/connection/sqliteConnection";

import { CloudConnectorService, deriveCloudPreviewDataUrl } from "./cloudConnectorService.ts";

const emptySha256 = createHash("sha256").update("").digest("hex");

test("Preview data URL is derived from the exact validated machine relay path", () => {
  assert.equal(
    deriveCloudPreviewDataUrl("wss://cloud.example.test/relay/machines/machine-1"),
    "wss://cloud.example.test/relay/machines/machine-1/preview"
  );
  assert.throws(
    () => deriveCloudPreviewDataUrl("wss://other.example.test/custom/preview"),
    /connection_invalid_relay_url/
  );
  assert.throws(
    () => deriveCloudPreviewDataUrl("wss://cloud.example.test/relay/machines/machine-1?next=evil"),
    /connection_invalid_relay_url/
  );
});

class TestEventBus extends EventEmitter implements DaemonEventBus {
  publishServerEvent(event: ServerEvent) {
    this.emit("event", event);
  }
}

test("cloud connector opens a separately authenticated Preview socket and proxies loopback HTTP", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-cloud-preview-data-"));
  const context = new SqliteDatabaseContext(join(directory, "deskcue.sqlite"));
  const previewServer = createServer((request, response) => {
    assert.equal(request.url, "/asset?x=1");
    assert.equal(request.headers.authorization, undefined);
    response.writeHead(206, {
      "content-type": "text/plain",
      "content-range": "bytes 0-1/2",
      "set-cookie": "must-not-cross=1"
    });
    response.end("ok");
  });
  await new Promise<void>((resolve) => previewServer.listen(0, "localhost", resolve));
  const previewAddress = previewServer.address();
  assert.ok(previewAddress && typeof previewAddress === "object");

  let connectionTokenCount = 0;
  const responseFrames: CloudPreviewClientFrame[] = [];
  let resolvePreviewResponse!: () => void;
  const previewResponse = new Promise<void>((resolve) => { resolvePreviewResponse = resolve; });
  const cloudServer = createServer((request, response) => {
    if (request.url === "/machines/enroll") {
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({
        machine: { machineId: "mach_preview" },
        machineCredential: "machine-credential-placeholder"
      }));
      return;
    }
    if (request.url === "/machines/mach_preview/connections") {
      connectionTokenCount += 1;
      const address = cloudServer.address();
      assert.ok(address && typeof address === "object");
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({
        connectionToken: `connection-token-placeholder-${connectionTokenCount}`,
        relayUrl: `ws://127.0.0.1:${address.port}/relay/machines/mach_preview`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        cursors: { "session-summaries": 0 }
      }));
      return;
    }
    response.writeHead(404).end();
  });
  const websocketServer = new WebSocketServer({ noServer: true });
  cloudServer.on("upgrade", (request, socket, head) => {
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request);
    });
  });
  websocketServer.on("connection", (socket, request) => {
    if (request.url === "/relay/machines/mach_preview/preview") {
      assert.equal(request.headers.authorization, "Bearer connection-token-placeholder-2");
      socket.send(JSON.stringify({
        type: "preview.http.request.start",
        protocolVersion: 1,
        streamId: "preview_http_01",
        owner: { kind: "session", ownerId: "session-1" },
        viewerId: "abcdefghijklmnopqrstuvwx",
        method: "GET",
        path: "/asset?x=1",
        headers: [["accept", "text/plain"]],
        contentLength: 0,
        deadlineAt: new Date(Date.now() + 10_000).toISOString(),
        sentAt: new Date().toISOString()
      }));
      let requestEnded = false;
      socket.on("message", (data) => {
        const frame = JSON.parse(data.toString()) as CloudPreviewClientFrame;
        responseFrames.push(frame);
        if (frame.type === "preview.flow.credit" && frame.direction === "http.request" && !requestEnded) {
          requestEnded = true;
          socket.send(JSON.stringify({
            type: "preview.http.request.end",
            protocolVersion: 1,
            streamId: "preview_http_01",
            bodyBytes: 0,
            chunkCount: 0,
            bodySha256: emptySha256,
            sentAt: new Date().toISOString()
          }));
        }
        if (frame.type === "preview.http.response.start") {
          assert.equal(frame.status, 206);
          assert.deepEqual(
            frame.headers.find(([name]) => name === "set-cookie"),
            ["set-cookie", "must-not-cross=1; Path=/"]
          );
          socket.send(JSON.stringify({
            type: "preview.flow.credit",
            protocolVersion: 1,
            streamId: frame.streamId,
            direction: "http.response",
            creditBytes: 1024,
            sentAt: new Date().toISOString()
          }));
        }
        if (frame.type === "preview.http.response.end") resolvePreviewResponse();
      });
      return;
    }
    assert.equal(request.url, "/relay/machines/mach_preview");
    assert.equal(request.headers.authorization, "Bearer connection-token-placeholder-1");
    socket.once("message", (data) => {
      const hello = JSON.parse(data.toString()) as { type?: string; capabilities?: string[] };
      assert.equal(hello.type, "relay.hello");
      assert.ok(hello.capabilities?.includes("deskcue.preview"));
      socket.send(JSON.stringify({
        type: "relay.welcome",
        protocolVersion: 1,
        connectionId: "connection_preview",
        machineId: "mach_preview",
        negotiatedCapabilities: ["session.summary", "deskcue.preview"],
        streamPositions: [{ stream: "session-summaries", nextSequence: 1 }],
        heartbeatIntervalMs: 30_000,
        maxFrameBytes: 16_384,
        connectedAt: new Date().toISOString()
      }));
    });
  });
  await new Promise<void>((resolve) => cloudServer.listen(0, "127.0.0.1", resolve));
  const cloudAddress = cloudServer.address();
  assert.ok(cloudAddress && typeof cloudAddress === "object");

  const service = new CloudConnectorService(
    context,
    new TestEventBus(),
    {
      listLocalLlmChats: async () => [],
      listManagedSessions: () => [],
      listSourceSessions: async () => []
    },
    {
      fetchImplementation: fetch,
      previewTargetResolver: async () => ({
        networkMode: "device-direct",
        origin: `http://localhost:${previewAddress.port}`,
        port: previewAddress.port
      })
    }
  );
  try {
    service.start();
    await service.connect({
      cloudOrigin: `http://127.0.0.1:${cloudAddress.port}`,
      displayName: "Preview machine",
      enrollmentTicket: "ticket-placeholder",
      allowRemoteRead: false,
      allowRemoteFiles: false,
      allowRemoteControl: false,
      allowRemotePreview: true
    });
    await Promise.race([
      previewResponse,
      new Promise((_, reject) => setTimeout(() => reject(new Error("preview response timeout")), 5_000))
    ]);
    const chunks = responseFrames.filter(
      (frame) => frame.type === "preview.http.response.chunk"
    );
    assert.equal(responseFrames[0]?.type, "preview.flow.credit");
    assert.equal(Buffer.concat(chunks.map((frame) => Buffer.from(frame.data, "base64"))).toString(), "ok");
    assert.equal(connectionTokenCount, 2);
  } finally {
    await service.close();
    await new Promise<void>((resolve) => websocketServer.close(() => resolve()));
    await new Promise<void>((resolve) => cloudServer.close(() => resolve()));
    await new Promise<void>((resolve) => previewServer.close(() => resolve()));
    context.close();
    await rm(directory, { force: true, recursive: true });
  }
});
