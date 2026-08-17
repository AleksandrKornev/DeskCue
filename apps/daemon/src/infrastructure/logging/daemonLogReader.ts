import { open } from "node:fs/promises";

import type { DaemonLogEntry, DaemonLogsResponse } from "@deskcue/protocol";

import { getDaemonLogFilePath } from "./logger.ts";

const DEFAULT_LOG_LIMIT = 120;
const MAX_LOG_LIMIT = 500;
const LOG_TAIL_CHUNK_BYTES = 64 * 1024;
const MAX_LOG_TAIL_BYTES = 1024 * 1024;

function countNewlines(value: Buffer) {
  let count = 0;
  for (const byte of value) {
    if (byte === 10) {
      count += 1;
    }
  }
  return count;
}

function readErrorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : null;
}

async function readTailBytes(filePath: string, lineLimit: number) {
  let handle;
  try {
    handle = await open(filePath, "r");
  } catch (error) {
    if (readErrorCode(error) === "ENOENT") {
      return null;
    }
    throw error;
  }

  try {
    const fileSize = (await handle.stat()).size;
    let position = fileSize;
    let bytesReadTotal = 0;
    let newlineCount = 0;
    const chunks: Buffer[] = [];

    while (
      position > 0 &&
      bytesReadTotal < MAX_LOG_TAIL_BYTES &&
      newlineCount <= lineLimit
    ) {
      const readSize = Math.min(
        LOG_TAIL_CHUNK_BYTES,
        position,
        MAX_LOG_TAIL_BYTES - bytesReadTotal
      );
      position -= readSize;
      const chunk = Buffer.allocUnsafe(readSize);
      const { bytesRead } = await handle.read(chunk, 0, readSize, position);
      if (bytesRead === 0) {
        break;
      }
      const value = bytesRead === readSize ? chunk : chunk.subarray(0, bytesRead);
      chunks.unshift(value);
      bytesReadTotal += bytesRead;
      newlineCount += countNewlines(value);
    }

    let text = Buffer.concat(chunks, bytesReadTotal).toString("utf8");
    const truncated = position > 0;
    if (truncated) {
      const firstLineEnd = text.indexOf("\n");
      text = firstLineEnd >= 0 ? text.slice(firstLineEnd + 1) : "";
    }
    return { text, truncated };
  } finally {
    await handle.close();
  }
}

function normalizeLimit(limit: number) {
  return Number.isInteger(limit) && limit > 0
    ? Math.min(limit, MAX_LOG_LIMIT)
    : DEFAULT_LOG_LIMIT;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function redactLogText(value: string) {
  return value.replace(
    /([?&](?:access_token|deskcueToken|token)=)[^&#\s"]*/gi,
    "$1[redacted]"
  );
}

function isSensitiveKey(key: string) {
  return /^(accessToken|authorization|pairCode|promptText|token)$/i.test(key);
}

function redactLogValue(key: string, value: unknown): unknown {
  if (isSensitiveKey(key)) {
    return "[redacted]";
  }

  if (typeof value === "string") {
    return redactLogText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(key, item));
  }

  if (isRecord(value)) {
    const redacted: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      redacted[childKey] = redactLogValue(childKey, childValue);
    }
    return redacted;
  }

  return value;
}

function redactLogContext(context: Record<string, unknown>) {
  const redacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(context)) {
    redacted[key] = redactLogValue(key, value);
  }

  return redacted;
}

function parseLogLine(line: string): DaemonLogEntry[] {
  try {
    const payload = JSON.parse(line) as {
      context?: unknown;
      level?: unknown;
      message?: unknown;
      timestamp?: unknown;
    };

    return [
      {
        context: isRecord(payload.context) ? redactLogContext(payload.context) : null,
        level: typeof payload.level === "string" ? payload.level : "info",
        message: redactLogText(typeof payload.message === "string" ? payload.message : line),
        timestamp: typeof payload.timestamp === "string" ? payload.timestamp : null
      }
    ];
  } catch {
    return [
      {
        context: null,
        level: "info",
        message: redactLogText(line),
        timestamp: null
      }
    ];
  }
}

export async function readDaemonLogTail(
  limit = DEFAULT_LOG_LIMIT,
  filePath = getDaemonLogFilePath()
): Promise<DaemonLogsResponse> {
  const normalizedLimit = normalizeLimit(limit);

  if (!filePath) {
    return {
      entries: [],
      filePath,
      truncated: false
    };
  }

  const tailRead = await readTailBytes(filePath, normalizedLimit);
  if (!tailRead) {
    return {
      entries: [],
      filePath,
      truncated: false
    };
  }
  const lines = tailRead.text.split(/\r?\n/).filter(Boolean);
  const tail = lines.slice(-normalizedLimit);

  return {
    entries: tail.flatMap(parseLogLine),
    filePath,
    truncated: tailRead.truncated || lines.length > tail.length
  };
}
