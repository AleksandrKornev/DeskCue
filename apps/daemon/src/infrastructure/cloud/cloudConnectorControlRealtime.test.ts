import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket, { WebSocketServer } from "ws";

import type { ServerEvent } from "@deskcue/protocol";
import type { DaemonEventBus } from "#application/ports";
import { SqliteDatabaseContext } from "#persistence/connection/sqliteConnection";
import { isValidCloudProcessLocalAuthorization } from "#security/cloudProcessLocalCredential";

import { CloudConnectorService } from "./cloudConnectorService.ts";

function sendControl(
  socket: WebSocket,
  requestId: string,
  commandId: string,
  input: Record<string, unknown>
) {
  const body = Buffer.from(JSON.stringify(input), "utf8");
  const bodySha256 = createHash("sha256").update(body).digest("hex");
  socket.send(JSON.stringify({
    type: "remote.control.request.start",
    protocolVersion: 1,
    requestId,
    commandId,
    operation: "managed.input",
    bodyBytes: body.byteLength,
    chunkCount: 1,
    bodySha256,
    deadlineAt: new Date(Date.now() + 10_000).toISOString(),
    sentAt: new Date().toISOString()
  }));
  socket.send(JSON.stringify({
    type: "remote.control.request.chunk",
    protocolVersion: 1,
    requestId,
    index: 0,
    data: body.toString("base64")
  }));
  socket.send(JSON.stringify({
    type: "remote.control.request.end",
    protocolVersion: 1,
    requestId,
    bodySha256,
    sentAt: new Date().toISOString()
  }));
}

function sendRealtimeClientMessage(
  socket: WebSocket,
  streamId: string,
  messageId: string,
  value: unknown
) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  const bodySha256 = createHash("sha256").update(body).digest("hex");
  socket.send(JSON.stringify({
    type: "remote.realtime.client.message.start",
    protocolVersion: 1,
    streamId,
    messageId,
    bodyBytes: body.byteLength,
    chunkCount: 1,
    bodySha256,
    sentAt: new Date().toISOString()
  }));
  socket.send(JSON.stringify({
    type: "remote.realtime.client.message.chunk",
    protocolVersion: 1,
    streamId,
    messageId,
    index: 0,
    data: body.toString("base64")
  }));
  socket.send(JSON.stringify({
    type: "remote.realtime.client.message.end",
    protocolVersion: 1,
    streamId,
    messageId,
    bodySha256,
    sentAt: new Date().toISOString()
  }));
}

