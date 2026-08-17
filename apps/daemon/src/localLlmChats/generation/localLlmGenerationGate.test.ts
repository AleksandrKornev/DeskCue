import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "#application/errors";

import { LocalLlmGenerationGate } from "./localLlmGenerationGate.ts";

test("generation gate grants bounded slots in FIFO order", async () => {
  const gate = new LocalLlmGenerationGate(1, 2);
  const first = await gate.acquire(new AbortController().signal);
  assert.ok(first);

  const order: string[] = [];
  const secondPromise = gate.acquire(new AbortController().signal).then((release) => {
    order.push("second");
    return release;
  });
  const thirdPromise = gate.acquire(new AbortController().signal).then((release) => {
    order.push("third");
    return release;
  });
  await Promise.resolve();
  assert.deepEqual(order, []);

  first();
  const second = await secondPromise;
  assert.ok(second);
  assert.deepEqual(order, ["second"]);
  second();
  const third = await thirdPromise;
  assert.ok(third);
  assert.deepEqual(order, ["second", "third"]);
  third();
});

test("generation gate removes an aborted waiter without consuming a slot", async () => {
  const gate = new LocalLlmGenerationGate(1, 2);
  const first = await gate.acquire(new AbortController().signal);
  assert.ok(first);
  const queuedController = new AbortController();
  const queued = gate.acquire(queuedController.signal);
  queuedController.abort();
  assert.equal(await queued, null);

  first();
  const next = await gate.acquire(new AbortController().signal);
  assert.ok(next);
  next();
});

test("generation gate close cancels queued waiters and refuses new work", async () => {
  const gate = new LocalLlmGenerationGate(1, 2);
  const first = await gate.acquire(new AbortController().signal);
  assert.ok(first);
  const queued = gate.acquire(new AbortController().signal);

  gate.close();

  assert.equal(await queued, null);
  assert.equal(await gate.acquire(new AbortController().signal), null);
  first();
});

test("generation gate rejects work beyond its bounded queue capacity", async () => {
  const gate = new LocalLlmGenerationGate(1, 1);
  const first = await gate.acquire(new AbortController().signal);
  assert.ok(first);
  const queued = gate.acquire(new AbortController().signal);

  await assert.rejects(
    gate.acquire(new AbortController().signal),
    (error: unknown) => error instanceof AppError &&
      error.code === "conflict" &&
      error.message === "Local runtime generation queue is full. Try again after an active response finishes."
  );

  first();
  const queuedRelease = await queued;
  assert.ok(queuedRelease);
  queuedRelease();
});
