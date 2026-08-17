import { ProtocolSchemaError, readProtocolObject } from "../schema.ts";

import {
  REMOTE_CONTROL_CHUNK_BYTES,
  REMOTE_CONTROL_MAX_REQUEST_BYTES,
  REMOTE_CONTROL_MAX_RESPONSE_BYTES,
  REMOTE_CONTROL_OPERATIONS
} from "./types.ts";
import type {
  RemoteControlOperation,
  RemoteControlOperationInputMap,
  RemoteControlRequestFrame,
  RemoteControlResponseFrame,
  ValidatedRemoteControlOperationInput
} from "./types.ts";
import {
  invalidControlInput,
  isBase64ChunkWithLimit,
  isIdentifier,
  isIsoTimestamp,
  isSafeInteger,
  isSafeIntegerBetween,
  isSha256,
  isStringBetween,
  requireExactVersion,
  requireOnlyKeys
} from "./validation.ts";

export function parseRemoteControlOperationInput<Operation extends RemoteControlOperation>(
  operation: Operation,
  value: unknown
): RemoteControlOperationInputMap[Operation];
export function parseRemoteControlOperationInput(
  operation: RemoteControlOperation,
  value: unknown
): ValidatedRemoteControlOperationInput {
  if (!REMOTE_CONTROL_OPERATIONS.includes(operation)) invalidControlInput();
  const input = readProtocolObject(value);
  if (operation === "source.attach") {
    requireOnlyKeys(input, ["agentSessionId", "prompt"]);
    if (!isStringBetween(input.agentSessionId, 1, 512) ||
        (input.prompt !== undefined && !isStringBetween(input.prompt, 1, 64 * 1024))) {
      invalidControlInput();
    }
    return input as RemoteControlOperationInputMap["source.attach"];
  }
  if (operation === "managed.input") {
    requireOnlyKeys(input, ["sessionId", "input"]);
    if (!isStringBetween(input.sessionId, 1, 512) ||
        !isStringBetween(input.input, 1, 64 * 1024)) {
      invalidControlInput();
    }
    return input as RemoteControlOperationInputMap["managed.input"];
  }
  if (operation === "preview.configure") {
    requireOnlyKeys(input, ["sessionId", "port", "networkMode"]);
    if (!isStringBetween(input.sessionId, 1, 512) ||
        !isSafeIntegerBetween(input.port, 1, 65_535) ||
        input.networkMode !== "device-direct" && input.networkMode !== "deskcue-host") {
      invalidControlInput();
    }
    return input as RemoteControlOperationInputMap["preview.configure"];
  }
  if (operation === "preview.stop") {
    requireOnlyKeys(input, ["sessionId"]);
    if (!isStringBetween(input.sessionId, 1, 512)) invalidControlInput();
    return input as RemoteControlOperationInputMap["preview.stop"];
  }
  requireOnlyKeys(input, ["sessionId"]);
  if (!isStringBetween(input.sessionId, 1, 512)) invalidControlInput();
  return input as RemoteControlOperationInputMap["managed.interrupt" | "managed.stop"];
}

function parseRemoteControlFrame(
  value: unknown,
  direction: "request" | "response"
): RemoteControlRequestFrame | RemoteControlResponseFrame {
  const frame = readProtocolObject(value);
  requireExactVersion(frame);
  const prefix = `remote.control.${direction}.`;
  if (typeof frame.type !== "string" || !frame.type.startsWith(prefix) ||
      !isIdentifier(frame.requestId, 8, 128)) {
    throw new ProtocolSchemaError("Cloud remote control frame is invalid.");
  }
  if (frame.type === `${prefix}start`) {
    const commonKeys = [
      "type", "protocolVersion", "requestId", "bodyBytes", "chunkCount",
      "bodySha256", "sentAt"
    ];
    requireOnlyKeys(frame, direction === "request"
      ? [...commonKeys, "commandId", "operation", "deadlineAt"]
      : [...commonKeys, "status"]);
    const maximumBytes = direction === "request"
      ? REMOTE_CONTROL_MAX_REQUEST_BYTES
      : REMOTE_CONTROL_MAX_RESPONSE_BYTES;
    if (!isSafeIntegerBetween(frame.bodyBytes, 0, maximumBytes) ||
        !isSafeIntegerBetween(
          frame.chunkCount,
          0,
          Math.ceil(maximumBytes / REMOTE_CONTROL_CHUNK_BYTES)
        ) ||
        frame.chunkCount !== Math.ceil((frame.bodyBytes as number) / REMOTE_CONTROL_CHUNK_BYTES) ||
        !isSha256(frame.bodySha256) || !isIsoTimestamp(frame.sentAt)) {
      throw new ProtocolSchemaError("Cloud remote control frame metadata is invalid.");
    }
    if (direction === "request") {
      if (!isIdentifier(frame.commandId, 8, 128) ||
          !REMOTE_CONTROL_OPERATIONS.includes(frame.operation as RemoteControlOperation) ||
          !isIsoTimestamp(frame.deadlineAt)) {
        throw new ProtocolSchemaError("Cloud remote control request metadata is invalid.");
      }
    } else if (!isSafeIntegerBetween(frame.status, 200, 599)) {
      throw new ProtocolSchemaError("Cloud remote control response status is invalid.");
    }
    return frame as RemoteControlRequestFrame | RemoteControlResponseFrame;
  }
  if (frame.type === `${prefix}chunk`) {
    requireOnlyKeys(frame, ["type", "protocolVersion", "requestId", "index", "data"]);
    if (!isSafeInteger(frame.index, 0) ||
        !isBase64ChunkWithLimit(frame.data, REMOTE_CONTROL_CHUNK_BYTES)) {
      throw new ProtocolSchemaError("Cloud remote control chunk is invalid.");
    }
    return frame as RemoteControlRequestFrame | RemoteControlResponseFrame;
  }
  if (frame.type === `${prefix}end`) {
    requireOnlyKeys(frame, ["type", "protocolVersion", "requestId", "bodySha256", "sentAt"]);
    if (!isSha256(frame.bodySha256) || !isIsoTimestamp(frame.sentAt)) {
      throw new ProtocolSchemaError("Cloud remote control end frame is invalid.");
    }
    return frame as RemoteControlRequestFrame | RemoteControlResponseFrame;
  }
  throw new ProtocolSchemaError("Unknown Cloud remote control frame.");
}

export function parseRemoteControlRequestFrame(value: unknown): RemoteControlRequestFrame {
  return parseRemoteControlFrame(value, "request") as RemoteControlRequestFrame;
}

export function parseRemoteControlResponseFrame(value: unknown): RemoteControlResponseFrame {
  return parseRemoteControlFrame(value, "response") as RemoteControlResponseFrame;
}

