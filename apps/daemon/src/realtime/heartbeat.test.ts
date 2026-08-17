import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { WebSocket } from "ws";

import { WebSocketHeartbeat } from "./heartbeat.ts";

class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readonly readyState = 1;
  pingCount = 0;
  terminateCount = 0;

  ping() {
    this.pingCount += 1;
  }

  terminate() {
    this.terminateCount += 1;
  }
}

test("heartbeat pings alive sockets and terminates stale sockets", () => {
  const socket = new FakeSocket();
  const heartbeat = new WebSocketHeartbeat(new Set([socket as unknown as WebSocket]));

  heartbeat.add(socket as unknown as WebSocket);
  heartbeat.checkNow();

  assert.equal(socket.pingCount, 1);
  assert.equal(socket.terminateCount, 0);

  heartbeat.checkNow();

  assert.equal(socket.pingCount, 1);
  assert.equal(socket.terminateCount, 1);
  heartbeat.close();
});
