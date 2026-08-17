import { createHash } from "node:crypto";

import {
  CLOUD_RELAY_PROTOCOL_VERSION,
  CLOUD_REMOTE_READ_CHUNK_BYTES,
  CLOUD_REMOTE_READ_MAX_RESPONSE_BYTES,
  REMOTE_CONTROL_CHUNK_BYTES,
  REMOTE_CONTROL_MAX_RESPONSE_BYTES
} from "@deskcue/protocol/cloud";
import type {
  CloudRelayClientFrame,
  CloudRemoteReadResponseFrame,
  RemoteControlResponseFrame
} from "@deskcue/protocol/cloud";

type CloudResponseResult = {
  status: number;
  body: unknown;
  binary?: boolean;
};

type ResponseTimestamps = {
  end: string;
  start: string;
};

export function canonicalCloudJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalCloudJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalCloudJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createCloudControlReceiptBody(result: CloudResponseResult) {
  if (result.status >= 200 && result.status < 300 &&
      result.body && typeof result.body === "object" && !Array.isArray(result.body)) {
    const sessionId = (result.body as Record<string, unknown>).id;
    if (typeof sessionId === "string" && sessionId) {
      return { accepted: true, sessionId };
    }
  }
  return { accepted: false, error: "remote_control_failed" };
}

function serializeBody(body: unknown) {
  return Buffer.from(JSON.stringify(body), "utf8");
}

function sha256(body: Buffer) {
  return createHash("sha256").update(body).digest("hex");
}

function splitBuffer(body: Buffer, chunkBytes: number) {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < body.byteLength; offset += chunkBytes) {
    chunks.push(body.subarray(offset, offset + chunkBytes));
  }
  return chunks;
}

export function createRemoteReadResponseFrames(
  requestId: string,
  result: CloudResponseResult,
  timestamps: ResponseTimestamps
): Extract<CloudRelayClientFrame, CloudRemoteReadResponseFrame>[] {
  let body = result.binary && result.body instanceof Uint8Array
    ? Buffer.from(result.body)
    : serializeBody(result.body);
  let status = result.status;
  if (body.byteLength > CLOUD_REMOTE_READ_MAX_RESPONSE_BYTES) {
    status = 502;
    body = serializeBody({ error: "remote_response_too_large" });
  }
  const bodySha256 = sha256(body);
  const chunks = splitBuffer(body, CLOUD_REMOTE_READ_CHUNK_BYTES);
  return [
    {
      type: "remote.read.response.start",
      protocolVersion: CLOUD_RELAY_PROTOCOL_VERSION,
      requestId,
      status,
      bodyBytes: body.byteLength,
      chunkCount: chunks.length,
      bodySha256,
      sentAt: timestamps.start
    },
    ...chunks.map((chunk, index) => ({
      type: "remote.read.response.chunk" as const,
      protocolVersion: CLOUD_RELAY_PROTOCOL_VERSION,
      requestId,
      index,
      data: chunk.toString("base64")
    })),
    {
      type: "remote.read.response.end",
      protocolVersion: CLOUD_RELAY_PROTOCOL_VERSION,
      requestId,
      bodySha256,
      sentAt: timestamps.end
    }
  ];
}

export function createRemoteControlResponseFrames(
  requestId: string,
  result: CloudResponseResult,
  timestamps: ResponseTimestamps
): Extract<CloudRelayClientFrame, RemoteControlResponseFrame>[] {
  let body = serializeBody(result.body);
  let status = result.status;
  if (body.byteLength > REMOTE_CONTROL_MAX_RESPONSE_BYTES) {
    status = 502;
    body = serializeBody({ error: "remote_control_response_too_large" });
  }
  const bodySha256 = sha256(body);
  const chunks = splitBuffer(body, REMOTE_CONTROL_CHUNK_BYTES);
  return [
    {
      type: "remote.control.response.start",
      protocolVersion: CLOUD_RELAY_PROTOCOL_VERSION,
      requestId,
      status,
      bodyBytes: body.byteLength,
      chunkCount: chunks.length,
      bodySha256,
      sentAt: timestamps.start
    },
    ...chunks.map((chunk, index) => ({
      type: "remote.control.response.chunk" as const,
      protocolVersion: CLOUD_RELAY_PROTOCOL_VERSION,
      requestId,
      index,
      data: chunk.toString("base64")
    })),
    {
      type: "remote.control.response.end",
      protocolVersion: CLOUD_RELAY_PROTOCOL_VERSION,
      requestId,
      bodySha256,
      sentAt: timestamps.end
    }
  ];
}
