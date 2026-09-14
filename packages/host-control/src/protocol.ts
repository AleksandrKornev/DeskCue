export const HOST_CONTROL_PROTOCOL_VERSION = 2;
export const HOST_CONTROL_MAX_FRAME_BYTES = 64 * 1024;

export const HOST_CONTROL_METHODS = [
  "status",
  "daemon.start",
  "daemon.stop",
  "daemon.restart",
  "host.shutdown",
  "update.check",
  "update.apply",
  "autostart.get",
  "autostart.enable",
  "autostart.disable"
] as const;

export type HostControlMethod = typeof HOST_CONTROL_METHODS[number];
export type HostState = "starting" | "running" | "stopping" | "degraded";
export type HostDaemonState = "starting" | "running" | "stopping" | "stopped" | "degraded";
export type HostUpdateState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "staged"
  | "applying"
  | "failed";

export type HostCapability = {
  allowed: boolean;
  reason: string | null;
};

export type HostStatus = {
  autostart: {
    enabled: boolean | null;
    supported: boolean;
  };

  busyReason: string | null;
  capabilities: Partial<Record<HostControlMethod, HostCapability>>;
  daemon: {
    baseUrl: string | null;
    generation: string | null;
    lastError: string | null;
    pid: number | null;
    port: number | null;
    restartAttempt: number;
    state: HostDaemonState;
    version: string | null;
  };

  host: {
    pid: number;
    startedAt: string;
    state: HostState;
    version: string;
  };

  update: {
    availableVersion: string | null;
    lastError: string | null;
    state: HostUpdateState;
  };
};

export type HostControlRequest = {
  id: string;
  method: HostControlMethod;
  params?: Record<string, unknown>;
  protocolVersion: typeof HOST_CONTROL_PROTOCOL_VERSION;
  token: string;
};

export type HostControlResponse =
  | {
      id: string;
      ok: true;
      protocolVersion: typeof HOST_CONTROL_PROTOCOL_VERSION;
      result: {
        status: HostStatus;
      };
    }
  | {
      error: {
        code: string;
        details?: Record<string, unknown>;
        message: string;
        retryable: boolean;
      };

      id: string;
      ok: false;
      protocolVersion: typeof HOST_CONTROL_PROTOCOL_VERSION;
    };

const hostControlMethodSet = new Set<string>(HOST_CONTROL_METHODS);
const hostDaemonStateSet = new Set<HostDaemonState>(["degraded", "running", "starting", "stopped", "stopping"]);
const hostStateSet = new Set<HostState>(["degraded", "running", "starting", "stopping"]);
const hostUpdateStateSet = new Set<HostUpdateState>([
  "applying",
  "available",
  "checking",
  "downloading",
  "failed",
  "idle",
  "staged"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullablePositiveInteger(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value as number) && (value as number) > 0);
}

function isHostCapability(value: unknown): value is HostCapability {
  return isRecord(value) &&
    typeof value.allowed === "boolean" &&
    (value.reason === null || typeof value.reason === "string");
}

function isHostCapabilities(value: unknown): value is HostStatus["capabilities"] {
  if (!isRecord(value)) return false;

  return Object.entries(value).every(([method, capability]) =>
    isHostControlMethod(method) && isHostCapability(capability)
  );
}

function isHostStatus(value: unknown): value is HostStatus {
  if (!isRecord(value)) return false;

  const autostart = value.autostart;
  const daemon = value.daemon;
  const host = value.host;
  const update = value.update;

  return isRecord(autostart) &&
    (autostart.enabled === null || typeof autostart.enabled === "boolean") &&
    typeof autostart.supported === "boolean" &&
    isNullableString(value.busyReason) &&
    isHostCapabilities(value.capabilities) &&
    isRecord(daemon) &&
    isNullableString(daemon.baseUrl) &&
    isNullableString(daemon.generation) &&
    isNullableString(daemon.lastError) &&
    isNullablePositiveInteger(daemon.pid) &&
    (daemon.port === null || (Number.isSafeInteger(daemon.port) && (daemon.port as number) >= 1 &&
      (daemon.port as number) <= 65_535)) &&
    Number.isSafeInteger(daemon.restartAttempt as number) &&
    (daemon.restartAttempt as number) >= 0 &&
    typeof daemon.state === "string" &&
    hostDaemonStateSet.has(daemon.state as HostDaemonState) &&
    isNullableString(daemon.version) &&
    isRecord(host) &&
    Number.isSafeInteger(host.pid as number) &&
    (host.pid as number) > 0 &&
    typeof host.startedAt === "string" &&
    typeof host.state === "string" &&
    hostStateSet.has(host.state as HostState) &&
    typeof host.version === "string" &&
    isRecord(update) &&
    isNullableString(update.availableVersion) &&
    isNullableString(update.lastError) &&
    typeof update.state === "string" &&
    hostUpdateStateSet.has(update.state as HostUpdateState);
}

export function isHostControlMethod(value: unknown): value is HostControlMethod {
  return typeof value === "string" && hostControlMethodSet.has(value);
}

export function parseHostControlRequest(value: unknown): HostControlRequest {
  if (!isRecord(value)) {
    throw new Error("Host control request must be an object.");
  }

  const candidate = value;

  if (candidate.protocolVersion !== HOST_CONTROL_PROTOCOL_VERSION) {
    throw new Error("Unsupported host control protocol version.");
  }

  if (typeof candidate.id !== "string" || candidate.id.length < 1 || candidate.id.length > 128) {
    throw new Error("Host control request id is invalid.");
  }

  if (typeof candidate.token !== "string" || candidate.token.length < 32 || candidate.token.length > 256) {
    throw new Error("Host control token is invalid.");
  }

  if (!isHostControlMethod(candidate.method)) {
    throw new Error("Host control method is invalid.");
  }

  if (
    candidate.params !== undefined &&
    !isRecord(candidate.params)
  ) {
    throw new Error("Host control params must be an object.");
  }

  return candidate as HostControlRequest;
}

export function parseHostControlResponse(value: unknown, expectedId?: string): HostControlResponse {
  if (!isRecord(value)) {
    throw new Error("Host control response must be an object.");
  }

  const candidate = value;

  if (candidate.protocolVersion !== HOST_CONTROL_PROTOCOL_VERSION) {
    throw new Error("Unsupported host control response protocol version.");
  }

  if (typeof candidate.id !== "string" || (expectedId && candidate.id !== expectedId)) {
    throw new Error("Host control response id does not match the request.");
  }

  if (candidate.ok === true) {
    const result = candidate.result;

    if (!isRecord(result) || !isHostStatus(result.status)) {
      throw new Error("Host control success response is invalid.");
    }
  } else if (candidate.ok === false) {
    const error = candidate.error;

    if (
      !isRecord(error) ||
      typeof error.code !== "string" ||
      typeof error.message !== "string" ||
      typeof error.retryable !== "boolean" ||
      (error.details !== undefined && !isRecord(error.details))
    ) {
      throw new Error("Host control failure response is invalid.");
    }
  } else {
    throw new Error("Host control response result is invalid.");
  }

  return candidate as HostControlResponse;
}
