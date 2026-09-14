import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  encodeHostControlFrame,
  encodeHostControlRequestFrame,
  HOST_CONTROL_PROTOCOL_VERSION,
  readOrCreateHostControlToken,
  requestHostControl,
  resolveHostControlEndpoint,
  resolveHostControlPaths
} from "@deskcue/host-control";
import type { HostStatus } from "@deskcue/host-control";

import { createHostControlServer } from "./controlServer.ts";
import { HostOperationError } from "./hostOperationError.ts";

function createTestStatus(): HostStatus {
  return {
    autostart: { enabled: null, supported: false },
    busyReason: null,
    capabilities: {},
    daemon: {
      baseUrl: "http://127.0.0.1:4100",
      generation: "generation-1",
      lastError: null,
      pid: 123,
      port: 4100,
      restartAttempt: 0,
      state: "running",
      version: "0.1.1"
    },
    host: {
      pid: 456,
      startedAt: "2026-09-13T00:00:00.000Z",
      state: "running",
      version: "0.1.1"
    },
    update: { availableVersion: null, lastError: null, state: "idle" }
  };
}

test("host control server authenticates and returns bounded status", async () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-host-server-"));
  const paths = resolveHostControlPaths(root);
  const token = readOrCreateHostControlToken(paths.controlTokenFilePath);
  const endpoint = resolveHostControlEndpoint(token, paths);
  const status = createTestStatus();
  const server = createHostControlServer({ endpoint, handle: async () => status, token });

  try {
    await server.listen();
    const response = await requestHostControl({ paths, request: { method: "status" } });

    assert.equal(response.ok, true);
    if (response.ok) assert.deepEqual(response.result.status, status);
  } finally {
    await server.close();
    rmSync(root, { force: true, recursive: true });
  }
});

test("host control client uses one token snapshot across asynchronous connect", async () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-host-server-token-snapshot-"));
  const paths = resolveHostControlPaths(root);
  const token = readOrCreateHostControlToken(paths.controlTokenFilePath);
  const endpoint = resolveHostControlEndpoint(token, paths);
  const status = createTestStatus();
  const server = createHostControlServer({ endpoint, handle: async () => status, token });

  try {
    await server.listen();
    const pending = requestHostControl({ paths, request: { method: "status" } });

    writeFileSync(paths.controlTokenFilePath, "invalid-rotated-token\n", "utf8");

    const response = await pending;

    assert.equal(response.ok, true);
  } finally {
    await server.close();
    rmSync(root, { force: true, recursive: true });
  }
});

test("host control server rejects a later frame before invoking the handler", async () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-host-server-split-frame-"));
  const paths = resolveHostControlPaths(root);
  const token = readOrCreateHostControlToken(paths.controlTokenFilePath);
  const endpoint = resolveHostControlEndpoint(token, paths);
  const status = createTestStatus();
  let calls = 0;
  const server = createHostControlServer({
    endpoint,
    handle: async () => {
      calls += 1;
      return status;
    },
    token
  });

  try {
    await server.listen();
    const responseText = await new Promise<string>((resolve, reject) => {
      const socket = net.createConnection(endpoint);
      let received = "";

      socket.setEncoding("utf8");

      socket.on("data", (chunk) => {
        received += chunk;
      });

      socket.once("error", reject);
      socket.once("end", () => resolve(received));

      socket.once("connect", () => {
        socket.write(encodeHostControlFrame({
          id: "split-request",
          method: "daemon.stop",
          protocolVersion: HOST_CONTROL_PROTOCOL_VERSION,
          token
        }));
        setImmediate(() => socket.write("junk\n"));
      });
    });

    assert.equal(calls, 0);
    assert.match(responseText, /exactly one terminated request/u);
  } finally {
    await server.close();
    rmSync(root, { force: true, recursive: true });
  }
});

test("host control server preserves a committed response when bytes follow the terminal marker", async () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-host-server-after-commit-"));
  const paths = resolveHostControlPaths(root);
  const token = readOrCreateHostControlToken(paths.controlTokenFilePath);
  const endpoint = resolveHostControlEndpoint(token, paths);
  const status = createTestStatus();
  let calls = 0;
  const server = createHostControlServer({
    endpoint,
    handle: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return status;
    },
    token
  });

  try {
    await server.listen();
    const responseText = await new Promise<string>((resolve, reject) => {
      const socket = net.createConnection(endpoint);
      let received = "";

      socket.setEncoding("utf8");

      socket.on("data", (chunk) => {
        received += chunk;
      });

      socket.once("error", reject);
      socket.once("end", () => resolve(received));

      socket.once("connect", () => {
        socket.write(encodeHostControlRequestFrame({
          id: "committed-request",
          method: "status",
          protocolVersion: HOST_CONTROL_PROTOCOL_VERSION,
          token
        }));
        setImmediate(() => socket.write("ignored-after-commit\n"));
      });
    });

    assert.equal(calls, 1);
    assert.match(responseText, /"ok":true/u);
    assert.doesNotMatch(responseText, /"ok":false/u);
  } finally {
    await server.close();
    rmSync(root, { force: true, recursive: true });
  }
});

test("host control server preserves typed operation details", async () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-host-server-error-"));
  const paths = resolveHostControlPaths(root);
  const token = readOrCreateHostControlToken(paths.controlTokenFilePath);
  const endpoint = resolveHostControlEndpoint(token, paths);
  const server = createHostControlServer({
    endpoint,
    handle: async () => {
      throw new HostOperationError(
        "update_blocked",
        "DeskCue cannot update while work is active.",
        false,
        { blockers: [{ code: "active_turns", count: 1 }] }
      );
    },
    token
  });

  try {
    await server.listen();
    const response = await requestHostControl({ paths, request: { method: "update.apply" } });

    assert.equal(response.ok, false);
    if (!response.ok) {
      assert.equal(response.error.code, "update_blocked");
      assert.deepEqual(response.error.details, {
        blockers: [{ code: "active_turns", count: 1 }]
      });
    }
  } finally {
    await server.close();
    rmSync(root, { force: true, recursive: true });
  }
});
