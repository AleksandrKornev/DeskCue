import type express from "express";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import test from "node:test";

import { configureHttpServer, HTTP_SERVER_LIMITS, listenWithRetry } from "./listen.ts";

test("listen failures reject to the entrypoint instead of terminating the process", async () => {
  const expected = Object.assign(new Error("permission denied"), { code: "EACCES" });
  const app = {
    listen() {
      const server = new EventEmitter();
      queueMicrotask(() => server.emit("error", expected));
      return server;
    }
  } as unknown as express.Express;

  await assert.rejects(listenWithRetry(app, 41_000, "127.0.0.1"), expected);
});

test("configures bounded HTTP connection and request lifetimes", () => {
  const server = createServer();
  configureHttpServer(server);
  assert.equal(server.headersTimeout, HTTP_SERVER_LIMITS.headersTimeoutMs);
  assert.equal(server.keepAliveTimeout, HTTP_SERVER_LIMITS.keepAliveTimeoutMs);
  assert.equal(server.maxRequestsPerSocket, HTTP_SERVER_LIMITS.maxRequestsPerSocket);
  assert.equal(server.requestTimeout, HTTP_SERVER_LIMITS.requestTimeoutMs);
});
