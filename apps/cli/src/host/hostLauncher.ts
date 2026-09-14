import { spawn } from "node:child_process";

import { resolveHostLaunchSpec } from "@deskcue/host-control";

import { readOptionalHostStatus } from "./hostClient.ts";
import type { HostRequest } from "./hostClient.ts";
import { runWithDeadline } from "./deadline.ts";

export type LaunchHost = () => Promise<void>;

const HOST_START_TIMEOUT_MS = 15_000;
const HOST_START_RETRY_MS = 200;

function delay(durationMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function createHostStartTimeoutError() {
  return new Error("DeskCue Host startup timed out before the control endpoint became ready.");
}

export function launchDetachedHost(): Promise<void> {
  const spec = resolveHostLaunchSpec();

  return new Promise((resolve, reject) => {
    const child = spawn(spec.file, spec.args, {
      cwd: spec.cwd,
      detached: true,
      env: spec.env,
      stdio: "ignore",
      windowsHide: true
    });

    child.once("error", reject);

    child.once("spawn", () => {
      child.removeListener("error", reject);
      child.unref();
      resolve();
    });
  });
}

export async function ensureHostRunning(
  request: HostRequest,
  launch: LaunchHost = launchDetachedHost,
  timeoutMs = HOST_START_TIMEOUT_MS
) {
  const deadline = Date.now() + timeoutMs;
  const initial = await runWithDeadline(
    (remainingMs) => readOptionalHostStatus(request, remainingMs),
    deadline,
    createHostStartTimeoutError
  );

  if (initial) return initial;

  await runWithDeadline(() => launch(), deadline, createHostStartTimeoutError);

  while (true) {
    const status = await runWithDeadline(
      (remainingMs) => readOptionalHostStatus(request, remainingMs),
      deadline,
      createHostStartTimeoutError
    );

    if (status) return status;

    const remainingMs = deadline - Date.now();

    if (remainingMs <= 0) throw createHostStartTimeoutError();

    await delay(Math.min(HOST_START_RETRY_MS, remainingMs));
  }
}
