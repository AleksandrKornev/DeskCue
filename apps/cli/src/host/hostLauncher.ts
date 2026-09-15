import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import { resolveHostLaunchSpec } from "@deskcue/host-control";

import { readOptionalHostStatus } from "./hostClient.ts";
import type { HostRequest } from "./hostClient.ts";
import { runWithDeadline } from "./deadline.ts";

export type LaunchHost = () => Promise<void>;

const HOST_START_TIMEOUT_MS = 15_000;
const HOST_START_RETRY_MS = 200;
const execFileAsync = promisify(execFile);

type LaunchDetachedHostOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  startSystemdService?: () => Promise<void>;
};

function delay(durationMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function createHostStartTimeoutError() {
  return new Error("DeskCue Host startup timed out before the control endpoint became ready.");
}

async function startDeskCueSystemdService() {
  await execFileAsync("systemctl", ["--user", "daemon-reload"], { encoding: "utf8" });
  await execFileAsync("systemctl", ["--user", "start", "deskcue-host.service"], {
    encoding: "utf8"
  });
}

export function launchDetachedHost(options: LaunchDetachedHostOptions = {}): Promise<void> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;

  if (platform === "linux" && env.DESKCUE_HOST_LAUNCH_MODE === "systemd-user") {
    return (options.startSystemdService ?? startDeskCueSystemdService)();
  }

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
