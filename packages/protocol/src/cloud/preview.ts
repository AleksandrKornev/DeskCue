import { ProtocolSchemaError, readProtocolObject } from "../schema.ts";

export const CLOUD_PREVIEW_PROTOCOL_VERSION = 1 as const;
export const CLOUD_PREVIEW_MAX_FRAME_BYTES = 16 * 1024;
export const CLOUD_PREVIEW_CHUNK_BYTES = 8 * 1024;
export const CLOUD_PREVIEW_HTTP_MAX_REQUEST_BYTES = 8 * 1024 * 1024;
export const CLOUD_PREVIEW_HTTP_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
export const CLOUD_PREVIEW_WS_MAX_MESSAGE_BYTES = 1024 * 1024;
export const CLOUD_PREVIEW_MAX_CREDIT_BYTES = 256 * 1024;
export const CLOUD_PREVIEW_MAX_PATH_BYTES = 8 * 1024;
export const CLOUD_PREVIEW_MAX_HEADER_BYTES = 32 * 1024;
export const CLOUD_PREVIEW_MAX_HEADER_COUNT = 100;
export const CLOUD_PREVIEW_MAX_HTTP_STREAMS = 64;
export const CLOUD_PREVIEW_MAX_WS_STREAMS = 24;

export const CLOUD_PREVIEW_FRAME_TYPES = [
  "preview.http.request.start",
  "preview.http.request.chunk",
  "preview.http.request.end",
  "preview.http.request.cancel",
  "preview.http.response.start",
  "preview.http.response.chunk",
  "preview.http.response.end",
  "preview.http.response.error",
  "preview.ws.open",
  "preview.ws.opened",
  "preview.ws.message.start",
  "preview.ws.message.chunk",
  "preview.ws.message.end",
  "preview.ws.close",
  "preview.flow.credit"
] as const;

export type CloudPreviewFrameType = typeof CLOUD_PREVIEW_FRAME_TYPES[number];
export type CloudPreviewHeader = [name: string, value: string];
export type CloudPreviewOwner = { kind: "session"; ownerId: string };
export type CloudPreviewFlowDirection =
  | "http.request"
  | "http.response"
  | "ws.client"
  | "ws.server";

type PreviewFrameBase<Type extends CloudPreviewFrameType> = {
  type: Type;
  protocolVersion: typeof CLOUD_PREVIEW_PROTOCOL_VERSION;
  streamId: string;
};

export type CloudPreviewHttpRequestStart = PreviewFrameBase<"preview.http.request.start"> & {
  owner: CloudPreviewOwner;
  viewerId: string;
  method: "DELETE" | "GET" | "HEAD" | "OPTIONS" | "PATCH" | "POST" | "PUT";
  path: string;
  headers: CloudPreviewHeader[];
  contentLength: number | null;
  deadlineAt: string;
  sentAt: string;
};
export type CloudPreviewHttpRequestChunk = PreviewFrameBase<"preview.http.request.chunk"> & {
  sequence: number;
  data: string;
};
export type CloudPreviewHttpRequestEnd = PreviewFrameBase<"preview.http.request.end"> & {
  bodyBytes: number;
  chunkCount: number;
  bodySha256: string;
  sentAt: string;
};
export type CloudPreviewHttpRequestCancel = PreviewFrameBase<"preview.http.request.cancel"> & {
  reason: "browser_closed" | "deadline_exceeded" | "machine_disconnected";
  sentAt: string;
};
export type CloudPreviewHttpResponseStart = PreviewFrameBase<"preview.http.response.start"> & {
  status: number;
  headers: CloudPreviewHeader[];
  contentLength: number | null;
  sentAt: string;
};
export type CloudPreviewHttpResponseChunk = PreviewFrameBase<"preview.http.response.chunk"> & {
  sequence: number;
  data: string;
};
export type CloudPreviewHttpResponseEnd = PreviewFrameBase<"preview.http.response.end"> & {
  bodyBytes: number;
  chunkCount: number;
  bodySha256: string;
  sentAt: string;
};
export type CloudPreviewHttpResponseError = PreviewFrameBase<"preview.http.response.error"> & {
  code: "cancelled" | "deadline_exceeded" | "invalid_request" | "preview_unavailable" | "upstream_failed";
  retryable: boolean;
  sentAt: string;
};
export type CloudPreviewWebSocketOpen = PreviewFrameBase<"preview.ws.open"> & {
  owner: CloudPreviewOwner;
  viewerId: string;
  path: string;
  headers: CloudPreviewHeader[];
  protocols: string[];
  deadlineAt: string;
  sentAt: string;
};
export type CloudPreviewWebSocketOpened = PreviewFrameBase<"preview.ws.opened"> & {
  protocol: string | null;
  headers: CloudPreviewHeader[];
  openedAt: string;
};
export type CloudPreviewWebSocketMessageStart = PreviewFrameBase<"preview.ws.message.start"> & {
  direction: "client" | "server";
  messageId: string;
  binary: boolean;
  bodyBytes: number;
  chunkCount: number;
  bodySha256: string;
  sentAt: string;
};
export type CloudPreviewWebSocketMessageChunk = PreviewFrameBase<"preview.ws.message.chunk"> & {
  direction: "client" | "server";
  messageId: string;
  sequence: number;
  data: string;
};
export type CloudPreviewWebSocketMessageEnd = PreviewFrameBase<"preview.ws.message.end"> & {
  direction: "client" | "server";
  messageId: string;
  bodySha256: string;
  sentAt: string;
};
export type CloudPreviewWebSocketClose = PreviewFrameBase<"preview.ws.close"> & {
  source: "client" | "server";
  code: number;
  reason: string;
  sentAt: string;
};
export type CloudPreviewFlowCredit = PreviewFrameBase<"preview.flow.credit"> & {
  direction: CloudPreviewFlowDirection;
  creditBytes: number;
  sentAt: string;
};

