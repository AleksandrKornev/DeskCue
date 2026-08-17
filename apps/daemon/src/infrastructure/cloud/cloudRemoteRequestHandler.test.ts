import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { CloudRelayClientFrame } from "@deskcue/protocol";
import type { CloudConnectorProfile } from "#persistence/cloud/cloudConnectorStore";

import { CloudRemoteRequestHandler } from "./cloudRemoteRequestHandler.ts";

test("workspace file reads require their separately negotiated local grant", () => {
  const profile: CloudConnectorProfile = {
    id: "profile-1",
    cloudOrigin: "https://cloud.example.test",
    displayName: "Machine",
    enabled: true,
    state: "connected",
    machineId: "machine-1",
    protocolVersion: 1,
    lastConnectedAt: new Date().toISOString(),
    lastErrorCode: null,
    credentialRef: "credential-ref",
    remoteReadEnabled: true,
    remoteFilesEnabled: true,
    remoteControlEnabled: false,
    remotePreviewEnabled: false,
    sessionLabelDisclosureEnabled: false
  };
  const closed: string[] = [];
  const handler = new CloudRemoteRequestHandler({
    store: { readActiveProfile: () => profile } as never,
    readExecutor: { execute: async () => ({ status: 200, body: {} }) },
    controlExecutor: { execute: async () => ({ status: 200, body: {} }) },
    sendCloudFrame: () => true,
    closeConnection: (_connection, _code, reason) => closed.push(reason),
    isCurrentConnection: () => true
  });

  handler.handleReadFrame({ connection: {}, profile, negotiated: true }, {
    type: "remote.read.request.start",
    protocolVersion: 1,
    requestId: "request-files-1",
    operation: "workspace.files.list",
    bodyBytes: 2,
    chunkCount: 1,
    bodySha256: createHash("sha256").update("{}").digest("hex"),
    deadlineAt: new Date(Date.now() + 5_000).toISOString(),
    sentAt: new Date().toISOString()
  });

  assert.deepEqual(closed, ["remote files capability was not negotiated"]);
});

test("remote request handler bounds shutdown when an executor ignores abort", async () => {
  const profile: CloudConnectorProfile = {
    id: "profile-1",
    cloudOrigin: "https://cloud.example.test",
    displayName: "Machine",
    enabled: true,
    state: "connected",
    machineId: "machine-1",
    protocolVersion: 1,
    lastConnectedAt: new Date().toISOString(),
    lastErrorCode: null,
    credentialRef: "credential-ref",
    remoteReadEnabled: true,
    remoteFilesEnabled: true,
    remoteControlEnabled: false,
    remotePreviewEnabled: false,
    sessionLabelDisclosureEnabled: false
  };
  const connection = {};
  const responseFrames: CloudRelayClientFrame[] = [];
  let isCurrentCalls = 0;
  let resolveExecution!: (value: { status: number; body: unknown }) => void;
  const execution = new Promise<{ status: number; body: unknown }>((resolve) => {
    resolveExecution = resolve;
  });
  const handler = new CloudRemoteRequestHandler({
    store: { readActiveProfile: () => profile } as never,
    readExecutor: { execute: () => execution },
    controlExecutor: { execute: async () => ({ status: 200, body: {} }) },
    sendCloudFrame: (_current, frame) => {
      responseFrames.push(frame);
      return true;
    },
    closeConnection: () => undefined,
    isCurrentConnection: () => {
      isCurrentCalls += 1;
      return true;
    },
    shutdownGraceMs: 10
  });
  const body = Buffer.from("{}", "utf8");
  const bodySha256 = createHash("sha256").update(body).digest("hex");
  const context = { connection, profile, negotiated: true };
  handler.handleReadFrame(context, {
    type: "remote.read.request.start",
    protocolVersion: 1,
    requestId: "request-1",
    operation: "overview.get",
    bodyBytes: body.byteLength,
    chunkCount: 1,
    bodySha256,
    deadlineAt: new Date(Date.now() + 5_000).toISOString(),
    sentAt: new Date().toISOString()
  });
  handler.handleReadFrame(context, {
    type: "remote.read.request.chunk",
    protocolVersion: 1,
    requestId: "request-1",
    index: 0,
    data: body.toString("base64")
  });
  handler.handleReadFrame(context, {
    type: "remote.read.request.end",
    protocolVersion: 1,
    requestId: "request-1",
    bodySha256,
    sentAt: new Date().toISOString()
  });

  const startedAt = Date.now();
  await handler.close();
  assert.ok(Date.now() - startedAt < 250);

  resolveExecution({ status: 200, body: { private: "late" } });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(isCurrentCalls, 0);
  assert.deepEqual(responseFrames, []);
});

