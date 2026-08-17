import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import type { WebSocket } from "ws";

import { readWebSocketMetricsSnapshot, resetWebSocketMetricsForTests } from "./metrics.ts";
import {
  MAX_WEBSOCKET_BUFFERED_BYTES,
  MAX_WEBSOCKET_EVENT_BYTES,
  sendWebSocketPayload
} from "./outbound.ts";

type FakeSocket = {
  OPEN: number;
  bufferedAmount: number;
  readyState: number;
  sent: string[];
  terminated: boolean;
  send: (payload: string, callback: (error?: Error) => void) => void;
  terminate: () => void;
};

beforeEach(() => {
  resetWebSocketMetricsForTests();
});

function createFakeSocket(options: { bufferedAmount?: number; sendError?: Error } = {}): FakeSocket {
  return {
    OPEN: 1,
    bufferedAmount: options.bufferedAmount ?? 0,
    readyState: 1,
    sent: [],
    terminated: false,
    send(payload, callback) {
      this.sent.push(payload);
      callback(options.sendError);
    },
    terminate() {
      this.terminated = true;
    }
  };
}

test("outbound websocket delivery disconnects a slow client before adding more bytes", () => {
  const socket = createFakeSocket({
    bufferedAmount: MAX_WEBSOCKET_BUFFERED_BYTES
  });

  const sent = sendWebSocketPayload(socket as unknown as WebSocket, "payload", {
    cursor: "42",
    eventType: "session.updated"
  });

  assert.equal(sent, false);
  assert.equal(socket.terminated, true);
  assert.deepEqual(socket.sent, []);
  assert.equal(readWebSocketMetricsSnapshot().backpressureDisconnectCount, 1);
  assert.equal(readWebSocketMetricsSnapshot().droppedEventCount, 1);
});

test("outbound websocket delivery drops a single oversized event", () => {
  const socket = createFakeSocket();
  const sent = sendWebSocketPayload(
    socket as unknown as WebSocket,
    "x".repeat(MAX_WEBSOCKET_EVENT_BYTES + 1),
    { cursor: "43", eventType: "session.updated" }
  );

  assert.equal(sent, false);
  assert.equal(socket.terminated, false);
  assert.deepEqual(socket.sent, []);
  assert.equal(readWebSocketMetricsSnapshot().oversizedEventCount, 1);
});

test("outbound websocket delivery records accepted payloads", () => {
  const socket = createFakeSocket();
  const sent = sendWebSocketPayload(socket as unknown as WebSocket, "payload", {
    cursor: "44",
    eventType: "workspace.created"
  });

  assert.equal(sent, true);
  assert.deepEqual(socket.sent, ["payload"]);
  assert.equal(readWebSocketMetricsSnapshot().sentEventCount, 1);
  assert.equal(readWebSocketMetricsSnapshot().latestCursor, "44");
});

test("outbound websocket delivery contains asynchronous send errors", () => {
  const socket = createFakeSocket({ sendError: new Error("network failed") });
  const sent = sendWebSocketPayload(socket as unknown as WebSocket, "payload", {
    cursor: "45",
    eventType: "workspace.created"
  });

  assert.equal(sent, true);
  assert.equal(socket.terminated, true);
  assert.equal(readWebSocketMetricsSnapshot().sendErrorCount, 1);
});