export type CloudPreviewServerFrame =
  | CloudPreviewHttpRequestStart
  | CloudPreviewHttpRequestChunk
  | CloudPreviewHttpRequestEnd
  | CloudPreviewHttpRequestCancel
  | CloudPreviewWebSocketOpen
  | (CloudPreviewWebSocketMessageStart & { direction: "client" })
  | (CloudPreviewWebSocketMessageChunk & { direction: "client" })
  | (CloudPreviewWebSocketMessageEnd & { direction: "client" })
  | (CloudPreviewWebSocketClose & { source: "client" })
  | (CloudPreviewFlowCredit & { direction: "http.response" | "ws.server" });

export type CloudPreviewClientFrame =
  | CloudPreviewHttpResponseStart
  | CloudPreviewHttpResponseChunk
  | CloudPreviewHttpResponseEnd
  | CloudPreviewHttpResponseError
  | CloudPreviewWebSocketOpened
  | (CloudPreviewWebSocketMessageStart & { direction: "server" })
  | (CloudPreviewWebSocketMessageChunk & { direction: "server" })
  | (CloudPreviewWebSocketMessageEnd & { direction: "server" })
  | (CloudPreviewWebSocketClose & { source: "server" })
  | (CloudPreviewFlowCredit & { direction: "http.request" | "ws.client" });

const HOP_BY_HOP_HEADERS = [
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer",
  "transfer-encoding", "upgrade"
] as const;
const REQUEST_BLOCKED_HEADERS = new Set([
  ...HOP_BY_HOP_HEADERS,
  "accept-encoding",
  "host",
  "x-deskcue-token"
]);
const RESPONSE_BLOCKED_HEADERS = new Set([...HOP_BY_HOP_HEADERS, "origin-agent-cluster"]);
const HTTP_METHODS = new Set(["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]);
const ERROR_CODES = new Set([
  "cancelled", "deadline_exceeded", "invalid_request", "preview_unavailable", "upstream_failed"
]);
const CANCEL_REASONS = new Set(["browser_closed", "deadline_exceeded", "machine_disconnected"]);
const RESERVED_PATH_SEGMENTS = new Set(["__deskcue_ticket__"]);
const RESERVED_QUERY_KEYS = new Set(["access_token", "deskcuePreviewTicket", "token"]);
const UTF8_ENCODER = new TextEncoder();

function utf8ByteLength(value: string) {
  return UTF8_ENCODER.encode(value).byteLength;
}

function base64DecodedByteLength(value: string) {
  const paddingBytes = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - paddingBytes;
}

function isHeaders(value: unknown, blockedNames: Set<string>) {
  if (!Array.isArray(value) || value.length > CLOUD_PREVIEW_MAX_HEADER_COUNT) return false;
  const names = new Set<string>();
  let bytes = 0;
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || typeof entry[1] !== "string") return false;
    const name = entry[0].toLowerCase();
    if (name !== entry[0] || blockedNames.has(name) || name.startsWith("x-deskcue-") ||
        (names.has(name) && name !== "set-cookie") || /[\r\n\0]/u.test(entry[1])) return false;
    bytes += utf8ByteLength(name) + utf8ByteLength(entry[1]);
    if (bytes > CLOUD_PREVIEW_MAX_HEADER_BYTES) return false;
    names.add(name);
  }
  return true;
}

