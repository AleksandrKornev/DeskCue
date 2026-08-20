import assert from "node:assert/strict";
import test from "node:test";

import { waitForPreviewPort } from "./previewCandidateDiscovery.ts";

test("waits for a configured preview port to become ready", async () => {
  let attempts = 0;
  let elapsedMs = 0;

  const ready = await waitForPreviewPort(5_173, {
    delay: async (durationMs) => {
      elapsedMs += durationMs;
    },
    now: () => elapsedMs,
    probe: async (port) => {
      assert.equal(port, 5_173);
      attempts += 1;
      return attempts === 3;
    },
    retryDelayMs: 25,
    timeoutMs: 100
  });

  assert.equal(ready, true);
  assert.equal(attempts, 3);
  assert.equal(elapsedMs, 50);
});

test("stops waiting at the configured readiness deadline", async () => {
  let attempts = 0;
  let elapsedMs = 0;

  const ready = await waitForPreviewPort(5_173, {
    delay: async (durationMs) => {
      elapsedMs += durationMs;
    },
    now: () => elapsedMs,
    probe: async () => {
      attempts += 1;
      return false;
    },
    retryDelayMs: 40,
    timeoutMs: 100
  });

  assert.equal(ready, false);
  assert.equal(attempts, 4);
  assert.equal(elapsedMs, 100);
});
