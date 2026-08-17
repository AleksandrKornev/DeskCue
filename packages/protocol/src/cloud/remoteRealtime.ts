import { ProtocolSchemaError, readProtocolObject } from "../schema.ts";

import {
  REMOTE_REALTIME_CHUNK_BYTES,
  REMOTE_REALTIME_MAX_CLIENT_MESSAGE_BYTES,
  REMOTE_REALTIME_MAX_CLIENT_MESSAGE_CHUNKS,
  REMOTE_REALTIME_MAX_SERVER_MESSAGE_BYTES,
  REMOTE_REALTIME_MAX_SERVER_MESSAGE_CHUNKS
} from "./types.ts";
import type {
  RemoteRealtimeClientFrame,
  RemoteRealtimeCloseMessage,
  RemoteRealtimeClosedMessage,
  RemoteRealtimeOpenMessage,
  RemoteRealtimeOpenedMessage,
  RemoteRealtimeServerFrame
} from "./types.ts";
import {
  isBase64ChunkWithLimit,
  isIdentifier,
  isIsoTimestamp,
  isSafeInteger,
  isSafeIntegerBetween,
  isSha256,
  isStringBetween,
  isUtf8StringBetween,
  isWebSocketCloseCode,
  requireExactVersion,
  requireOnlyKeys
} from "./validation.ts";

export function parseRemoteRealtimePath(value: unknown): string {
  if (typeof value !== "string" || value.length < 2 || value.length > 4_096 ||
      value.includes("#")) {
    throw new ProtocolSchemaError("Cloud remote realtime path is invalid.");
  }
  let url: URL;
  try {
    url = new URL(value, "http://deskcue.local");
  } catch {
    throw new ProtocolSchemaError("Cloud remote realtime path is invalid.");
  }
  if (url.origin !== "http://deskcue.local" || url.pathname !== "/ws" ||
      [...url.searchParams.keys()].some((key) => ![
        "protocolVersion", "protocolCapability", "clientId", "afterCursor"
      ].includes(key))) {
    throw new ProtocolSchemaError("Cloud remote realtime path is not allowlisted.");
  }
  for (const singleton of ["protocolVersion", "clientId", "afterCursor"]) {
    if (url.searchParams.getAll(singleton).length > 1) {
      throw new ProtocolSchemaError("Cloud remote realtime path contains duplicate fields.");
    }
  }
  const version = url.searchParams.get("protocolVersion");
  if (!version || !/^\d{1,9}$/.test(version)) {
    throw new ProtocolSchemaError("Cloud remote realtime protocol version is invalid.");
  }
  const capabilities = url.searchParams.getAll("protocolCapability");
  if (capabilities.length < 1 || capabilities.length > 32 ||
      capabilities.some((item) => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(item))) {
    throw new ProtocolSchemaError("Cloud remote realtime capabilities are invalid.");
  }
  for (const key of ["clientId", "afterCursor"]) {
    const item = url.searchParams.get(key);
    if (item !== null && !isStringBetween(item, 1, 512)) {
      throw new ProtocolSchemaError("Cloud remote realtime query field is invalid.");
    }
  }
  return `${url.pathname}${url.search}`;
}