test("late control completion after bounded shutdown cannot update its durable receipt", async () => {
  const profile: CloudConnectorProfile = {
    id: "profile-1",
    cloudOrigin: "https://cloud.example.test",
    displayName: "Machine",
    enabled: true,
    state: "connected",
    machineId: "machine-1",
    protocolVersion: 1,
    lastConnectedAt: new Date().toISOString(),
    lastErrorCode: null,
    credentialRef: "credential-ref",
    remoteReadEnabled: true,
    remoteFilesEnabled: true,
    remoteControlEnabled: true,
    remotePreviewEnabled: true,
    sessionLabelDisclosureEnabled: false
  };
  const connection = {};
  let completedReceipts = 0;
  let isCurrentCalls = 0;
  let resolveExecution!: (value: { status: number; body: unknown }) => void;
  const execution = new Promise<{ status: number; body: unknown }>((resolve) => {
    resolveExecution = resolve;
  });
  const handler = new CloudRemoteRequestHandler({
    store: {
      readActiveProfile: () => profile,
      reserveControlCommand: () => ({ kind: "reserved" }),
      completeControlCommand: () => {
        completedReceipts += 1;
      }
    } as never,
    readExecutor: { execute: async () => ({ status: 200, body: {} }) },
    controlExecutor: { execute: () => execution },
    sendCloudFrame: () => true,
    closeConnection: () => undefined,
    isCurrentConnection: () => {
      isCurrentCalls += 1;
      return true;
    },
    shutdownGraceMs: 10
  });
  const body = Buffer.from(JSON.stringify({ sessionId: "session-1", input: "continue" }), "utf8");
  const bodySha256 = createHash("sha256").update(body).digest("hex");
  const context = { connection, profile, negotiated: true };
  handler.handleControlFrame(context, {
    type: "remote.control.request.start",
    protocolVersion: 1,
    requestId: "request-1",
    commandId: "command-1",
    operation: "managed.input",
    bodyBytes: body.byteLength,
    chunkCount: 1,
    bodySha256,
    deadlineAt: new Date(Date.now() + 5_000).toISOString(),
    sentAt: new Date().toISOString()
  });
  handler.handleControlFrame(context, {
    type: "remote.control.request.chunk",
    protocolVersion: 1,
    requestId: "request-1",
    index: 0,
    data: body.toString("base64")
  });
  handler.handleControlFrame(context, {
    type: "remote.control.request.end",
    protocolVersion: 1,
    requestId: "request-1",
    bodySha256,
    sentAt: new Date().toISOString()
  });

  await handler.close();
  resolveExecution({ status: 200, body: { id: "session-1" } });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(completedReceipts, 0);
  assert.equal(isCurrentCalls, 0);
});

function sendControlRequest(
  handler: CloudRemoteRequestHandler<object>,
  context: { connection: object; profile: CloudConnectorProfile; negotiated: boolean },
  requestId: string,
  command: {
    operation: "managed.input" | "managed.stop";
    input: Record<string, unknown>;
    commandId: string;
  } = {
    operation: "managed.input",
    input: { sessionId: "session-1", input: "continue" },
    commandId: "command-1"
  }
) {
  const body = Buffer.from(JSON.stringify(command.input), "utf8");
  const bodySha256 = createHash("sha256").update(body).digest("hex");
  handler.handleControlFrame(context, {
    type: "remote.control.request.start",
    protocolVersion: 1,
    requestId,
    commandId: command.commandId,
    operation: command.operation,
    bodyBytes: body.byteLength,
    chunkCount: 1,
    bodySha256,
    deadlineAt: new Date(Date.now() + 5_000).toISOString(),
    sentAt: new Date().toISOString()
  });
  handler.handleControlFrame(context, {
    type: "remote.control.request.chunk",
    protocolVersion: 1,
    requestId,
    index: 0,
    data: body.toString("base64")
  });
  handler.handleControlFrame(context, {
    type: "remote.control.request.end",
    protocolVersion: 1,
    requestId,
    bodySha256,
    sentAt: new Date().toISOString()
  });
}

