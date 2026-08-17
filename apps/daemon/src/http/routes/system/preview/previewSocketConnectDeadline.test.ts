import assert from "node:assert/strict";
import { Socket } from "node:net";
import test from "node:test";

import { waitForPreviewSocketConnect } from "./previewSocketConnectDeadline.ts";

test("shares one connect listener across concurrent requests on one socket", () => {
  const socket = new Socket();
  Object.defineProperty(socket, "connecting", { configurable: true, value: true });
  let settled = 0;

  for (let index = 0; index < 20; index += 1) {
    waitForPreviewSocketConnect(socket, () => { settled += 1; });
  }

  assert.equal(socket.listenerCount("connect"), 1);
  assert.equal(socket.listenerCount("close"), 1);
  socket.emit("connect");
  assert.equal(settled, 20);
  assert.equal(socket.listenerCount("connect"), 0);
  assert.equal(socket.listenerCount("close"), 0);
  socket.destroy();
});

test("settles immediately when a keep-alive socket is already connected", () => {
  const socket = new Socket();
  let settled = 0;

  waitForPreviewSocketConnect(socket, () => { settled += 1; });

  assert.equal(settled, 1);
  assert.equal(socket.listenerCount("connect"), 0);
  socket.destroy();
});
