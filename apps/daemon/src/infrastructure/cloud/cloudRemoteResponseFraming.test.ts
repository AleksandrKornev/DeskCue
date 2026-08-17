import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { REMOTE_CONTROL_CHUNK_BYTES, REMOTE_CONTROL_MAX_RESPONSE_BYTES } from "@deskcue/protocol";
import type {
  CloudRelayClientFrame,
  CloudRemoteReadResponseFrame,
  RemoteControlResponseFrame
} from "@deskcue/protocol";

import {
  canonicalCloudJson,
  createCloudControlReceiptBody,
  createRemoteControlResponseFrames,
  createRemoteReadResponseFrames
} from "./cloudRemoteResponseFraming.ts";

const TIMESTAMPS = {
  start: "2026-08-11T05:10:00.000Z",
  end: "2026-08-11T05:10:00.001Z"
};

test("canonical Cloud JSON is stable across nested object key order", () => {
  const left = {
    z: [{ b: 2, a: 1 }],
    a: { d: true, c: null }
  };
  const right = {
    a: { c: null, d: true },
    z: [{ a: 1, b: 2 }]
  };

  assert.equal(canonicalCloudJson(left), canonicalCloudJson(right));
  assert.equal(
    canonicalCloudJson(left),
    "{\"a\":{\"c\":null,\"d\":true},\"z\":[{\"a\":1,\"b\":2}]}"
  );
});

test("control receipt shaping persists only the accepted session identity", () => {
  assert.deepEqual(createCloudControlReceiptBody({
    status: 200,
    body: { id: "session-1", input: "private input", logs: ["private log"] }
  }), {
    accepted: true,
    sessionId: "session-1"
  });
  assert.deepEqual(createCloudControlReceiptBody({
    status: 500,
    body: { id: "session-1", error: "private failure" }
  }), {
    accepted: false,
    error: "remote_control_failed"
  });
  assert.deepEqual(createCloudControlReceiptBody({ status: 200, body: { accepted: true } }), {
    accepted: false,
    error: "remote_control_failed"
  });
});

function assembleBody(
  frames: Array<CloudRemoteReadResponseFrame | RemoteControlResponseFrame>,
  chunkType: string
) {
  const chunks = frames
    .filter((frame) => frame.type === chunkType)
    .sort((left, right) =>
      Number("index" in left ? left.index : -1) - Number("index" in right ? right.index : -1)
    )
    .map((frame) => Buffer.from("data" in frame ? frame.data : "", "base64"));
  return Buffer.concat(chunks);
}

test("remote read response framing emits exact typed chunks and digest", () => {
  const responseBody = { sessions: [], padding: "x".repeat(20_000) };
  const frames = createRemoteReadResponseFrames(
    "request-read-1",
    { status: 206, body: responseBody },
    TIMESTAMPS
  );
  const clientFrames: CloudRelayClientFrame[] = frames;
  assert.equal(clientFrames.length, frames.length);
  const start = frames[0];
  const end = frames.at(-1);
  assert.equal(start?.type, "remote.read.response.start");
  assert.equal(end?.type, "remote.read.response.end");
  if (start?.type !== "remote.read.response.start" || end?.type !== "remote.read.response.end") {
    throw new Error("Expected bounded remote read response frames.");
  }
  assert.equal(start.status, 206);
  assert.equal(start.sentAt, TIMESTAMPS.start);
  assert.equal(end.sentAt, TIMESTAMPS.end);
  assert.ok(start.chunkCount > 1);
  const body = assembleBody(frames, "remote.read.response.chunk");
  assert.equal(body.byteLength, start.bodyBytes);
  assert.equal(createHash("sha256").update(body).digest("hex"), start.bodySha256);
  assert.equal(end.bodySha256, start.bodySha256);
  assert.deepEqual(JSON.parse(body.toString("utf8")), responseBody);
});

test("remote read response framing preserves bounded binary asset bytes", () => {
  const responseBody = Buffer.from([0x44, 0x43, 0x41, 0x31, 0, 0, 0, 0, 0x89, 0x50, 0x4e, 0x47]);
  const frames = createRemoteReadResponseFrames(
    "request-asset-1",
    { status: 200, body: responseBody, binary: true },
    TIMESTAMPS
  );
  const body = assembleBody(frames, "remote.read.response.chunk");

  assert.deepEqual(body, responseBody);
  assert.equal(frames[0]?.type, "remote.read.response.start");
  if (frames[0]?.type === "remote.read.response.start") {
    assert.equal(frames[0].bodyBytes, responseBody.byteLength);
  }
});

test("remote control response framing replaces oversized private bodies with a bounded error", () => {
  const frames = createRemoteControlResponseFrames(
    "request-control-1",
    { status: 200, body: { private: "x".repeat(REMOTE_CONTROL_MAX_RESPONSE_BYTES + 1) } },
    TIMESTAMPS
  );
  const clientFrames: CloudRelayClientFrame[] = frames;
  assert.equal(clientFrames.length, frames.length);
  const start = frames[0];
  assert.equal(start?.type, "remote.control.response.start");
  if (start?.type !== "remote.control.response.start") {
    throw new Error("Expected bounded remote control response frames.");
  }
  assert.equal(start.status, 502);
  assert.ok(start.bodyBytes <= REMOTE_CONTROL_CHUNK_BYTES);
  assert.deepEqual(
    JSON.parse(assembleBody(frames, "remote.control.response.chunk").toString("utf8")),
    { error: "remote_control_response_too_large" }
  );
});
