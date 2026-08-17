import assert from "node:assert/strict";
import test from "node:test";

import { startStorageMaintenanceSchedulerLoop } from "./storageMaintenanceScheduler.ts";
import type { StorageMaintenanceResult } from "./storageMaintenanceTypes.ts";

function maintenanceResult() {
  return {
    after: {
      database: { totalBytes: 0 },
      warnings: []
    }
  } as unknown as StorageMaintenanceResult;
}

function delay(durationMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, durationMs));
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await delay(2);
  }
  throw new Error("Timed out waiting for maintenance scheduler.");
}

test("storage maintenance scheduler never overlaps runs and close drains the active run", async () => {
  let releaseRun!: () => void;
  let runCount = 0;
  const runReleased = new Promise<void>((resolve) => {
    releaseRun = resolve;
  });
  const scheduler = startStorageMaintenanceSchedulerLoop({
    intervalMs: 2,
    runMaintenance: async () => {
      runCount += 1;
      await runReleased;
      return maintenanceResult();
    }
  });

  await waitFor(() => runCount === 1);
  await delay(15);
  assert.equal(runCount, 1);

  let closed = false;
  const closePromise = scheduler.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  assert.equal(closed, false);

  releaseRun();
  await closePromise;
  assert.equal(closed, true);
  await delay(10);
  assert.equal(runCount, 1);
});
