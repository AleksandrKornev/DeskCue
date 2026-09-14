import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  BoundedHostControlRequestDecoder,
  BoundedNdjsonDecoder,
  HostControlConnectionClosedError,
  HostControlTokenReadError,
  HOST_CONTROL_MAX_FRAME_BYTES,
  HOST_CONTROL_PROTOCOL_VERSION,
  HOST_CONTROL_REQUEST_END_MARKER,
  parseHostControlRequest,
  parseHostControlResponse,
  readOrCreateHostControlToken,
  requestHostControl,
  resolveDeskCueDataRoot,
  resolveHostControlEndpoint,
  resolveHostControlPaths
} from "../dist/index.js";

test("installed data root is stable and independent of cwd", () => {
  const first = resolveDeskCueDataRoot({
    cwd: "C:\\one",
    env: { DESKCUE_DISTRIBUTION_MODE: "installed", LOCALAPPDATA: "C:\\Users\\A\\AppData\\Local" },
    homeDir: "C:\\Users\\A",
    platform: "win32"
  });
  const second = resolveDeskCueDataRoot({
    cwd: "D:\\two",
    env: { DESKCUE_DISTRIBUTION_MODE: "installed", LOCALAPPDATA: "C:\\Users\\A\\AppData\\Local" },
    homeDir: "C:\\Users\\A",
    platform: "win32"
  });

  assert.equal(first, second);
  assert.match(first, /DeskCue[\\/]data$/);
});

test("source data root is stable when callers run from different workspace package directories", () => {
  const first = resolveDeskCueDataRoot({
    env: {},
    moduleUrl: "file:///D:/work/DeskCue/packages/host-control/dist/paths.js"
  });
  const second = resolveDeskCueDataRoot({
    env: {},
    moduleUrl: "file:///D:/work/DeskCue/packages/host-control/dist/paths.js"
  });

  assert.equal(first, second);
  assert.match(first, /DeskCue[\\/].deskcue-data$/u);
});

