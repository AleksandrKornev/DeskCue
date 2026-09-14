import type { HostStatus } from "@deskcue/host-control";

import type { HostRequest } from "../host/hostClient.ts";
import { isHostUnavailableError, readOptionalHostStatus } from "../host/hostClient.ts";
import { runWithDeadline } from "../host/deadline.ts";

const HOST_ABSENCE_CONFIRMATION_MS = 300;
const HOST_STATUS_POLL_MS = 100;

function delay(durationMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function createShutdownTimeoutError(timeoutMs: number) {
  return new Error(`DeskCue Host did not stop within ${timeoutMs}ms.`);
}

function isShutdownInProgress(status: HostStatus) {
  return status.host.state === "stopping" || status.capabilities["host.shutdown"]?.allowed === false;
}

async function confirmHostAbsent(
  request: HostRequest,
  deadline: number,
  timeoutMs: number
) {
  const confirmationDeadline = Math.min(deadline, Date.now() + HOST_ABSENCE_CONFIRMATION_MS);

  while (true) {
    const now = Date.now();

    if (now >= deadline) throw createShutdownTimeoutError(timeoutMs);
    if (now >= confirmationDeadline) return null;

    await delay(Math.min(HOST_STATUS_POLL_MS, confirmationDeadline - now));
    const status = await runWithDeadline(
      (remainingMs) => readOptionalHostStatus(request, remainingMs),
      deadline,
      () => createShutdownTimeoutError(timeoutMs)
    );

    if (status) return status;
  }
}

async function requestShutdown(
  request: HostRequest,
  deadline: number,
  timeoutMs: number
) {
  while (true) {
    try {
      return await runWithDeadline(
        (remainingMs) => request("host.shutdown", undefined, remainingMs),
        deadline,
        () => createShutdownTimeoutError(timeoutMs)
      );
    } catch (error) {
      if (!isHostUnavailableError(error)) throw error;

      const status = await confirmHostAbsent(request, deadline, timeoutMs);

      if (!status) return null;
      if (isShutdownInProgress(status)) return status;
    }
  }
}

export async function shutdownHost({
  request,
  timeoutMs,
  wait
}: {
  request: HostRequest;
  timeoutMs: number;
  wait: boolean;
}): Promise<HostStatus | null> {
  const deadline = Date.now() + timeoutMs;
  let initial = await runWithDeadline(
    (remainingMs) => readOptionalHostStatus(request, remainingMs),
    deadline,
    () => createShutdownTimeoutError(timeoutMs)
  );

  if (!initial) initial = await confirmHostAbsent(request, deadline, timeoutMs);
  if (!initial) return null;

  const stopping = await requestShutdown(request, deadline, timeoutMs);

  if (!stopping) return null;
  if (!wait) return stopping;

  while (true) {
    const remainingMs = deadline - Date.now();

    if (remainingMs <= 0) throw createShutdownTimeoutError(timeoutMs);

    await delay(Math.min(HOST_STATUS_POLL_MS, remainingMs));
    let status = await runWithDeadline(
      (pollTimeoutMs) => readOptionalHostStatus(request, pollTimeoutMs),
      deadline,
      () => createShutdownTimeoutError(timeoutMs)
    );

    if (!status) status = await confirmHostAbsent(request, deadline, timeoutMs);
    if (!status) return null;
  }
}
