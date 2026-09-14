export type DaemonChildReadyMessage = {
  baseUrl: string;
  pid: number;
  port: number;
  type: "ready";
  version: string;
};

export type DaemonChildStartupFailedMessage = {
  message: string;
  retryable: boolean;
  type: "startup-failed";
};

export type DaemonChildStoppedMessage = {
  type: "stopped";
};

export type DaemonChildUpdateReadinessMessage = {
  backupPath?: string | null;
  blockers: Array<{ code: string; count: number; message: string }>;
  ok: boolean;
  requestId: string;
  type: "update-readiness";
};

export type DaemonChildMessage =
  | DaemonChildReadyMessage
  | DaemonChildStartupFailedMessage
  | DaemonChildStoppedMessage
  | DaemonChildUpdateReadinessMessage;

export type HostChildMessage =
  | {
      reason: "host-request" | "host-shutdown";
      type: "shutdown";
    }
  | {
      requestId: string;
      type: "prepare-update" | "cancel-update";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength;
}

function isValidDaemonBaseUrl(value: unknown) {
  if (!isBoundedString(value, 2_048)) return false;

  try {
    const url = new URL(value);

    return url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "localhost");
  } catch {
    return false;
  }
}

function isUpdateBlocker(value: unknown) {
  return isRecord(value) &&
    isBoundedString(value.code, 128) &&
    Number.isSafeInteger(value.count as number) &&
    (value.count as number) > 0 &&
    isBoundedString(value.message, 1_000);
}

function isUpdateReadinessMessage(value: Record<string, unknown>) {
  if (!isBoundedString(value.requestId, 128) || typeof value.ok !== "boolean") return false;

  if (!Array.isArray(value.blockers) || value.blockers.length > 64 || !value.blockers.every(isUpdateBlocker)) {
    return false;
  }

  if (
    value.backupPath !== undefined &&
    value.backupPath !== null &&
    !isBoundedString(value.backupPath, 32_768)
  ) {
    return false;
  }

  return value.ok ? value.blockers.length === 0 : value.blockers.length > 0 && value.backupPath === undefined;
}

export function isDaemonChildMessage(value: unknown): value is DaemonChildMessage {
  if (!isRecord(value)) return false;
  if (value.type === "stopped") return true;

  if (value.type === "startup-failed") {
    return isBoundedString(value.message, 2_000) && typeof value.retryable === "boolean";
  }

  if (value.type === "ready") {
    return isValidDaemonBaseUrl(value.baseUrl) &&
      Number.isSafeInteger(value.pid as number) &&
      (value.pid as number) > 0 &&
      Number.isSafeInteger(value.port as number) &&
      (value.port as number) >= 1 &&
      (value.port as number) <= 65_535 &&
      isBoundedString(value.version, 128);
  }

  if (value.type === "update-readiness") return isUpdateReadinessMessage(value);

  return false;
}
