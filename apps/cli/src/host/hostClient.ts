import net from "node:net";
import type { Socket } from "node:net";

import {
  HostControlConnectionClosedError,
  HostControlTokenReadError,
  requestHostControl,
  resolveHostControlEndpoint,
  resolveHostControlPaths
} from "@deskcue/host-control";
import type {
  HostControlMethod,
  HostControlPaths,
  HostStatus
} from "@deskcue/host-control";

export class HostControlRejectedError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown> | null;
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    retryable: boolean,
    details: Record<string, unknown> | null = null
  ) {
    super(message);
    this.name = "HostControlRejectedError";
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }
}

export type HostRequest = {
  (
    method: HostControlMethod,
    params?: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<HostStatus>;
  probeEndpoint?: (timeoutMs?: number) => Promise<boolean>;
};

type HostEndpointProbeState = {
  settled: boolean;
  socket: Socket;
};

export function assertHostCapability(status: HostStatus, method: HostControlMethod) {
  const capability = status.capabilities[method];

  if (capability?.allowed === true) return;

  throw new HostControlRejectedError(
    "not_allowed",
    capability?.reason ?? `DeskCue Host did not advertise permission for ${method}. Update DeskCue and try again.`,
    false
  );
}

function isSystemEndpointUnavailableError(error: unknown) {
  const code = (error as NodeJS.ErrnoException | null)?.code;

  return code === "ENOENT" || code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ENOTSOCK" || code === "EPIPE";
}

function finishHostEndpointProbe(state: HostEndpointProbeState, action: () => void) {
  if (state.settled) return;

  state.settled = true;
  state.socket.destroy();
  action();
}

function probeHostControlEndpoint(paths: HostControlPaths, timeoutMs = 3_000) {
  const endpoint = resolveHostControlEndpoint("", paths);

  return new Promise<boolean>((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    const state = { settled: false, socket };

    socket.once("connect", () => finishHostEndpointProbe(state, () => resolve(true)));

    socket.once("error", (error) => finishHostEndpointProbe(state, () => {
      if (isSystemEndpointUnavailableError(error)) resolve(false);
      else reject(error);
    }));
    socket.setTimeout(timeoutMs, () => finishHostEndpointProbe(
      state,
      () => reject(new Error("DeskCue Host endpoint probe timed out."))
    ));
  });
}

export function isHostUnavailableError(error: unknown) {
  return error instanceof HostControlConnectionClosedError ||
    (!(error instanceof HostControlRejectedError) && isSystemEndpointUnavailableError(error));
}

async function executeHostRequest(
  paths: HostControlPaths,
  method: HostControlMethod,
  params?: Record<string, unknown>,
  timeoutMs?: number
) {
  const response = await requestHostControl({
    paths,
    request: {
      method,
      ...(params ? { params } : {})
    },
    ...(timeoutMs === undefined ? {} : { timeoutMs })
  });

  if (!response.ok) {
    throw new HostControlRejectedError(
      response.error.code,
      response.error.message,
      response.error.retryable,
      response.error.details ?? null
    );
  }

  return response.result.status;
}

export function createHostRequest(paths: HostControlPaths = resolveHostControlPaths()): HostRequest {
  return Object.assign(executeHostRequest.bind(null, paths), {
    probeEndpoint: probeHostControlEndpoint.bind(null, paths)
  });
}

export async function readOptionalHostStatus(request: HostRequest, timeoutMs?: number) {
  try {
    return await request("status", undefined, timeoutMs);
  } catch (error) {
    if (error instanceof HostControlTokenReadError || isHostUnavailableError(error)) {
      if (request.probeEndpoint && await request.probeEndpoint(timeoutMs)) throw error;
      if (error instanceof HostControlTokenReadError && !request.probeEndpoint) throw error;

      return null;
    }

    throw error;
  }
}

export function isHostTimeoutError(error: unknown) {
  return error instanceof Error && /timed out|did not stop within/i.test(error.message);
}
