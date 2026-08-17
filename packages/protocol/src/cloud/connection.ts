import { ProtocolSchemaError, readProtocolObject } from "../schema.ts";

import { parseCloudRemoteReadRequestFrame } from "./remoteRead.ts";
import { parseRemoteControlRequestFrame } from "./remoteControl.ts";
import { parseRemoteRealtimeServerFrame } from "./remoteRealtime.ts";
import {
  CLOUD_RELAY_CAPABILITIES,
  CLOUD_RELAY_MAX_FRAME_BYTES,
  CLOUD_RELAY_PROTOCOL_VERSION,
  CLOUD_RELAY_STREAM
} from "./types.ts";
import type {
  CloudRelayAck,
  CloudRelayCapability,
  CloudRelayRejected,
  CloudRelayServerFrame,
  CloudRelayWelcome,
  ConnectCloudInput,
  StartCloudEnrollmentAttemptInput,
  UpdateCloudPermissionsInput,
  UpdateCloudSessionDisclosureInput
} from "./types.ts";
import {
  isIdentifier,
  isIsoTimestamp,
  isSafeInteger,
  readStringArray,
  requireExactVersion,
  requireOnlyKeys
} from "./validation.ts";

export function normalizeCloudOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ProtocolSchemaError("Cloud origin must be a valid URL.");
  }
  const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new ProtocolSchemaError("Cloud origin must use HTTPS (HTTP is allowed only for loopback development).");
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new ProtocolSchemaError("Cloud origin must not include credentials, a path, query, or fragment.");
  }
  return url.origin;
}

function parseWelcome(frame: Record<string, unknown>): CloudRelayWelcome {
  requireOnlyKeys(frame, [
    "type", "protocolVersion", "connectionId", "machineId", "negotiatedCapabilities",
    "streamPositions", "heartbeatIntervalMs", "maxFrameBytes", "connectedAt"
  ]);
  const negotiatedCapabilities = readStringArray(frame.negotiatedCapabilities);
  const streamPositions = Array.isArray(frame.streamPositions)
    ? frame.streamPositions.map((value) => {
        const position = readProtocolObject(value);
        requireOnlyKeys(position, ["stream", "nextSequence"]);
        if (position.stream !== CLOUD_RELAY_STREAM || !isSafeInteger(position.nextSequence, 1)) {
          throw new ProtocolSchemaError("Cloud relay stream position is invalid.");
        }
        return { stream: CLOUD_RELAY_STREAM, nextSequence: position.nextSequence };
      })
    : null;
  if (
    !isIdentifier(frame.connectionId, 1, 128) ||
    !isIdentifier(frame.machineId, 1, 128) ||
    !negotiatedCapabilities ||
    new Set(negotiatedCapabilities).size !== negotiatedCapabilities.length ||
    negotiatedCapabilities.some((item) => !CLOUD_RELAY_CAPABILITIES.includes(item as CloudRelayCapability)) ||
    !streamPositions ||
    streamPositions.length !== 1 ||
    !isSafeInteger(frame.heartbeatIntervalMs, 1_000) ||
    !isSafeInteger(frame.maxFrameBytes, 1) ||
    frame.maxFrameBytes > CLOUD_RELAY_MAX_FRAME_BYTES ||
    !isIsoTimestamp(frame.connectedAt)
  ) {
    throw new ProtocolSchemaError("Cloud relay welcome frame is invalid.");
  }
  return {
    type: "relay.welcome",
    protocolVersion: CLOUD_RELAY_PROTOCOL_VERSION,
    connectionId: frame.connectionId,
    machineId: frame.machineId,
    negotiatedCapabilities: negotiatedCapabilities as CloudRelayCapability[],
    streamPositions,
    heartbeatIntervalMs: frame.heartbeatIntervalMs,
    maxFrameBytes: frame.maxFrameBytes,
    connectedAt: frame.connectedAt
  };
}