function parseRemoteRealtimeFrame(
  value: unknown,
  direction: "server" | "client"
): RemoteRealtimeServerFrame | RemoteRealtimeClientFrame {
  const frame = readProtocolObject(value);
  requireExactVersion(frame);
  if (typeof frame.type !== "string" || !frame.type.startsWith("remote.realtime.") ||
      !isIdentifier(frame.streamId, 8, 128)) {
    throw new ProtocolSchemaError("Cloud remote realtime frame is invalid.");
  }
  if (frame.type === "remote.realtime.open" && direction === "server") {
    requireOnlyKeys(frame, [
      "type", "protocolVersion", "streamId", "path", "deadlineAt", "sentAt"
    ]);
    if (typeof frame.path !== "string" || !isIsoTimestamp(frame.deadlineAt) ||
        !isIsoTimestamp(frame.sentAt)) {
      throw new ProtocolSchemaError("Cloud remote realtime open frame is invalid.");
    }
    parseRemoteRealtimePath(frame.path);
    return frame as RemoteRealtimeOpenMessage;
  }
  if (frame.type === "remote.realtime.opened" && direction === "client") {
    requireOnlyKeys(frame, ["type", "protocolVersion", "streamId", "openedAt"]);
    if (!isIsoTimestamp(frame.openedAt)) {
      throw new ProtocolSchemaError("Cloud remote realtime opened frame is invalid.");
    }
    return frame as RemoteRealtimeOpenedMessage;
  }
  if (frame.type === "remote.realtime.close" && direction === "server") {
    requireOnlyKeys(frame, ["type", "protocolVersion", "streamId", "code", "reason", "sentAt"]);
    if (!isWebSocketCloseCode(frame.code) || !isUtf8StringBetween(frame.reason, 0, 123) ||
        !isIsoTimestamp(frame.sentAt)) {
      throw new ProtocolSchemaError("Cloud remote realtime close frame is invalid.");
    }
    return frame as RemoteRealtimeCloseMessage;
  }
  if (frame.type === "remote.realtime.closed" && direction === "client") {
    requireOnlyKeys(frame, ["type", "protocolVersion", "streamId", "code", "reason", "closedAt"]);
    if (!isWebSocketCloseCode(frame.code) || !isUtf8StringBetween(frame.reason, 0, 123) ||
        !isIsoTimestamp(frame.closedAt)) {
      throw new ProtocolSchemaError("Cloud remote realtime closed frame is invalid.");
    }
    return frame as RemoteRealtimeClosedMessage;
  }
  const messageDirection = direction === "server" ? "client" : "server";
  const prefix = `remote.realtime.${messageDirection}.message.`;
  if (!frame.type.startsWith(prefix) || !isIdentifier(frame.messageId, 8, 128)) {
    throw new ProtocolSchemaError("Cloud remote realtime message frame is invalid.");
  }
  const maximumBytes = direction === "server"
    ? REMOTE_REALTIME_MAX_CLIENT_MESSAGE_BYTES
    : REMOTE_REALTIME_MAX_SERVER_MESSAGE_BYTES;
  const maximumChunks = direction === "server"
    ? REMOTE_REALTIME_MAX_CLIENT_MESSAGE_CHUNKS
    : REMOTE_REALTIME_MAX_SERVER_MESSAGE_CHUNKS;
  if (frame.type === `${prefix}start`) {
    requireOnlyKeys(frame, [
      "type", "protocolVersion", "streamId", "messageId", "bodyBytes", "chunkCount",
      "bodySha256", "sentAt"
    ]);
    if (!isSafeIntegerBetween(frame.bodyBytes, 0, maximumBytes) ||
        !isSafeIntegerBetween(frame.chunkCount, 0, maximumChunks) ||
        frame.chunkCount !== Math.ceil((frame.bodyBytes as number) / REMOTE_REALTIME_CHUNK_BYTES) ||
        !isSha256(frame.bodySha256) || !isIsoTimestamp(frame.sentAt)) {
      throw new ProtocolSchemaError("Cloud remote realtime message metadata is invalid.");
    }
    return frame as RemoteRealtimeServerFrame | RemoteRealtimeClientFrame;
  }
  if (frame.type === `${prefix}chunk`) {
    requireOnlyKeys(frame, [
      "type", "protocolVersion", "streamId", "messageId", "index", "data"
    ]);
    if (!isSafeInteger(frame.index, 0) ||
        !isBase64ChunkWithLimit(frame.data, REMOTE_REALTIME_CHUNK_BYTES)) {
      throw new ProtocolSchemaError("Cloud remote realtime message chunk is invalid.");
    }
    return frame as RemoteRealtimeServerFrame | RemoteRealtimeClientFrame;
  }
  if (frame.type === `${prefix}end`) {
    requireOnlyKeys(frame, [
      "type", "protocolVersion", "streamId", "messageId", "bodySha256", "sentAt"
    ]);
    if (!isSha256(frame.bodySha256) || !isIsoTimestamp(frame.sentAt)) {
      throw new ProtocolSchemaError("Cloud remote realtime message end is invalid.");
    }
    return frame as RemoteRealtimeServerFrame | RemoteRealtimeClientFrame;
  }
  throw new ProtocolSchemaError("Unknown Cloud remote realtime frame.");
}

export function parseRemoteRealtimeServerFrame(value: unknown): RemoteRealtimeServerFrame {
  return parseRemoteRealtimeFrame(value, "server") as RemoteRealtimeServerFrame;
}

export function parseRemoteRealtimeClientFrame(value: unknown): RemoteRealtimeClientFrame {
  return parseRemoteRealtimeFrame(value, "client") as RemoteRealtimeClientFrame;
}

