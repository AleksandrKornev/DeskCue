import type { HostStatus } from "@deskcue/host-control";

import { assertHostCapability } from "../host/hostClient.ts";
import type { HostRequest } from "../host/hostClient.ts";
import { runWithDeadline } from "../host/deadline.ts";
import type { LaunchHost } from "../host/hostLauncher.ts";
import { ensureHostRunning } from "../host/hostLauncher.ts";

const DAEMON_START_TIMEOUT_MS = 35_000;
const DAEMON_START_WAIT_MS = 200;

function delay(durationMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function createDaemonStartTimeoutError() {
  return new Error("DeskCue daemon startup timed out.");
}

async function waitForInitialDaemon(request: HostRequest) {
  const deadline = Date.now() + DAEMON_START_TIMEOUT_MS;

  while (true) {
    const status = await runWithDeadline(
      (remainingMs) => request("status", undefined, remainingMs),
      deadline,
      createDaemonStartTimeoutError
    );

    if (status.daemon.state !== "starting") return status;

    const remainingMs = deadline - Date.now();

    if (remainingMs <= 0) throw createDaemonStartTimeoutError();

    await delay(Math.min(DAEMON_START_WAIT_MS, remainingMs));
  }
}

export async function startDeskCue(request: HostRequest, launch?: LaunchHost) {
  let initial = await ensureHostRunning(request, launch);

  if (initial.daemon.state === "starting") initial = await waitForInitialDaemon(request);

  if (initial.daemon.state === "running") return initial;

  assertHostCapability(initial, "daemon.start");

  return request("daemon.start");
}

export function formatStartMessage(status: HostStatus) {
  const url = status.daemon.baseUrl ? ` at ${status.daemon.baseUrl}` : "";

  return status.daemon.state === "running"
    ? `DeskCue Host and daemon are running${url}.`
    : `DeskCue Host is running, but the daemon is ${status.daemon.state}.`;
}