function parseRejected(frame: Record<string, unknown>): CloudRelayRejected {
  requireOnlyKeys(frame, [
    "type", "protocolVersion", "code", "retryable", "rejectedAt"
  ]);
  const codes: CloudRelayRejected["code"][] = [
    "INVALID_HELLO", "AUTHENTICATION_FAILED", "MACHINE_REVOKED",
    "UNSUPPORTED_PROTOCOL_VERSION", "NO_COMMON_CAPABILITIES"
  ];
  if (!codes.includes(frame.code as CloudRelayRejected["code"]) || typeof frame.retryable !== "boolean" || !isIsoTimestamp(frame.rejectedAt)) {
    throw new ProtocolSchemaError("Cloud relay rejection frame is invalid.");
  }
  return {
    type: "relay.rejected",
    protocolVersion: CLOUD_RELAY_PROTOCOL_VERSION,
    code: frame.code as CloudRelayRejected["code"],
    retryable: frame.retryable,
    rejectedAt: frame.rejectedAt
  };
}

function parseAck(frame: Record<string, unknown>): CloudRelayAck {
  requireOnlyKeys(frame, frame.accepted === false
    ? [
        "type", "protocolVersion", "messageId", "stream", "ackedSequence",
        "receivedAt", "accepted", "error"
      ]
    : [
        "type", "protocolVersion", "messageId", "stream", "ackedSequence",
        "receivedAt", "accepted"
      ]);
  if (
    !isIdentifier(frame.messageId, 1, 128) ||
    frame.stream !== CLOUD_RELAY_STREAM ||
    !isSafeInteger(frame.ackedSequence, 0) ||
    !isIsoTimestamp(frame.receivedAt)
  ) {
    throw new ProtocolSchemaError("Cloud relay acknowledgement frame is invalid.");
  }
  const base = {
    type: "relay.ack" as const,
    protocolVersion: CLOUD_RELAY_PROTOCOL_VERSION,
    messageId: frame.messageId,
    stream: CLOUD_RELAY_STREAM,
    ackedSequence: frame.ackedSequence,
    receivedAt: frame.receivedAt
  };
  if (frame.accepted === true) return { ...base, accepted: true };
  const error = readProtocolObject(frame.error);
  requireOnlyKeys(error, ["code", "retryable"]);
  const codes = ["INVALID_ENVELOPE", "INVALID_PAYLOAD", "CAPABILITY_NOT_NEGOTIATED", "CONNECTION_NOT_ACTIVE", "SEQUENCE_GAP", "RATE_LIMITED", "INTERNAL_ERROR"] as const;
  if (frame.accepted !== false || !codes.includes(error.code as typeof codes[number]) || typeof error.retryable !== "boolean") {
    throw new ProtocolSchemaError("Cloud relay negative acknowledgement is invalid.");
  }
  return {
    ...base,
    accepted: false,
    error: { code: error.code as typeof codes[number], retryable: error.retryable }
  };
}

export function parseConnectCloudInput(value: unknown): ConnectCloudInput {
  const input = readProtocolObject(value);
  requireOnlyKeys(input, [
    "cloudOrigin", "enrollmentTicket", "displayName", "allowRemoteRead", "allowRemoteFiles",
    "allowRemoteControl", "allowRemotePreview"
  ]);
  if (
    typeof input.cloudOrigin !== "string" ||
    typeof input.enrollmentTicket !== "string" ||
    typeof input.displayName !== "string" ||
    typeof input.allowRemoteRead !== "boolean" ||
    (input.allowRemoteFiles !== undefined && typeof input.allowRemoteFiles !== "boolean") ||
    (input.allowRemoteControl !== undefined && typeof input.allowRemoteControl !== "boolean") ||
    (input.allowRemotePreview !== undefined && typeof input.allowRemotePreview !== "boolean")
  ) {
    throw new ProtocolSchemaError(
      "Cloud connection requires cloudOrigin, enrollmentTicket, and displayName."
    );
  }

  const cloudOrigin = normalizeCloudOrigin(input.cloudOrigin);
  const enrollmentTicket = input.enrollmentTicket.trim();
  const displayName = input.displayName.trim();
  if (enrollmentTicket.length < 8 || enrollmentTicket.length > 4096) {
    throw new ProtocolSchemaError("Cloud enrollment ticket is invalid.");
  }
  if (displayName.length < 1 || displayName.length > 120) {
    throw new ProtocolSchemaError("Cloud machine display name is invalid.");
  }
  return {
    cloudOrigin,
    enrollmentTicket,
    displayName,
    allowRemoteRead: input.allowRemoteRead,
    allowRemoteFiles: input.allowRemoteFiles === true,
    allowRemoteControl: input.allowRemoteControl === true,
    allowRemotePreview: input.allowRemotePreview === true
  };
}