test("control token creation is durable and endpoint contains no token", () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-host-control-"));
  try {
    const paths = resolveHostControlPaths(root);
    const token = readOrCreateHostControlToken(paths.controlTokenFilePath);

    assert.equal(readOrCreateHostControlToken(paths.controlTokenFilePath), token);
    assert.equal(resolveHostControlEndpoint(token, paths).includes(token), false);
    assert.equal(resolveHostControlEndpoint("a".repeat(32), paths), resolveHostControlEndpoint("b".repeat(32), paths));
    assert.notEqual(
      resolveHostControlEndpoint(token, paths),
      resolveHostControlEndpoint(token, resolveHostControlPaths(join(root, "other-data")))
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("request identifies a token read failure separately from endpoint absence", async () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-host-control-missing-token-"));

  try {
    await assert.rejects(
      requestHostControl({ paths: resolveHostControlPaths(root), request: { method: "status" } }),
      (error) => error instanceof HostControlTokenReadError && error.code === "host_control_token_read_failed"
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("request identifies a connection that closes without a response", async () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-host-control-empty-response-"));
  const paths = resolveHostControlPaths(root);
  const token = readOrCreateHostControlToken(paths.controlTokenFilePath);
  const endpoint = resolveHostControlEndpoint(token, paths);
  let acceptedSocket = null;
  const server = net.createServer((socket) => {
    acceptedSocket = socket;
    socket.end();
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint, resolve);
  });

  try {
    await assert.rejects(
      requestHostControl({ paths, request: { method: "status" } }),
      (error) => error instanceof HostControlConnectionClosedError
    );
  } finally {
    acceptedSocket?.destroy();
    await new Promise((resolve) => server.close(() => resolve()));
    rmSync(root, { force: true, recursive: true });
  }
});

test("request parser accepts known methods and rejects unknown methods", () => {
  const request = parseHostControlRequest({
    id: "request-1",
    method: "daemon.restart",
    protocolVersion: HOST_CONTROL_PROTOCOL_VERSION,
    token: "x".repeat(32)
  });

  assert.equal(request.method, "daemon.restart");
  assert.throws(() => parseHostControlRequest({ ...request, method: "process.kill" }), /method/);
});

test("response parser rejects a mismatched request id", () => {
  assert.throws(() => parseHostControlResponse({
    id: "response-for-another-request",
    ok: true,
    protocolVersion: HOST_CONTROL_PROTOCOL_VERSION,
    result: { status: {} }
  }, "expected-request"), /does not match/);
});

test("response parser rejects malformed nested Host status and capabilities", () => {
  const status = {
    autostart: { enabled: false, supported: true },
    busyReason: null,
    capabilities: { status: { allowed: true, reason: null } },
    daemon: {
      baseUrl: "http://127.0.0.1:4100",
      generation: "generation",
      lastError: null,
      pid: 123,
      port: 4100,
      restartAttempt: 0,
      state: "running",
      version: "0.1.1"
    },
    host: {
      pid: 456,
      startedAt: "2026-09-14T00:00:00.000Z",
      state: "running",
      version: "0.1.1"
    },
    update: { availableVersion: null, lastError: null, state: "idle" }
  };
  const response = {
    id: "expected-request",
    ok: true,
    protocolVersion: HOST_CONTROL_PROTOCOL_VERSION,
    result: { status }
  };

  assert.equal(parseHostControlResponse(response, "expected-request").ok, true);
  assert.throws(
    () => parseHostControlResponse({ ...response, result: { status: [] } }, "expected-request"),
    /success response/u
  );
  assert.throws(
    () => parseHostControlResponse({
      ...response,
      result: { status: { ...status, daemon: { ...status.daemon, port: 70_000 } } }
    }, "expected-request"),
    /success response/u
  );
  assert.throws(
    () => parseHostControlResponse({
      ...response,
      result: {
        status: {
          ...status,
          capabilities: { status: { allowed: "yes", reason: null } }
        }
      }
    }, "expected-request"),
    /success response/u
  );
  assert.throws(
    () => parseHostControlResponse({
      ...response,
      result: { status: { ...status, update: { ...status.update, state: "ready-ish" } } }
    }, "expected-request"),
    /success response/u
  );
});

test("request decoder requires one bounded JSON request and a terminal marker", () => {
  const valid = new BoundedHostControlRequestDecoder();
  const request = { id: "request", method: "status" };

  assert.equal(valid.push(Buffer.from(`${JSON.stringify(request)}\n`)), null);
  assert.deepEqual(valid.push(Buffer.from(`${HOST_CONTROL_REQUEST_END_MARKER}\n`)), request);

  const missingMarker = new BoundedHostControlRequestDecoder();

  missingMarker.push(Buffer.from(`${JSON.stringify(request)}\n`));
  assert.throws(() => missingMarker.finish(), /terminal marker/u);

  const duplicateRequest = new BoundedHostControlRequestDecoder();

  assert.throws(
    () => duplicateRequest.push(Buffer.from(
      `${JSON.stringify(request)}\n${JSON.stringify(request)}\n${HOST_CONTROL_REQUEST_END_MARKER}\n`
    )),
    /exactly one/u
  );

  const duplicateMarker = new BoundedHostControlRequestDecoder();

  assert.throws(
    () => duplicateMarker.push(Buffer.from(
      `${JSON.stringify(request)}\n${HOST_CONTROL_REQUEST_END_MARKER}\n${HOST_CONTROL_REQUEST_END_MARKER}\n`
    )),
    /duplicate terminal marker/u
  );

  const oversized = new BoundedHostControlRequestDecoder();

  assert.throws(
    () => oversized.push(Buffer.alloc(HOST_CONTROL_MAX_FRAME_BYTES + 1, 0x61)),
    /size limit/u
  );
});

test("NDJSON decoder rejects oversized frames", () => {
  const decoder = new BoundedNdjsonDecoder();

  assert.throws(
    () => decoder.push(Buffer.alloc(HOST_CONTROL_MAX_FRAME_BYTES + 1, 0x61)),
    /size limit/
  );
});