class TestEventBus extends EventEmitter implements DaemonEventBus {
  publishServerEvent(event: ServerEvent) {
    this.emit("event", event);
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for Cloud connector state.");
}

async function readResponse(
  frames: Array<Record<string, unknown>>,
  identifier: string,
  prefix: string,
  identifierKey = "requestId"
) {
  await waitFor(() => frames.some((frame) =>
    frame.type === `${prefix}.end` && frame[identifierKey] === identifier
  ));
  const start = frames.find((frame) =>
    frame.type === `${prefix}.start` && frame[identifierKey] === identifier
  );
  assert.ok(start);
  const chunks = frames.filter((frame) =>
    frame.type === `${prefix}.chunk` && frame[identifierKey] === identifier
  ).sort((left, right) => Number(left.index) - Number(right.index));
  const body = Buffer.concat(chunks.map((frame) => Buffer.from(String(frame.data), "base64")));
  assert.equal(createHash("sha256").update(body).digest("hex"), start.bodySha256);
  return {
    status: typeof start.status === "number" ? start.status : null,
    body: JSON.parse(body.toString("utf8")) as unknown
  };
}

test("cloud connector deduplicates control and bridges bounded realtime bidirectionally", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-cloud-control-realtime-"));
  const context = new SqliteDatabaseContext(join(directory, "deskcue.sqlite"));
  const localServer = createServer();
  const localWebSockets = new WebSocketServer({ noServer: true });
  let localAuthorized = false;
  let localClientMessage: string | null = null;
  let localClosed = false;
  const slowUpgradeSockets = new Set<import("node:stream").Duplex>();
  localServer.on("upgrade", (request, socket, head) => {
    localAuthorized = isValidCloudProcessLocalAuthorization(request.headers.authorization);
    if (request.url?.includes("clientId=slow")) {
      slowUpgradeSockets.add(socket);
      socket.once("close", () => slowUpgradeSockets.delete(socket));
      return;
    }
    localWebSockets.handleUpgrade(request, socket, head, (websocket) => {
      localWebSockets.emit("connection", websocket, request);
    });
  });
  localWebSockets.on("connection", (socket, request) => {
    socket.send(request.url?.includes("clientId=backpressure")
      ? JSON.stringify({ type: "oversized.test", padding: "x".repeat(2_048) })
      : JSON.stringify({ type: "session.updated", payload: { id: "managed-1" } }));
    socket.on("message", (data) => {
      localClientMessage = data.toString();
    });
    socket.once("close", () => {
      localClosed = true;
    });
  });
  await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
  const localAddress = localServer.address();
  assert.ok(localAddress && typeof localAddress === "object");

  const relayFrames: Array<Record<string, unknown>> = [];
  let relaySocket: WebSocket | null = null;
  let relayBackpressureCloseCode: number | null = null;
  const cloudServer = createServer((request, response) => {
    if (request.url === "/machines/enroll") {
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({
        machine: { machineId: "mach_control" },
        machineCredential: "credential"
      }));
      return;
    }
    if (request.url === "/machines/mach_control/connections") {
      const address = cloudServer.address();
      assert.ok(address && typeof address === "object");
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({
        connectionToken: "connection-token",
        relayUrl: `ws://127.0.0.1:${address.port}/relay/machines/mach_control`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        cursors: { "session-summaries": 0 }
      }));
      return;
    }
    response.writeHead(404).end();
  });
  const relayWebSockets = new WebSocketServer({ noServer: true });
  cloudServer.on("upgrade", (request, socket, head) => {
    relayWebSockets.handleUpgrade(request, socket, head, (websocket) => {
      relayWebSockets.emit("connection", websocket, request);
    });
  });
  relayWebSockets.on("connection", (socket) => {
    relaySocket = socket;
    socket.once("close", (code) => {
      if (code === 1013) relayBackpressureCloseCode = code;
    });
    socket.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as Record<string, unknown>;
      relayFrames.push(frame);
      if (frame.type !== "relay.hello") return;
      assert.deepEqual(frame.capabilities, [
        "session.summary", "deskcue.read", "deskcue.realtime", "deskcue.files", "deskcue.control"
      ]);
      socket.send(JSON.stringify({
        type: "relay.welcome",
        protocolVersion: 1,
        connectionId: "connection_control",
        machineId: "mach_control",
        negotiatedCapabilities: [
          "session.summary", "deskcue.read", "deskcue.realtime", "deskcue.files", "deskcue.control"
        ],
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

  let controlExecutions = 0;
  let hangingControlStarted = false;
  let service = new CloudConnectorService(
    context,
    new TestEventBus(),
    { listLocalLlmChats: async () => [], listManagedSessions: () => [], listSourceSessions: async () => [] },
    {
      fetchImplementation: fetch,
      remoteReadExecutor: { execute: async () => ({ status: 200, body: {} }) },
      remoteControlExecutor: {
        async execute(_operation, input, shutdownSignal) {
          controlExecutions += 1;
          if ((input as { input?: string }).input === "hang") {
            hangingControlStarted = true;
            return await new Promise<never>((_, reject) => {
              if (shutdownSignal?.aborted) {
                reject(shutdownSignal.reason);
                return;
              }
              shutdownSignal?.addEventListener(
                "abort",
                () => reject(shutdownSignal.reason),
                { once: true }
              );
            });
          }
          return {
            status: 200,
            body: { id: "managed-1", workspaceId: "workspace-1", status: "running" }
          };
        }
      },
      remoteRealtimeDaemonOrigin: `http://127.0.0.1:${localAddress.port}`,
      cloudMaxBufferedBytes: 1_024
    }
  );
  try {
    service.start();
    await service.connect({
      cloudOrigin: `http://127.0.0.1:${cloudAddress.port}`,
      displayName: "Control machine",
      enrollmentTicket: "ticket-placeholder",
      allowRemoteRead: true,
      allowRemoteFiles: true,
      allowRemoteControl: true,
      allowRemotePreview: false
    });
    await waitFor(() => service.getStatus().connected && relaySocket !== null);
    assert.equal(service.getStatus().remoteControlEnabled, true);

    sendControl(relaySocket!, "request_control_1", "command_stable_1", {
      sessionId: "managed-1",
      input: "continue"
    });
    const initial = await readResponse(relayFrames, "request_control_1", "remote.control.response");
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.body, {
      id: "managed-1",
      workspaceId: "workspace-1",
      status: "running"
    });
    assert.equal(controlExecutions, 1);

    sendControl(relaySocket!, "request_control_2", "command_stable_1", {
      sessionId: "managed-1",
      input: "continue"
    });
    const replay = await readResponse(relayFrames, "request_control_2", "remote.control.response");
    assert.deepEqual(replay.body, { accepted: true, sessionId: "managed-1" });
    assert.equal(controlExecutions, 1);

    sendControl(relaySocket!, "request_control_3", "command_stable_1", {
      sessionId: "managed-1",
      input: "different"
    });
    assert.equal(
      (await readResponse(relayFrames, "request_control_3", "remote.control.response")).status,
      409
    );
    assert.equal(controlExecutions, 1);

    sendControl(relaySocket!, "request_control_4", "command_pending_1", {
      sessionId: "managed-1",
      input: "hang"
    });
    await waitFor(() => hangingControlStarted);
    await service.close();
    relaySocket = null;
    service = new CloudConnectorService(
      context,
      new TestEventBus(),
      { listLocalLlmChats: async () => [], listManagedSessions: () => [], listSourceSessions: async () => [] },
      {
        fetchImplementation: fetch,
        remoteReadExecutor: { execute: async () => ({ status: 200, body: {} }) },
        remoteControlExecutor: {
          async execute() {
            controlExecutions += 1;
            return { status: 500, body: { error: "must_not_execute_after_restart" } };
          }
        },
        remoteRealtimeDaemonOrigin: `http://127.0.0.1:${localAddress.port}`,
        cloudMaxBufferedBytes: 1_024
      }
    );
    service.start();
    await waitFor(() => service.getStatus().connected && relaySocket !== null);
    sendControl(relaySocket!, "request_control_5", "command_pending_1", {
      sessionId: "managed-1",
      input: "hang"
    });
    const ambiguous = await readResponse(
      relayFrames,
      "request_control_5",
      "remote.control.response"
    );
    assert.equal(ambiguous.status, 409);
    assert.deepEqual(ambiguous.body, { error: "remote_control_outcome_unknown" });
    assert.equal(controlExecutions, 2);
    const durableReceipts = context.database.prepare(`
      SELECT operation, input_sha256 AS inputSha256, response_json AS responseJson, outcome
      FROM cloud_control_receipts ORDER BY command_id
    `).all();
    const durableJson = JSON.stringify(durableReceipts);
    for (const privateInput of ["continue", "different", "hang"]) {
      assert.equal(durableJson.includes(privateInput), false);
    }
    assert.equal(durableJson.includes("managed-1"), true);

    relaySocket!.send(JSON.stringify({
      type: "remote.realtime.open",
      protocolVersion: 1,
      streamId: "stream_cloud_1",
      path: "/ws?protocolVersion=1&protocolCapability=cursor-replay",
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      sentAt: new Date().toISOString()
    }));
    await waitFor(() => relayFrames.some((frame) =>
      frame.type === "remote.realtime.opened" && frame.streamId === "stream_cloud_1"
    ));
    assert.equal(localAuthorized, true);
    const serverMessage = await readResponse(
      relayFrames,
      "stream_cloud_1",
      "remote.realtime.server.message",
      "streamId"
    );
    assert.deepEqual(serverMessage.body, {
      type: "session.updated",
      payload: { id: "managed-1" }
    });

    sendRealtimeClientMessage(relaySocket!, "stream_cloud_1", "message_cloud_1", {
      type: "ack",
      cursor: "cursor-1"
    });
    await waitFor(() => localClientMessage !== null);
    assert.deepEqual(JSON.parse(localClientMessage!), { type: "ack", cursor: "cursor-1" });
    relaySocket!.send(JSON.stringify({
      type: "remote.realtime.close",
      protocolVersion: 1,
      streamId: "stream_cloud_1",
      code: 1000,
      reason: "done",
      sentAt: new Date().toISOString()
    }));
    await waitFor(() => localClosed);

    relaySocket!.send(JSON.stringify({
      type: "remote.realtime.open",
      protocolVersion: 1,
      streamId: "stream_slow_1",
      path: "/ws?protocolVersion=1&protocolCapability=cursor-replay&clientId=slow",
      deadlineAt: new Date(Date.now() + 50).toISOString(),
      sentAt: new Date().toISOString()
    }));
    await waitFor(() => relayFrames.some((frame) =>
      frame.type === "remote.realtime.closed" && frame.streamId === "stream_slow_1"
    ));

    relaySocket!.send(JSON.stringify({
      type: "remote.realtime.open",
      protocolVersion: 1,
      streamId: "stream_backpressure_1",
      path: "/ws?protocolVersion=1&protocolCapability=cursor-replay&clientId=backpressure",
      deadlineAt: new Date(Date.now() + 5_000).toISOString(),
      sentAt: new Date().toISOString()
    }));
    await waitFor(() => relayBackpressureCloseCode === 1013);
  } finally {
    await service.close();
    for (const socket of slowUpgradeSockets) socket.destroy();
    await new Promise<void>((resolve) => relayWebSockets.close(() => resolve()));
    await new Promise<void>((resolve) => cloudServer.close(() => resolve()));
    await new Promise<void>((resolve) => localWebSockets.close(() => resolve()));
    await new Promise<void>((resolve) => localServer.close(() => resolve()));
    context.close();
    await rm(directory, { force: true, recursive: true });
  }
});