export function parseStartCloudEnrollmentAttemptInput(
  value: unknown
): StartCloudEnrollmentAttemptInput {
  const input = readProtocolObject(value);
  requireOnlyKeys(input, [
    "cloudOrigin", "displayName", "allowRemoteRead", "allowRemoteFiles",
    "allowRemoteControl", "allowRemotePreview"
  ]);
  if (
    typeof input.cloudOrigin !== "string" ||
    typeof input.displayName !== "string" ||
    typeof input.allowRemoteRead !== "boolean" ||
    (input.allowRemoteFiles !== undefined && typeof input.allowRemoteFiles !== "boolean") ||
    (input.allowRemoteControl !== undefined && typeof input.allowRemoteControl !== "boolean") ||
    (input.allowRemotePreview !== undefined && typeof input.allowRemotePreview !== "boolean")
  ) {
    throw new ProtocolSchemaError("Cloud enrollment attempt input is invalid.");
  }
  const cloudOrigin = normalizeCloudOrigin(input.cloudOrigin);
  const displayName = input.displayName.trim();
  if (displayName.length < 1 || displayName.length > 120) {
    throw new ProtocolSchemaError("Cloud machine display name is invalid.");
  }
  return {
    cloudOrigin,
    displayName,
    allowRemoteRead: input.allowRemoteRead,
    allowRemoteFiles: input.allowRemoteFiles === true,
    allowRemoteControl: input.allowRemoteControl === true,
    allowRemotePreview: input.allowRemotePreview === true
  };
}

export function parseUpdateCloudSessionDisclosureInput(
  value: unknown
): UpdateCloudSessionDisclosureInput {
  const input = readProtocolObject(value);
  requireOnlyKeys(input, ["enabled"]);
  if (typeof input.enabled !== "boolean") {
    throw new ProtocolSchemaError("Cloud session label disclosure input is invalid.");
  }
  return { enabled: input.enabled };
}

export function parseUpdateCloudPermissionsInput(
  value: unknown
): UpdateCloudPermissionsInput {
  const input = readProtocolObject(value);
  requireOnlyKeys(input, [
    "allowRemoteRead",
    "allowRemoteFiles",
    "allowRemoteControl",
    "allowRemotePreview"
  ]);
  if (
    typeof input.allowRemoteRead !== "boolean" ||
    typeof input.allowRemoteFiles !== "boolean" ||
    typeof input.allowRemoteControl !== "boolean" ||
    typeof input.allowRemotePreview !== "boolean"
  ) {
    throw new ProtocolSchemaError("Cloud permissions input is invalid.");
  }
  return {
    allowRemoteRead: input.allowRemoteRead,
    allowRemoteFiles: input.allowRemoteFiles,
    allowRemoteControl: input.allowRemoteControl,
    allowRemotePreview: input.allowRemotePreview
  };
}

export function parseCloudRelayServerJson(json: string): CloudRelayServerFrame {
  if (new TextEncoder().encode(json).byteLength > CLOUD_RELAY_MAX_FRAME_BYTES) {
    throw new ProtocolSchemaError("Cloud relay frame exceeds the byte limit.");
  }
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    throw new ProtocolSchemaError("Cloud relay frame is not valid JSON.");
  }
  const frame = readProtocolObject(value);
  requireExactVersion(frame);
  if (frame.type === "relay.welcome") return parseWelcome(frame);
  if (frame.type === "relay.rejected") return parseRejected(frame);
  if (frame.type === "relay.ack") return parseAck(frame);
  if (typeof frame.type === "string" && frame.type.startsWith("remote.read.request.")) {
    return parseCloudRemoteReadRequestFrame(frame);
  }
  if (typeof frame.type === "string" && frame.type.startsWith("remote.control.request.")) {
    return parseRemoteControlRequestFrame(frame);
  }
  if (typeof frame.type === "string" && (
    frame.type === "remote.realtime.open" ||
    frame.type === "remote.realtime.close" ||
    frame.type.startsWith("remote.realtime.client.message.")
  )) {
    return parseRemoteRealtimeServerFrame(frame);
  }
  throw new ProtocolSchemaError("Unknown Cloud relay server frame.");
}
