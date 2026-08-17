import { parentPort, workerData } from "node:worker_threads";

import { runLightweightStorageMaintenance, runStorageMaintenance } from "./storageMaintenance.ts";
import type { StorageMaintenanceOptions } from "./storageMaintenanceTypes.ts";

const input = workerData as
  | {
      mode: "full";
      options: StorageMaintenanceOptions;
    }
  | {
      mode?: "lightweight";
      options: StorageMaintenanceOptions;
      runtime: { allowAutomaticVacuum: boolean };
    };

try {
  const result = input.mode === "full"
    ? runStorageMaintenance(input.options)
    : runLightweightStorageMaintenance(input.options, input.runtime);
  parentPort?.postMessage({ ok: true, result });
} catch (error) {
  parentPort?.postMessage({
    error: error instanceof Error ? error.message : String(error),
    ok: false,
    stack: error instanceof Error ? error.stack : undefined
  });
}
