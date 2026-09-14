import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../errors.ts";
import { UpdateAdmission } from "./updateAdmission.ts";

test("update admission atomically closes new operations while preserving active counts", async () => {
  const admission = new UpdateAdmission();
  let finishOperation!: () => void;
  const operationFinished = new Promise<void>((resolve) => {
    finishOperation = resolve;
  });
  const operation = admission.run("manual_command", () => operationFinished);

  const lease = admission.beginDrain();

  assert.equal(admission.isDraining(), true);
  assert.equal(admission.getActiveCount("manual_command"), 1);
  await assert.rejects(
    admission.run("manual_command", async () => undefined),
    (error: unknown) => error instanceof AppError && error.code === "conflict"
  );

  finishOperation();
  await operation;
  assert.equal(admission.getActiveCount("manual_command"), 0);

  lease.release();
  await admission.run("manual_command", async () => undefined);
  assert.equal(admission.isDraining(), false);
});

test("update admission drain leases release idempotently", () => {
  const admission = new UpdateAdmission();
  const lease = admission.beginDrain();

  lease.release();
  lease.release();

  assert.equal(admission.isDraining(), false);
});