test("transient control results remain durably ambiguous instead of becoming stuck replays", async () => {
  const profile: CloudConnectorProfile = {
    id: "profile-1",
    cloudOrigin: "https://cloud.example.test",
    displayName: "Machine",
    enabled: true,
    state: "connected",
    machineId: "machine-1",
    protocolVersion: 1,
    lastConnectedAt: new Date().toISOString(),
    lastErrorCode: null,
    credentialRef: "credential-ref",
    remoteReadEnabled: true,
    remoteFilesEnabled: true,
    remoteControlEnabled: true,
    remotePreviewEnabled: true,
    sessionLabelDisclosureEnabled: false
  };
  const connection = {};
  const responseFrames: CloudRelayClientFrame[] = [];
  let reserved = false;
  let completedReceipts = 0;
  let executorCalls = 0;
  const handler = new CloudRemoteRequestHandler({
    store: {
      readActiveProfile: () => profile,
      reserveControlCommand: () => {
        if (reserved) return { kind: "ambiguous" };
        reserved = true;
        return { kind: "reserved" };
      },
      completeControlCommand: () => {
        completedReceipts += 1;
      }
    } as never,
    readExecutor: { execute: async () => ({ status: 200, body: {} }) },
    controlExecutor: {
      execute: async () => {
        executorCalls += 1;
        return { status: 503, body: { error: "remote_control_unavailable" } };
      }
    },
    sendCloudFrame: (_current, frame) => {
      responseFrames.push(frame);
      return true;
    },
    closeConnection: () => undefined,
    isCurrentConnection: () => true
  });

  sendControlRequest(handler, { connection, profile, negotiated: true }, "request-1");
  await new Promise<void>((resolve) => setImmediate(resolve));
  sendControlRequest(handler, { connection, profile, negotiated: true }, "request-2");

  assert.equal(executorCalls, 1);
  assert.equal(completedReceipts, 0);
  assert.deepEqual(
    responseFrames
      .filter((frame) => frame.type === "remote.control.response.start")
      .map((frame) => frame.status),
    [409, 409]
  );
  const responseBodies = responseFrames
    .filter((frame) => frame.type === "remote.control.response.chunk")
    .map((frame) => JSON.parse(Buffer.from(frame.data, "base64").toString("utf8")) as unknown);
  assert.deepEqual(responseBodies, [
    { error: "remote_control_outcome_unknown" },
    { error: "remote_control_outcome_unknown" }
  ]);
});

test("managed stop is executed once and replays its durable receipt", async () => {
  const profile: CloudConnectorProfile = {
    id: "profile-1",
    cloudOrigin: "https://cloud.example.test",
    displayName: "Machine",
    enabled: true,
    state: "connected",
    machineId: "machine-1",
    protocolVersion: 1,
    lastConnectedAt: new Date().toISOString(),
    lastErrorCode: null,
    credentialRef: "credential-ref",
    remoteReadEnabled: true,
    remoteFilesEnabled: true,
    remoteControlEnabled: true,
    remotePreviewEnabled: false,
    sessionLabelDisclosureEnabled: false
  };
  const connection = {};
  let executorCalls = 0;
  let receipt: { status: number; body: unknown } | undefined;
  const handler = new CloudRemoteRequestHandler({
    store: {
      readActiveProfile: () => profile,
      reserveControlCommand: () => receipt
        ? { kind: "replay", ...receipt }
        : { kind: "reserved" },
      completeControlCommand: (value: { status: number; body: unknown }) => {
        receipt = { status: value.status, body: value.body };
      }
    } as never,
    readExecutor: { execute: async () => ({ status: 200, body: {} }) },
    controlExecutor: {
      execute: async () => {
        executorCalls += 1;
        return { status: 200, body: { id: "session-1", status: "stopped" } };
      }
    },
    sendCloudFrame: () => true,
    closeConnection: () => undefined,
    isCurrentConnection: () => true
  });
  const context = { connection, profile, negotiated: true };

  sendControlRequest(handler, context, "request-stop-1", {
    operation: "managed.stop",
    input: { sessionId: "session-1" },
    commandId: "command-stop-1"
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  sendControlRequest(handler, context, "request-stop-2", {
    operation: "managed.stop",
    input: { sessionId: "session-1" },
    commandId: "command-stop-1"
  });

  assert.equal(executorCalls, 1);
  assert.deepEqual(receipt, {
    status: 200,
    body: { accepted: true, sessionId: "session-1" }
  });
});
