import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import { WebSocketServer } from "ws";

import { isValidCloudProcessLocalAuthorization } from "#security/cloudProcessLocalCredential";

import { CloudRemoteRealtimeBridge } from "./cloudRemoteRealtimeBridge.ts";

test("cloud remote realtime bridge rejects non-loopback daemon origins", () => {
  assert.throws(
    () => new CloudRemoteRealtimeBridge({
      daemonOrigin: "http://localhost:4100",
      sendCloudFrame: () => true
    }),
    /trusted loopback daemon origin/
  );
});

function readMessage(frames: Array<Record<string, unknown>>, prefix: string) {
  const start = frames.find((frame) => frame.type === `${prefix}.start`);
  assert.ok(start);
  const chunks = frames
    .filter((frame) => frame.type === `${prefix}.chunk`)
    .sort((left, right) => Number(left.index) - Number(right.index));
  const body = Buffer.concat(chunks.map((frame) => Buffer.from(String(frame.data), "base64")));
  assert.equal(createHash("sha256").update(body).digest("hex"), start.bodySha256);
  return JSON.parse(body.toString("utf8")) as unknown;
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for remote realtime bridge state.");
}

test("cloud remote realtime bridge forwards bounded JSON messages in both directions", async () => {
  const server = createServer();
  const webSockets = new WebSocketServer({ noServer: true });
  let internalAuthorizationAccepted = false;
  let localClientMessage: string | null = null;
  let localSocketClosed = false;
  server.on("upgrade", (request, socket, head) => {
    internalAuthorizationAccepted = isValidCloudProcessLocalAuthorization(
      request.headers.authorization
    );
    webSockets.handleUpgrade(request, socket, head, (websocket) => {
      webSockets.emit("connection", websocket, request);
    });
  });
  webSockets.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "session.updated", payload: { id: "session-1" } }));
    socket.on("message", (data) => {
      localClientMessage = data.toString();
    });
    socket.once("close", () => {
      localSocketClosed = true;
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const cloudFrames: Array<Record<string, unknown>> = [];
  const bridge = new CloudRemoteRealtimeBridge({
    daemonOrigin: `http://127.0.0.1:${address.port}`,
    sendCloudFrame(frame) {
      cloudFrames.push(frame as Record<string, unknown>);
      return true;
    }
  });

  try {
    bridge.handleFrame({
      type: "remote.realtime.open",
      protocolVersion: 1,
      streamId: "stream-1",
      path: "/ws?protocolVersion=1&protocolCapability=cursor-replay",
      deadlineAt: new Date(Date.now() + 5_000).toISOString(),
      sentAt: new Date().toISOString()
    });
    await waitFor(() => cloudFrames.some((frame) =>
      frame.type === "remote.realtime.server.message.end"
    ));
    assert.equal(internalAuthorizationAccepted, true);
    assert.ok(cloudFrames.some((frame) => frame.type === "remote.realtime.opened"));
    assert.deepEqual(readMessage(cloudFrames, "remote.realtime.server.message"), {
      type: "session.updated",
      payload: { id: "session-1" }
    });

    const clientBody = Buffer.from(JSON.stringify({ type: "ack", cursor: "cursor-1" }), "utf8");
    const clientDigest = createHash("sha256").update(clientBody).digest("hex");
    bridge.handleFrame({
      type: "remote.realtime.client.message.start",
      protocolVersion: 1,
      streamId: "stream-1",
      messageId: "message-1",
      bodyBytes: clientBody.byteLength,
      chunkCount: 1,
      bodySha256: clientDigest,
      sentAt: new Date().toISOString()
    });
    bridge.handleFrame({
      type: "remote.realtime.client.message.chunk",
      protocolVersion: 1,
      streamId: "stream-1",
      messageId: "message-1",
      index: 0,
      data: clientBody.toString("base64")
    });
    bridge.handleFrame({
      type: "remote.realtime.client.message.end",
      protocolVersion: 1,
      streamId: "stream-1",
      messageId: "message-1",
      bodySha256: clientDigest,
      sentAt: new Date().toISOString()
    });
    await waitFor(() => localClientMessage !== null);
    assert.deepEqual(JSON.parse(localClientMessage!), { type: "ack", cursor: "cursor-1" });

    bridge.closeAll();
    await waitFor(() => localSocketClosed);
  } finally {
    bridge.closeAll();
    await new Promise<void>((resolve) => webSockets.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