function isRelativePath(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("#") ||
      /[\r\n\0]/u.test(value) || utf8ByteLength(value) > CLOUD_PREVIEW_MAX_PATH_BYTES) return false;
  try {
    const url = new URL(value, "http://preview.deskcue.invalid");
    return url.origin === "http://preview.deskcue.invalid" &&
      !url.pathname.split("/").some((segment) => RESERVED_PATH_SEGMENTS.has(segment)) &&
      ![...url.searchParams.keys()].some((key) => RESERVED_QUERY_KEYS.has(key));
  } catch {
    return false;
  }
}

function isProtocol(value: unknown): value is string {
  return typeof value === "string" && /^[!#$%&'*+\-.0-9A-Z^_`a-z|~]{1,128}$/u.test(value);
}

function isProtocols(value: unknown) {
  return Array.isArray(value) && value.length <= 16 && new Set(value).size === value.length && value.every(isProtocol);
}

function isIdentifier(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(value);
}

function isViewerId(value: unknown) {
  return typeof value === "string" && /^[a-z2-7]{24}$/u.test(value);
}

function isTimestamp(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isSha256(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isBase64Chunk(value: unknown) {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) return false;
  const bytes = base64DecodedByteLength(value);
  return bytes > 0 && bytes <= CLOUD_PREVIEW_CHUNK_BYTES;
}

function isIntegerBetween(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function isNullableBoundedInteger(value: unknown, maximum: number) {
  return value === null || isIntegerBetween(value, 0, maximum);
}

function isCloseCode(value: unknown) {
  return isIntegerBetween(value, 1_000, 4_999) && ![1_004, 1_005, 1_006, 1_015].includes(value as number);
}

function invalid(message = "Cloud Preview frame is invalid."): never {
  throw new ProtocolSchemaError(message);
}


function requireVersionAndStream(frame: Record<string, unknown>) {
  if (frame.protocolVersion !== CLOUD_PREVIEW_PROTOCOL_VERSION || !isIdentifier(frame.streamId) ||
      typeof frame.type !== "string" || !CLOUD_PREVIEW_FRAME_TYPES.includes(frame.type as CloudPreviewFrameType)) invalid();
}

function requirePeer(actual: "client" | "server", expected: "client" | "server") {
  if (actual !== expected) invalid("Cloud Preview frame direction is invalid.");
}

function requireMessageDirection(peer: "client" | "server", value: unknown) {
  if (value !== (peer === "server" ? "client" : "server")) invalid();
}

function requireCloseSource(peer: "client" | "server", value: unknown) {
  if (value !== (peer === "server" ? "client" : "server")) invalid();
}

function requireCreditDirection(peer: "client" | "server", value: unknown) {
  const allowed = peer === "server" ? ["http.response", "ws.server"] : ["http.request", "ws.client"];
  if (!allowed.includes(value as string)) invalid();
}

function requireOnly(record: Record<string, unknown>, keys: string[]) {
  const allowed = new Set(keys);
  if (Object.keys(record).length !== keys.length || Object.keys(record).some((key) => !allowed.has(key))) invalid();
}

function requireOwner(value: unknown) {
  const owner = readProtocolObject(value);
  requireOnly(owner, ["kind", "ownerId"]);
  if (owner.kind !== "session" || typeof owner.ownerId !== "string" || !owner.ownerId ||
      utf8ByteLength(owner.ownerId) > 512 || /[\r\n\0]/u.test(owner.ownerId)) invalid();
}

function requireChunk(frame: Record<string, unknown>) {
  requireOnly(frame, ["type", "protocolVersion", "streamId", "sequence", "data"]);
  if (!isIntegerBetween(frame.sequence, 0) || !isBase64Chunk(frame.data)) invalid();
}

function requireTransferEnd(frame: Record<string, unknown>, maxBytes: number) {
  requireOnly(frame, ["type", "protocolVersion", "streamId", "bodyBytes", "chunkCount", "bodySha256", "sentAt"]);
  if (!isIntegerBetween(frame.bodyBytes, 0, maxBytes) ||
      !isIntegerBetween(frame.chunkCount, 0, Math.ceil(maxBytes / CLOUD_PREVIEW_CHUNK_BYTES)) ||
      !isSha256(frame.bodySha256) || !isTimestamp(frame.sentAt)) invalid();
}

function parseFrame(value: unknown, peer: "client"): CloudPreviewClientFrame;
function parseFrame(value: unknown, peer: "server"): CloudPreviewServerFrame;
function parseFrame(value: unknown, peer: "client" | "server"): CloudPreviewClientFrame | CloudPreviewServerFrame;
function parseFrame(value: unknown, peer: "client" | "server") {
  const frame = readProtocolObject(value);
  requireVersionAndStream(frame);
  switch (frame.type) {
    case "preview.http.request.start":
      requirePeer(peer, "server");
      requireOnly(frame, ["type", "protocolVersion", "streamId", "owner", "viewerId", "method", "path", "headers", "contentLength", "deadlineAt", "sentAt"]);
      requireOwner(frame.owner);
      if (!isViewerId(frame.viewerId) || !HTTP_METHODS.has(frame.method as string) || !isRelativePath(frame.path) ||
          !isHeaders(frame.headers, REQUEST_BLOCKED_HEADERS) || !isNullableBoundedInteger(frame.contentLength, CLOUD_PREVIEW_HTTP_MAX_REQUEST_BYTES) ||
          !isTimestamp(frame.deadlineAt) || !isTimestamp(frame.sentAt)) invalid();
      return frame as CloudPreviewHttpRequestStart;
    case "preview.http.request.chunk":
      requirePeer(peer, "server");
      requireChunk(frame);
      return frame as CloudPreviewHttpRequestChunk;
    case "preview.http.request.end":
      requirePeer(peer, "server");
      requireTransferEnd(frame, CLOUD_PREVIEW_HTTP_MAX_REQUEST_BYTES);
      return frame as CloudPreviewHttpRequestEnd;
    case "preview.http.request.cancel":
      requirePeer(peer, "server");
      requireOnly(frame, ["type", "protocolVersion", "streamId", "reason", "sentAt"]);
      if (!CANCEL_REASONS.has(frame.reason as string) || !isTimestamp(frame.sentAt)) invalid();
      return frame as CloudPreviewHttpRequestCancel;
    case "preview.http.response.start":
      requirePeer(peer, "client");
      requireOnly(frame, ["type", "protocolVersion", "streamId", "status", "headers", "contentLength", "sentAt"]);
      if (!isIntegerBetween(frame.status, 100, 599) || !isHeaders(frame.headers, RESPONSE_BLOCKED_HEADERS) ||
          !isNullableBoundedInteger(frame.contentLength, CLOUD_PREVIEW_HTTP_MAX_RESPONSE_BYTES) || !isTimestamp(frame.sentAt)) invalid();
      return frame as CloudPreviewHttpResponseStart;
    case "preview.http.response.chunk":
      requirePeer(peer, "client");
      requireChunk(frame);
      return frame as CloudPreviewHttpResponseChunk;
    case "preview.http.response.end":
      requirePeer(peer, "client");
      requireTransferEnd(frame, CLOUD_PREVIEW_HTTP_MAX_RESPONSE_BYTES);
      return frame as CloudPreviewHttpResponseEnd;
    case "preview.http.response.error":
      requirePeer(peer, "client");
      requireOnly(frame, ["type", "protocolVersion", "streamId", "code", "retryable", "sentAt"]);
      if (!ERROR_CODES.has(frame.code as string) || typeof frame.retryable !== "boolean" || !isTimestamp(frame.sentAt)) invalid();
      return frame as CloudPreviewHttpResponseError;
    case "preview.ws.open":
      requirePeer(peer, "server");
      requireOnly(frame, ["type", "protocolVersion", "streamId", "owner", "viewerId", "path", "headers", "protocols", "deadlineAt", "sentAt"]);
      requireOwner(frame.owner);
      if (!isViewerId(frame.viewerId) || !isRelativePath(frame.path) || !isHeaders(frame.headers, REQUEST_BLOCKED_HEADERS) ||
          !isProtocols(frame.protocols) || !isTimestamp(frame.deadlineAt) || !isTimestamp(frame.sentAt)) invalid();
      return frame as CloudPreviewWebSocketOpen;
    case "preview.ws.opened":
      requirePeer(peer, "client");
      requireOnly(frame, ["type", "protocolVersion", "streamId", "protocol", "headers", "openedAt"]);
      if ((frame.protocol !== null && !isProtocol(frame.protocol)) ||
          !isHeaders(frame.headers, RESPONSE_BLOCKED_HEADERS) || !isTimestamp(frame.openedAt)) invalid();
      return frame as CloudPreviewWebSocketOpened;
    case "preview.ws.message.start":
      requireOnly(frame, ["type", "protocolVersion", "streamId", "direction", "messageId", "binary", "bodyBytes", "chunkCount", "bodySha256", "sentAt"]);
      requireMessageDirection(peer, frame.direction);
      if (!isIdentifier(frame.messageId) || typeof frame.binary !== "boolean" ||
          !isIntegerBetween(frame.bodyBytes, 0, CLOUD_PREVIEW_WS_MAX_MESSAGE_BYTES) ||
          !isIntegerBetween(frame.chunkCount, 0, Math.ceil(CLOUD_PREVIEW_WS_MAX_MESSAGE_BYTES / CLOUD_PREVIEW_CHUNK_BYTES)) ||
          frame.chunkCount !== Math.ceil((frame.bodyBytes as number) / CLOUD_PREVIEW_CHUNK_BYTES) ||
          !isSha256(frame.bodySha256) || !isTimestamp(frame.sentAt)) invalid();
      return frame as CloudPreviewWebSocketMessageStart;
    case "preview.ws.message.chunk":
      requireOnly(frame, ["type", "protocolVersion", "streamId", "direction", "messageId", "sequence", "data"]);
      requireMessageDirection(peer, frame.direction);
      if (!isIdentifier(frame.messageId) || !isIntegerBetween(frame.sequence, 0) || !isBase64Chunk(frame.data)) invalid();
      return frame as CloudPreviewWebSocketMessageChunk;
    case "preview.ws.message.end":
      requireOnly(frame, ["type", "protocolVersion", "streamId", "direction", "messageId", "bodySha256", "sentAt"]);
      requireMessageDirection(peer, frame.direction);
      if (!isIdentifier(frame.messageId) || !isSha256(frame.bodySha256) || !isTimestamp(frame.sentAt)) invalid();
      return frame as CloudPreviewWebSocketMessageEnd;
    case "preview.ws.close":
      requireOnly(frame, ["type", "protocolVersion", "streamId", "source", "code", "reason", "sentAt"]);
      requireCloseSource(peer, frame.source);
      if (!isCloseCode(frame.code) || typeof frame.reason !== "string" || utf8ByteLength(frame.reason) > 123 || !isTimestamp(frame.sentAt)) invalid();
      return frame as CloudPreviewWebSocketClose;
    case "preview.flow.credit":
      requireOnly(frame, ["type", "protocolVersion", "streamId", "direction", "creditBytes", "sentAt"]);
      requireCreditDirection(peer, frame.direction);
      if (!isIntegerBetween(frame.creditBytes, 1, CLOUD_PREVIEW_MAX_CREDIT_BYTES) || !isTimestamp(frame.sentAt)) invalid();
      return frame as CloudPreviewFlowCredit;
    default:
      invalid("Unknown Cloud Preview frame type.");
  }
}

export function parseCloudPreviewServerFrame(value: unknown): CloudPreviewServerFrame {
  return parseFrame(value, "server");
}

export function parseCloudPreviewClientFrame(value: unknown): CloudPreviewClientFrame {
  return parseFrame(value, "client");
}

function parseJson(json: string, peer: "client"): CloudPreviewClientFrame;
function parseJson(json: string, peer: "server"): CloudPreviewServerFrame;
function parseJson(json: string, peer: "client" | "server") {
  if (utf8ByteLength(json) > CLOUD_PREVIEW_MAX_FRAME_BYTES) invalid("Cloud Preview frame is too large.");
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    invalid("Cloud Preview frame is not valid JSON.");
  }
  return parseFrame(value, peer);
}

export function parseCloudPreviewServerJson(json: string): CloudPreviewServerFrame {
  return parseJson(json, "server");
}

export function parseCloudPreviewClientJson(json: string): CloudPreviewClientFrame {
  return parseJson(json, "client");
}
