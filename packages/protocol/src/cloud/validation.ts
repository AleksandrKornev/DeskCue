import { ProtocolSchemaError } from "../schema.ts";

import {
  CLOUD_RELAY_PROTOCOL_VERSION,
  CLOUD_REMOTE_READ_CHUNK_BYTES
} from "./types.ts";

export function requireExactVersion(frame: Record<string, unknown>) {
  if (frame.protocolVersion !== CLOUD_RELAY_PROTOCOL_VERSION) {
    throw new ProtocolSchemaError("Unsupported Cloud relay protocol version.");
  }
}

export function readStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
}

export function isSafeInteger(value: unknown, minimum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}

export function isSafeIntegerBetween(value: unknown, minimum: number, maximum: number): value is number {
  return isSafeInteger(value, minimum) && value <= maximum;
}

export function isIdentifier(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function isStringBetween(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum;
}

export function isBase64ChunkWithLimit(value: unknown, maximumBytes: number): value is string {
  if (typeof value !== "string" || value.length === 0 ||
      value.length > Math.ceil(maximumBytes / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return value.length / 4 * 3 - padding <= maximumBytes;
}

export function isBase64Chunk(value: unknown): value is string {
  return isBase64ChunkWithLimit(value, CLOUD_REMOTE_READ_CHUNK_BYTES);
}

export function requireOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    throw new ProtocolSchemaError("Cloud protocol object contains unknown fields.");
  }
}

export function invalidReadInput(): never {
  throw new ProtocolSchemaError("Cloud remote read operation input is invalid.");
}

export function invalidControlInput(): never {
  throw new ProtocolSchemaError("Cloud remote control operation input is invalid.");
}

export function isWebSocketCloseCode(value: unknown): value is number {
  return isSafeIntegerBetween(value, 1_000, 4_999);
}

export function isUtf8StringBetween(value: unknown, minimum: number, maximumBytes: number): value is string {
  return typeof value === "string" && value.length >= minimum &&
    new TextEncoder().encode(value).byteLength <= maximumBytes;
}

export function isStringArrayBetween(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
  maximumItemLength: number
) {
  return Array.isArray(value) && value.length >= minimumLength && value.length <= maximumLength &&
    value.every((item) => isStringBetween(item, 1, maximumItemLength));
}

export function isOptionalStringArray(value: unknown, maximumLength = 2_048) {
  return value === undefined || isStringArrayBetween(value, 0, maximumLength, 512);
}

export function isCloudRelativePath(value: unknown, allowEmpty: boolean): value is string {
  if (typeof value !== "string" || value.length > 4096 || (!allowEmpty && value.length === 0) ||
      value.includes("\0") || /^[\\/]/u.test(value) || /^[A-Za-z]:/u.test(value)) return false;
  return !value.split(/[\\/]+/u).some((segment) => segment === "..");
}

export function isOptionalSourceRanges(value: unknown) {
  return value === undefined || (Array.isArray(value) && value.length <= 2_048 && value.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const range = item as Record<string, unknown>;
    return Object.keys(range).every((key) => ["prefix", "start", "end"].includes(key)) &&
      isStringBetween(range.prefix, 0, 256) && isSafeInteger(range.start, 0) &&
      isSafeInteger(range.end, range.start) && range.end <= Number.MAX_SAFE_INTEGER;
  }));
}

export function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

