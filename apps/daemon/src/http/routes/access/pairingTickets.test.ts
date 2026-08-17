import assert from "node:assert/strict";
import test from "node:test";

import { PairingAttemptLimiter, PairingTickets } from "./pairingTickets.ts";

test("pairing tickets evict oldest active codes at the hard limit", () => {
  const tickets = new PairingTickets();
  const firstCode = tickets.create();

  for (let index = 0; index < 50; index += 1) {
    tickets.create();
  }

  assert.equal(tickets.consume(firstCode), false);
});

test("pairing tickets report active and used status", () => {
  const tickets = new PairingTickets();
  const code = tickets.create();

  assert.equal(tickets.status(code), "active");
  assert.equal(tickets.consume(code), true);
  assert.equal(tickets.status(code), "used");
  assert.equal(tickets.status("missing-code"), "expired_or_invalid");
});

test("pairing attempt limiter blocks excessive attempts per client key", () => {
  const limiter = new PairingAttemptLimiter();

  for (let index = 0; index < 30; index += 1) {
    assert.equal(limiter.take("192.168.1.10"), true);
  }

  assert.equal(limiter.take("192.168.1.10"), false);
  assert.equal(limiter.take("192.168.1.11"), true);
});

test("pairing attempt limiter bounds unique client buckets", () => {
  const limiter = new PairingAttemptLimiter();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    assert.equal(limiter.take("oldest-client"), true);
  }
  assert.equal(limiter.take("oldest-client"), false);

  for (let index = 0; index < 2_048; index += 1) {
    assert.equal(limiter.take(`client-${index}`), true);
  }
  assert.equal(limiter.take("oldest-client"), true);
});
