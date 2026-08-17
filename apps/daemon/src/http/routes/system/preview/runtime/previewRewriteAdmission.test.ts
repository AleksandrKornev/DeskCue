import assert from "node:assert/strict";
import test from "node:test";

import { PREVIEW_PROXY_LIMITS } from "../previewProxyLimits.ts";
import { PreviewRewriteAdmission } from "./previewRewriteAdmission.ts";

test("bounds active Preview JavaScript rewrites and drains a finite queue", async () => {
  const admission = new PreviewRewriteAdmission();
  const active = await Promise.all(Array.from(
    { length: PREVIEW_PROXY_LIMITS.maxConcurrentJavaScriptRewrites },
    () => admission.acquire()
  ));
  assert.equal(active.every((lease) => lease.accepted), true);

  const queued = admission.acquire();
  assert.deepEqual(admission.readSnapshot(), {
    active: PREVIEW_PROXY_LIMITS.maxConcurrentJavaScriptRewrites,
    queued: 1,
    closed: false
  });

  const first = active[0];
  assert.equal(first?.accepted, true);
  if (first?.accepted) first.release();
  const promoted = await queued;
  assert.equal(promoted.accepted, true);
  assert.deepEqual(admission.readSnapshot(), {
    active: PREVIEW_PROXY_LIMITS.maxConcurrentJavaScriptRewrites,
    queued: 0,
    closed: false
  });

  for (const lease of active.slice(1)) if (lease.accepted) lease.release();
  if (promoted.accepted) promoted.release();
  assert.equal(admission.readSnapshot().active, 0);
});

test("rejects excess and aborted queued rewrites without leaking capacity", async () => {
  const admission = new PreviewRewriteAdmission();
  const active = await Promise.all(Array.from(
    { length: PREVIEW_PROXY_LIMITS.maxConcurrentJavaScriptRewrites },
    () => admission.acquire()
  ));
  const queued = Array.from(
    { length: PREVIEW_PROXY_LIMITS.maxQueuedJavaScriptRewrites },
    () => admission.acquire()
  );
  assert.deepEqual(await admission.acquire(), { accepted: false, reason: "queue-full" });

  const controller = new AbortController();
  const admissionWithAbort = new PreviewRewriteAdmission();
  const occupied = await Promise.all(Array.from(
    { length: PREVIEW_PROXY_LIMITS.maxConcurrentJavaScriptRewrites },
    () => admissionWithAbort.acquire()
  ));
  const aborted = admissionWithAbort.acquire(controller.signal);
  controller.abort();
  assert.deepEqual(await aborted, { accepted: false, reason: "aborted" });
  assert.equal(admissionWithAbort.readSnapshot().queued, 0);

  admission.close();
  assert.equal((await Promise.all(queued)).every(
    (result) => !result.accepted && result.reason === "closed"
  ), true);
  for (const lease of [...active, ...occupied]) if (lease.accepted) lease.release();
});

test("close rejects queued and future Preview JavaScript rewrites", async () => {
  const admission = new PreviewRewriteAdmission();
  const active = await Promise.all(Array.from(
    { length: PREVIEW_PROXY_LIMITS.maxConcurrentJavaScriptRewrites },
    () => admission.acquire()
  ));
  const queued = admission.acquire();
  admission.close();
  assert.deepEqual(await queued, { accepted: false, reason: "closed" });
  assert.deepEqual(await admission.acquire(), { accepted: false, reason: "closed" });
  for (const lease of active) if (lease.accepted) lease.release();
  assert.deepEqual(admission.readSnapshot(), { active: 0, queued: 0, closed: true });
});
