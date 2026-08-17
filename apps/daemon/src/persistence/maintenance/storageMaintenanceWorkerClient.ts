import { Worker } from "node:worker_threads";

import type {
  StorageMaintenanceOptions,
  StorageMaintenanceResult
} from "./storageMaintenanceTypes.ts";

type StorageMaintenanceWorkerMessage =
  | { ok: true; result: StorageMaintenanceResult }
  | { error: string; ok: false; stack?: string };

function runMaintenanceWorker(input:
  | { mode: "full"; options: StorageMaintenanceOptions }
  | {
      mode: "lightweight";
      options: StorageMaintenanceOptions;
      runtime: { allowAutomaticVacuum: boolean };
    }
) {
  return new Promise<StorageMaintenanceResult>((resolve, reject) => {
    const worker = new Worker(new URL("./storageMaintenanceWorker.js", import.meta.url), {
      env: {
        ...process.env,
        DESKCUE_LOG_TO_FILE: "false",
        DESKCUE_LOG_TO_STDOUT: "false"
      },
      workerData: input
    });
    let message: StorageMaintenanceWorkerMessage | null = null;
    let settled = false;

    worker.once("message", (value: StorageMaintenanceWorkerMessage) => {
      message = value;
    });
    worker.once("error", (error) => {
      settled = true;
      reject(error);
    });
    worker.once("exit", (exitCode) => {
      if (settled) return;
      settled = true;
      if (exitCode !== 0) {
        reject(new Error(`Storage maintenance worker exited with code ${exitCode}.`));
      } else if (!message) {
        reject(new Error("Storage maintenance worker exited without a result."));
      } else if (!message.ok) {
        const error = new Error(message.error);
        error.stack = message.stack ?? error.stack;
        reject(error);
      } else {
        resolve(message.result);
      }
    });
  });
}

export function runStorageMaintenanceInWorker(
  options: StorageMaintenanceOptions,
  runtime: { allowAutomaticVacuum: boolean }
) {
  return runMaintenanceWorker({ mode: "lightweight", options, runtime });
}

export function runFullStorageMaintenanceInWorker(
  options: StorageMaintenanceOptions
) {
  return runMaintenanceWorker({ mode: "full", options });
}
