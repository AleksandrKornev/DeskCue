import { sanitizeTerminalLine } from "../../output.ts";

export type LogRecord = Record<string, unknown>;

const MAX_LOG_RECORD_BYTES = 1024 * 1024;
const COMPACT_LOG_LINE_WIDTH = 78;
const SENSITIVE_LOG_NAME_PATTERN = [
  "[a-z0-9_-]*(?:token|secret|password)",
  "api[_-]?key",
  "authorization",
  "pair[_-]?code",
  "private[_-]?key",
  "prompt[_-]?text",
].join("|");
const SENSITIVE_LOG_KEY = new RegExp(`^(?:${SENSITIVE_LOG_NAME_PATTERN})$`, "i");
const SENSITIVE_LOG_JSON_TEXT = new RegExp(
  `("(?:${SENSITIVE_LOG_NAME_PATTERN})"\\s*:\\s*")[^"\\r\\n}]*`,
  "gi"
);
const SENSITIVE_LOG_ASSIGNMENT = new RegExp(
  `(\\b(?:${SENSITIVE_LOG_NAME_PATTERN})\\b\\s*[:=]\\s*)[^\\r\\n]*`,
  "gi"
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSensitiveLogKey(key: string) {
  return SENSITIVE_LOG_KEY.test(key);
}

function redactLogValue(key: string, value: unknown): unknown {
  if (isSensitiveLogKey(key)) return "[redacted]";
  if (typeof value === "string") return redactLogText(value);
  if (Array.isArray(value)) return value.map((item) => redactLogValue(key, item));

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [childKey, redactLogValue(childKey, childValue)])
    );
  }

  return value;
}

function redactLogRecord(record: LogRecord): LogRecord {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, redactLogValue(key, value)])
  );
}

function truncateCompactLogLine(value: string) {
  if (value.length <= COMPACT_LOG_LINE_WIDTH) return value;

  return `${value.slice(0, COMPACT_LOG_LINE_WIDTH - 1).trimEnd()}…`;
}

export function redactLogText(value: string) {
  return value
    .replace(/([?&](?:access_token|deskCueToken|token)=)[^&#\s"]*/gi, "$1[redacted]")
    .replace(SENSITIVE_LOG_JSON_TEXT, "$1[redacted]")
    .replace(SENSITIVE_LOG_ASSIGNMENT, "$1[redacted]");
}

export function parseLogLine(line: string): LogRecord {
  try {
    const value: unknown = JSON.parse(line);

    return isRecord(value) ? redactLogRecord(value) : { message: redactLogText(line) };
  } catch {
    return { message: redactLogText(line) };
  }
}

export function isOversizedLogRecord(line: string) {
  return Buffer.byteLength(line, "utf8") > MAX_LOG_RECORD_BYTES;
}

export function formatLogRecord(record: LogRecord, compact = false) {
  const timestamp = typeof record.timestamp === "string" ? sanitizeTerminalLine(record.timestamp) : null;
  const level = typeof record.level === "string" ? sanitizeTerminalLine(record.level.toUpperCase()) : null;
  const rawMessage = typeof record.message === "string" ? record.message : JSON.stringify(record) ?? "";
  const message = sanitizeTerminalLine(rawMessage);
  const context = record.context && typeof record.context === "object"
    ? sanitizeTerminalLine(JSON.stringify(record.context))
    : null;
  const output = [timestamp, level, message, context].filter(Boolean).join(" ");

  return compact ? truncateCompactLogLine(output) : output;
}

export function countLogLevels(lines: string[]) {
  const counts = { errors: 0, warnings: 0 };

  for (const line of lines) {
    const level = parseLogLine(line).level;

    if (level === "error" || level === "fatal") counts.errors += 1;
    if (level === "warn") counts.warnings += 1;
  }

  return counts;
}
