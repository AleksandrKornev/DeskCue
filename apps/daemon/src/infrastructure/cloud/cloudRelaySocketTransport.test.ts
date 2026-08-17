import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { WebSocketServer } from "ws";

import {
  CLOUD_RELAY_CAPABILITY,
  CLOUD_RELAY_PROTOCOL_VERSION,
  CLOUD_RELAY_STREAM
} from "@deskcue/protocol";

import { CloudRelaySocketTransport } from "./connector/cloudRelaySocketTransport.ts";

test("Cloud relay transport bounds sends and isolates socket callbacks", async () => {
  const server = createServer();
  const sockets = new WebSocketServer({ noServer: true });
  let receiveHello!: () => void;
  const helloReceived = new Promise<void>((resolve) => {
    receiveHello = resolve;
  });
  let closeSocket!: (code: number) => void;
  const socketClosed = new Promise<number>((resolve) => {
    closeSocket = resolve;
  });
  server.on("upgrade", (request, socket, head) => {
    sockets.handleUpgrade(request, socket, head, (websocket) => {
      sockets.emit("connection", websocket, request);
    });
  });
  sockets.on("connection", (socket) => {
    socket.once("message", () => receiveHello());
    socket.once("close", (code) => closeSocket(code));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const transport = new CloudRelaySocketTransport(64 * 1024);
  const failures: string[] = [];
  let oversizedHookCalls = 0;
  const session = transport.open({
    connection: {
      connectionToken: "connection-token-placeholder",
      relayUrl: `ws://127.0.0.1:${address.port}/relay/machines/machine-test`,
      expiresAt: "2026-08-11T12:00:00.000Z",
      cursors: { [CLOUD_RELAY_STREAM]: 0 }
    },
    isCurrent: () => true,
    createHello: () => ({
      type: "relay.hello",
      protocolVersion: CLOUD_RELAY_PROTOCOL_VERSION,
      machineId: "machine-test",
      daemonVersion: "test-version",
      capabilities: [CLOUD_RELAY_CAPABILITY],
      resume: [{ stream: CLOUD_RELAY_STREAM, ackedSequence: 0 }],
      sentAt: "2026-08-11T10:00:00.000Z"
    }),
    onFrame: () => undefined,
    onEventFailure: ({ errorCode }) => {
      failures.push(errorCode);
      throw new Error("secondary recovery failed");
    },
    onClose: () => {
      throw new Error("close callback failed");
    }
  });

  try {
    await session.opened;
    await helloReceived;
    assert.equal(transport.sendJson(session.socket, { padding: "x".repeat(20_000) }, {
      onFrameTooLarge: () => {
        oversizedHookCalls += 1;
        throw new Error("oversized callback failed");
      }
    }), false);
    assert.equal(await socketClosed, 1009);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(oversizedHookCalls, 1);
    assert.deepEqual(failures, ["relay_close_handler_failed"]);
  } finally {
    transport.close(session.socket, 1000, "test complete");
    await new Promise<void>((resolve) => sockets.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
