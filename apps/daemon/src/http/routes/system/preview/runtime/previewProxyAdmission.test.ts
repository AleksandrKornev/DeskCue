import assert from "node:assert/strict";
import test from "node:test";

import { PREVIEW_PROXY_LIMITS } from "../previewProxyLimits.ts";
import { PreviewProxyAdmission } from "./previewProxyAdmission.ts";

test("preview admission prevents one viewer and owner from monopolizing HTTP capacity", () => {
  const admission = new PreviewProxyAdmission();
  const owner = { id: "chat-a", kind: "session" as const };
  const viewerReservations = Array.from(
    { length: PREVIEW_PROXY_LIMITS.maxConcurrentRequestsPerViewer },
    () => admission.tryAcquire("http", owner, "viewer-a")
  );
  assert.equal(viewerReservations.every((reservation) => reservation.accepted), true);
  assert.deepEqual(admission.tryAcquire("http", owner, "viewer-a"), {
    accepted: false,
    reason: "viewer"
  });

  const remainingOwnerReservations = Array.from(
    {
      length:
        PREVIEW_PROXY_LIMITS.maxConcurrentRequestsPerOwner -
        PREVIEW_PROXY_LIMITS.maxConcurrentRequestsPerViewer
    },
    (_, index) => admission.tryAcquire("http", owner, `viewer-${index + 1}`)
  );
  assert.equal(remainingOwnerReservations.every((reservation) => reservation.accepted), true);
  assert.deepEqual(admission.tryAcquire("http", owner, "viewer-extra"), {
    accepted: false,
    reason: "owner"
  });

  for (const reservation of [...viewerReservations, ...remainingOwnerReservations]) {
    if (reservation.accepted) reservation.release();
  }
  assert.deepEqual(admission.readSnapshot(), {
    activeHttpOwners: 0,
    activeHttpRequests: 0,
    activeHttpViewers: 0,
    activeWebSocketOwners: 0,
    activeWebSockets: 0,
    activeWebSocketViewers: 0,
    closed: false
  });
});

test("preview admission retains the global cap across owners and rejects after close", () => {
  const admission = new PreviewProxyAdmission();
  const reservations = Array.from(
    { length: PREVIEW_PROXY_LIMITS.maxConcurrentWebSockets },
    (_, index) => admission.tryAcquire(
      "websocket",
      { id: `chat-${Math.floor(index / 2)}`, kind: "local-llm" },
      `viewer-${index}`
    )
  );
  assert.equal(reservations.every((reservation) => reservation.accepted), true);
  assert.deepEqual(
    admission.tryAcquire("websocket", { id: "extra", kind: "session" }, "extra"),
    { accepted: false, reason: "global" }
  );

  const first = reservations[0];
  assert.ok(first?.accepted);
  first.release();
  first.release();
  assert.equal(admission.readSnapshot().activeWebSockets, PREVIEW_PROXY_LIMITS.maxConcurrentWebSockets - 1);

  admission.close();
  assert.deepEqual(
    admission.tryAcquire("http", { id: "after-close", kind: "session" }, "viewer"),
    { accepted: false, reason: "closed" }
  );
});

test("preview viewer cap is shared across owners", () => {
  const admission = new PreviewProxyAdmission();
  const reservations = Array.from(
    { length: PREVIEW_PROXY_LIMITS.maxConcurrentRequestsPerViewer },
    (_, index) => admission.tryAcquire(
      "http",
      { id: `chat-${index}`, kind: "session" },
      "same-viewer"
    )
  );
  assert.equal(reservations.every((reservation) => reservation.accepted), true);
  assert.deepEqual(
    admission.tryAcquire("http", { id: "one-more-chat", kind: "local-llm" }, "same-viewer"),
    { accepted: false, reason: "viewer" }
  );
});
