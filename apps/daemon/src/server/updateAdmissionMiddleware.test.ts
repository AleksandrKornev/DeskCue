import express from "express";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import test from "node:test";

import type { DaemonApplication } from "#application/daemonApplication";
import { AppError } from "#application/errors";
import { errorHandler } from "#http/middleware/errorHandler";

import { installUpdateAdmissionMiddleware } from "./startDaemonServer.ts";

function listen(app: express.Express) {
  return new Promise<Server>((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function close(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test("update admission allows reads and rejects mutations while a drain is held", async () => {
  const app = express();
  const application = {
    assertUpdateAdmissionOpen() {
      throw new AppError("conflict", "DeskCue is preparing an update.");
    }
  } as unknown as DaemonApplication;

  installUpdateAdmissionMiddleware(app, application);
  app.get("/probe", (_request, response) => response.json({ ok: true }));
  app.post("/probe", (_request, response) => response.json({ ok: true }));
  app.use(errorHandler);
  const server = await listen(app);
  const address = server.address();

  assert.equal(typeof address, "object");
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    assert.equal((await fetch(`${baseUrl}/probe`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/probe`, { method: "POST" })).status, 409);
  } finally {
    await close(server);
  }
});
