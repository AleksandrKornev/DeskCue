import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  CLOUD_PREVIEW_CHUNK_BYTES,
  CLOUD_PREVIEW_MAX_CREDIT_BYTES,
  ProtocolSchemaError,
  parseCloudPreviewClientFrame,
  parseCloudPreviewServerFrame
} from "../dist/index.js";

const timestamp = "2026-08-11T10:00:00.000Z";
const emptySha256 = createHash("sha256").update("").digest("hex");

test("accepts exact bounded Cloud Preview HTTP streaming frames", () => {
  assert.equal(parseCloudPreviewServerFrame({
    type: "preview.http.request.start",
    protocolVersion: 1,
    streamId: "preview_http_01",
    owner: { kind: "session", ownerId: "session-1" },
    viewerId: "abcdefghijklmnopqrstuvwx",
    method: "GET",
    path: "/dashboard?mode=compact",
    headers: [["accept", "text/html"]],
    contentLength: 0,
    deadlineAt: timestamp,
    sentAt: timestamp
  }).path, "/dashboard?mode=compact");
  assert.equal(parseCloudPreviewServerFrame({
    type: "preview.http.request.end",
    protocolVersion: 1,
    streamId: "preview_http_01",
    bodyBytes: 0,
    chunkCount: 0,
    bodySha256: emptySha256,
    sentAt: timestamp
  }).bodyBytes, 0);
  assert.equal(parseCloudPreviewClientFrame({
    type: "preview.http.response.start",
    protocolVersion: 1,
    streamId: "preview_http_01",
    status: 200,
    headers: [["content-type", "text/html; charset=utf-8"]],
    contentLength: null,
    sentAt: timestamp
  }).status, 200);
});

test("keeps Preview request and response directions separate", () => {
  const request = {
    type: "preview.http.request.chunk",
    protocolVersion: 1,
    streamId: "preview_http_01",
    sequence: 0,
    data: Buffer.from("body").toString("base64")
  };
  assert.throws(() => parseCloudPreviewClientFrame(request), ProtocolSchemaError);
  assert.equal(parseCloudPreviewServerFrame(request).sequence, 0);

  const response = { ...request, type: "preview.http.response.chunk" };
  assert.throws(() => parseCloudPreviewServerFrame(response), ProtocolSchemaError);
  assert.equal(parseCloudPreviewClientFrame(response).sequence, 0);
});

test("rejects unsafe paths, owner widening, service headers and oversized chunks", () => {
  const start = {
    type: "preview.http.request.start",
    protocolVersion: 1,
    streamId: "preview_http_01",
    owner: { kind: "session", ownerId: "session-1" },
    viewerId: "abcdefghijklmnopqrstuvwx",
    method: "GET",
    path: "/",
    headers: [],
    contentLength: 0,
    deadlineAt: timestamp,
    sentAt: timestamp
  };
  for (const widened of [
    { ...start, path: "//internal.example/path" },
    { ...start, path: "/?access_token=secret" },
    { ...start, owner: { kind: "local-llm", ownerId: "chat-1" } },
    { ...start, headers: [["x-deskcue-token", "secret"]] }
  ]) {
    assert.throws(() => parseCloudPreviewServerFrame(widened), ProtocolSchemaError);
  }
  assert.throws(() => parseCloudPreviewServerFrame({
    type: "preview.http.request.chunk",
    protocolVersion: 1,
    streamId: "preview_http_01",
    sequence: 0,
    data: Buffer.alloc(CLOUD_PREVIEW_CHUNK_BYTES + 1).toString("base64")
  }), ProtocolSchemaError);
});

test("validates WebSocket messages and explicit flow credit", () => {
  assert.equal(parseCloudPreviewServerFrame({
    type: "preview.ws.open",
    protocolVersion: 1,
    streamId: "preview_ws_01",
    owner: { kind: "session", ownerId: "session-1" },
    viewerId: "abcdefghijklmnopqrstuvwx",
    path: "/hmr",
    headers: [["user-agent", "DeskCue fixture"]],
    protocols: ["vite-hmr"],
    deadlineAt: timestamp,
    sentAt: timestamp
  }).path, "/hmr");
  assert.equal(parseCloudPreviewServerFrame({
    type: "preview.flow.credit",
    protocolVersion: 1,
    streamId: "preview_ws_01",
    direction: "ws.server",
    creditBytes: CLOUD_PREVIEW_MAX_CREDIT_BYTES,
    sentAt: timestamp
  }).creditBytes, CLOUD_PREVIEW_MAX_CREDIT_BYTES);
  assert.equal(parseCloudPreviewClientFrame({
    type: "preview.flow.credit",
    protocolVersion: 1,
    streamId: "preview_ws_01",
    direction: "ws.client",
    creditBytes: 64 * 1024,
    sentAt: timestamp
  }).direction, "ws.client");
  assert.throws(() => parseCloudPreviewServerFrame({
    type: "preview.flow.credit",
    protocolVersion: 1,
    streamId: "preview_ws_01",
    direction: "ws.client",
    creditBytes: CLOUD_PREVIEW_MAX_CREDIT_BYTES + 1,
    sentAt: timestamp
  }), ProtocolSchemaError);
});
