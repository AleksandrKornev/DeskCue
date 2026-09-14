import assert from "node:assert/strict";
import test from "node:test";

import { isDaemonChildMessage } from "./daemonChildProtocol.ts";

test("daemon child protocol validates every ready and startup-failed field", () => {
  const ready = {
    baseUrl: "http://127.0.0.1:4100",
    pid: 42,
    port: 4100,
    type: "ready",
    version: "0.1.1"
  };

  assert.equal(isDaemonChildMessage(ready), true);
  assert.equal(isDaemonChildMessage({ type: "ready" }), false);
  assert.equal(isDaemonChildMessage({ ...ready, baseUrl: "https://example.com" }), false);
  assert.equal(isDaemonChildMessage({ ...ready, pid: 0 }), false);
  assert.equal(isDaemonChildMessage({ ...ready, port: 70_000 }), false);
  assert.equal(isDaemonChildMessage({ message: "failed", retryable: true, type: "startup-failed" }), true);
  assert.equal(isDaemonChildMessage({ retryable: "yes", type: "startup-failed" }), false);
});

test("daemon child protocol validates correlated bounded update readiness", () => {
  const ready = {
    backupPath: "C:\\data\\backup.sqlite",
    blockers: [],
    ok: true,
    requestId: "request-1",
    type: "update-readiness"
  };

  const blocked = {
    blockers: [{ code: "active_turns", count: 1, message: "One turn is active." }],
    ok: false,
    requestId: "request-2",
    type: "update-readiness"
  };

  assert.equal(isDaemonChildMessage(ready), true);
  assert.equal(isDaemonChildMessage(blocked), true);
  assert.equal(isDaemonChildMessage({ ...ready, blockers: undefined }), false);
  assert.equal(isDaemonChildMessage({ ...ready, ok: false }), false);
  assert.equal(isDaemonChildMessage({ ...blocked, backupPath: "unexpected.sqlite" }), false);
  assert.equal(isDaemonChildMessage({ ...blocked, blockers: [{ code: "active", count: 0, message: "bad" }] }), false);
  assert.equal(isDaemonChildMessage({ ...blocked, blockers: [{ code: "active", count: -1, message: "bad" }] }), false);
});
