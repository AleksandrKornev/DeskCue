import { join, resolve } from "node:path";
import { Writable } from "node:stream";
import pino from "pino";

import {
  getDefaultDataRootPath,
  getLegacyDaemonDataRootPath,
  getServiceDataPath,
  migrateStorageLayout
} from "#config/storageLayout";

import { createAsyncRotatingFileDestination } from "./asyncRotatingFileDestination.ts";
import type { AsyncRotatingFileDestination } from "./asyncRotatingFileDestination.ts";
import { getRequestContext } from "./requestContext.ts";

type LogLevel = "debug" | "info" | "warn" | "error";

type LoggerOptions = {
  filePath: string | null;
  level: LogLevel;
  maxFileSizeBytes: number;
  maxFiles: number;
  maxQueueBytes: number;
  toStdout: boolean;
};

const DEFAULT_LOG_MAX_FILES = 3;
const DEFAULT_LOG_MAX_SIZE_MB = 5;
const DEFAULT_LOG_QUEUE_MAX_BYTES = 1024 * 1024;
const fileDestinations: AsyncRotatingFileDestination[] = [];

export async function flushLogger() {
  await Promise.all(fileDestinations.map((destination) => destination.flush()));
}

export async function closeLogger() {
  await Promise.all(fileDestinations.map((destination) => destination.close()));
}

function isWarnOrErrorLine(line: string) {
  try {
    const payload = JSON.parse(line) as {
      level?: unknown;
    };

    return payload.level === "warn" || payload.level === "error";
  } catch {
    return false;
  }
}

function createConsoleStream() {
  return new Writable({
    write(chunk: unknown, _encoding, callback) {
      const line = Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);

      if (isWarnOrErrorLine(line)) {
        console.error(line.trimEnd());
      } else {
        console.log(line.trimEnd());
      }

      callback();
    }
  });
}

function parseLevel(value: string | undefined): LogLevel {
  switch (value) {
    case "debug":
    case "info":
    case "warn":
    case "error":
      return value;
    default:
      return "info";
  }
}

function readBooleanEnv(name: string, defaultValue: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return defaultValue;
  }

  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }

  return defaultValue;
}

function readOptionalStringEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function readPositiveIntegerEnv(name: string, defaultValue: number): number {
  const rawValue = process.env[name];
  if (!rawValue) {
    return defaultValue;
  }

  const parsed = Number(rawValue);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
}

function readLoggerOptions(): LoggerOptions {
  const logDir = readOptionalStringEnv("DESKCUE_LOG_DIR");
  const dataRootPath = readOptionalStringEnv("DESKCUE_DATA_DIR") ?? getDefaultDataRootPath();
  migrateStorageLayout({
    dataRootPath,
    ...(resolve(dataRootPath) === resolve(getDefaultDataRootPath())
      ? { legacyDataRootPath: getLegacyDaemonDataRootPath() }
      : {}),
    migrateLocalChats: false
  });
  const serviceDataPath = getServiceDataPath(dataRootPath);
  const logToFileDefault = process.env.NODE_TEST_CONTEXT ? false : true;
  const filePath =
    readBooleanEnv("DESKCUE_LOG_TO_FILE", logToFileDefault) === false
      ? null
      : readOptionalStringEnv("DESKCUE_LOG_FILE") ??
        (logDir ? join(logDir, "daemon.jsonl") : join(serviceDataPath, "logs", "daemon.jsonl"));

  return {
    filePath,
    level: parseLevel(process.env.DESKCUE_LOG_LEVEL),
    maxFileSizeBytes:
      readPositiveIntegerEnv("DESKCUE_LOG_MAX_SIZE_MB", DEFAULT_LOG_MAX_SIZE_MB) *
      1024 *
      1024,
    maxFiles: readPositiveIntegerEnv("DESKCUE_LOG_MAX_FILES", DEFAULT_LOG_MAX_FILES),
    maxQueueBytes: readPositiveIntegerEnv(
      "DESKCUE_LOG_QUEUE_MAX_BYTES",
      DEFAULT_LOG_QUEUE_MAX_BYTES
    ),
    toStdout: readBooleanEnv("DESKCUE_LOG_TO_STDOUT", true)
  };
}

const options = readLoggerOptions();

export function getDaemonLogFilePath() {
  return options.filePath;
}

function reportFileLoggingError(message: string) {
  process.stderr.write(`DeskCue daemon log writer ${message}\n`);
}

function createLogStreams({
  filePath,
  maxFileSizeBytes,
  maxFiles,
  maxQueueBytes,
  toStdout
}: LoggerOptions): pino.StreamEntry[] {
  const streams: pino.StreamEntry[] = [];

  if (toStdout) {
    streams.push({
      stream: createConsoleStream()
    });
  }

  if (filePath) {
    const destination = createAsyncRotatingFileDestination({
      filePath,
      maxBatchBytes: 64 * 1024,
      maxFileSizeBytes,
      maxFiles,
      maxQueueBytes,
      reportError: reportFileLoggingError
    });
    fileDestinations.push(destination);
    streams.push({
      stream: destination
    });
  }

  return streams;
}
const pinoLogger = pino(
  {
    base: {
      service: "deskcue-daemon"
    },
    formatters: {
      level: (label) => ({
        level: label
      })
    },
    level: options.level,
    messageKey: "message",
    redact: {
      censor: "[redacted]",
      paths: [
        "accessToken",
        "authorization",
        "context.accessToken",
        "context.authorization",
        "context.Authorization",
        "context.headers.authorization",
        "context.headers.Authorization",
        "context.inputPreview",
        "context.pairCode",
        "context.promptText",
        "context.query.access_token",
        "context.query.deskcueToken",
        "context.query.token",
        "context.token",
        "pairCode",
        "token"
      ]
    },
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`
  },
  pino.multistream(createLogStreams(options))
);

function writeLog(level: LogLevel, message: string, context?: Record<string, unknown>) {
  const requestContext = getRequestContext();
  const nextContext = {
    ...(requestContext ? { requestId: requestContext.requestId } : {}),
    ...(context ?? {})
  };
  const payload =
    Object.keys(nextContext).length > 0
      ? {
          context: nextContext
        }
      : undefined;

  pinoLogger[level](payload, message);
}

export const logger = {
  debug(message: string, context?: Record<string, unknown>) {
    writeLog("debug", message, context);
  },
  info(message: string, context?: Record<string, unknown>) {
    writeLog("info", message, context);
  },
  warn(message: string, context?: Record<string, unknown>) {
    writeLog("warn", message, context);
  },
  error(message: string, context?: Record<string, unknown>) {
    writeLog("error", message, context);
  }
};
