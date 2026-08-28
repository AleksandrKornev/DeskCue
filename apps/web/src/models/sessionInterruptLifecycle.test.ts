import assert from "node:assert/strict";
import test from "node:test";

import type { SessionInterruptLifecycle } from "./sessionInterruptLifecycle";
import { isInterruptLifecycleWaitingSuppressed } from "./sessionInterruptLifecycle";

const confirmedLifecycle: SessionInterruptLifecycle = {
  phase: "confirmed",
  requestedAt: "2026-08-28T10:00:05.000Z",
  confirmedAt: "2026-08-28T10:00:06.000Z",
  turnFingerprint: "user-old",
  confirmation: "verified_process"
};

test("confirmed interrupt suppresses only its own or an older managed prompt", () => {
  assert.equal(
    isInterruptLifecycleWaitingSuppressed(
      confirmedLifecycle,
      "2026-08-28T10:00:00.000Z"
    ),
    true
  );

  assert.equal(
    isInterruptLifecycleWaitingSuppressed(
      confirmedLifecycle,
      "2026-08-28T10:00:07.000Z"
    ),
    false
  );
});

test("requested interrupt remains suppressing without a newer prompt", () => {
  assert.equal(isInterruptLifecycleWaitingSuppressed({
    ...confirmedLifecycle,
    phase: "requested",
    confirmedAt: null,
    confirmation: null
  }), true);
});
