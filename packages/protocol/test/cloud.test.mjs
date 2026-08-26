import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCloudRemoteReadOperationInput,
  parseCloudRemoteReadRequestFrame,
  parseCloudRelayServerJson,
  parseConnectCloudInput,
  parseRemoteControlOperationInput,
  parseRemoteControlRequestFrame,
  parseRemoteRealtimePath,
  parseRemoteRealtimeServerFrame,
  parseStartCloudEnrollmentAttemptInput,
  parseUpdateCloudPermissionsInput,
  parseUpdateCloudSessionDisclosureInput
} from "../dist/index.js";

test("cloud connection input accepts HTTPS and loopback development origins", () => {
  assert.deepEqual(parseConnectCloudInput({
    cloudOrigin: "https://cloud.example.test/",
    displayName: "Workstation",
    enrollmentTicket: "ticket-placeholder",
    allowRemoteRead: false
  }), {
    cloudOrigin: "https://cloud.example.test",
    displayName: "Workstation",
    enrollmentTicket: "ticket-placeholder",
    allowRemoteRead: false,
    allowRemoteFiles: false,
    allowRemoteControl: false,
    allowRemotePreview: false
  });
  assert.equal(parseConnectCloudInput({
    cloudOrigin: "http://127.0.0.1:5100",
    displayName: "Dev",
    enrollmentTicket: "ticket-placeholder",
    allowRemoteRead: true
  }).cloudOrigin, "http://127.0.0.1:5100");
});

test("cloud connection control consent is explicit and backwards-safe", () => {
  assert.equal(parseConnectCloudInput({
    cloudOrigin: "https://cloud.example.test",
    displayName: "Workstation",
    enrollmentTicket: "ticket-placeholder",
    allowRemoteRead: true
  }).allowRemoteControl, false);
  assert.equal(parseConnectCloudInput({
    cloudOrigin: "https://cloud.example.test",
    displayName: "Workstation",
    enrollmentTicket: "ticket-placeholder",
    allowRemoteRead: false,
    allowRemoteControl: true
  }).allowRemoteControl, true);
});

test("cloud files and preview consent are explicit and backwards-safe", () => {
  assert.deepEqual(parseConnectCloudInput({
    cloudOrigin: "https://cloud.example.test",
    displayName: "Workstation",
    enrollmentTicket: "ticket-placeholder",
    allowRemoteRead: true,
    allowRemoteFiles: true,
    allowRemotePreview: true
  }), {
    cloudOrigin: "https://cloud.example.test",
    displayName: "Workstation",
    enrollmentTicket: "ticket-placeholder",
    allowRemoteRead: true,
    allowRemoteFiles: true,
    allowRemoteControl: false,
    allowRemotePreview: true
  });
});

test("cloud connection input rejects insecure remote and credential-bearing origins", () => {
  assert.throws(() => parseConnectCloudInput({
    cloudOrigin: "http://cloud.example.test",
    displayName: "Workstation",
    enrollmentTicket: "ticket-placeholder",
    allowRemoteRead: false
  }));
  assert.throws(() => parseConnectCloudInput({
    cloudOrigin: "https://user:secret@cloud.example.test/path",
    displayName: "Workstation",
    enrollmentTicket: "ticket-placeholder",
    allowRemoteRead: false
  }));
  assert.throws(() => parseConnectCloudInput({
    cloudOrigin: "https://cloud.example.test",
    displayName: "Workstation",
    enrollmentTicket: "ticket-placeholder"
  }));
});

test("cloud enrollment attempt input is bounded and never accepts a ticket", () => {
  assert.deepEqual(parseStartCloudEnrollmentAttemptInput({
    cloudOrigin: "https://app.deskcue.example/",
    displayName: " Workstation ",
    allowRemoteRead: true,
    allowRemoteFiles: true,
    allowRemoteControl: false,
    allowRemotePreview: true
  }), {
    cloudOrigin: "https://app.deskcue.example",
    displayName: "Workstation",
    allowRemoteRead: true,
    allowRemoteFiles: true,
    allowRemoteControl: false,
    allowRemotePreview: true
  });
  assert.throws(() => parseStartCloudEnrollmentAttemptInput({
    cloudOrigin: "https://app.deskcue.example",
    displayName: "Workstation",
    enrollmentTicket: "must-not-be-accepted",
    allowRemoteRead: false
  }));
});

test("cloud session disclosure input requires one explicit boolean", () => {
  assert.deepEqual(parseUpdateCloudSessionDisclosureInput({ enabled: true }), {
    enabled: true
  });
  assert.throws(() => parseUpdateCloudSessionDisclosureInput({ enabled: "true" }));
  assert.throws(() => parseUpdateCloudSessionDisclosureInput({ enabled: false, extra: true }));
});

test("cloud permissions input requires a complete explicit grant set", () => {
  assert.deepEqual(parseUpdateCloudPermissionsInput({
    allowRemoteRead: true,
    allowRemoteFiles: true,
    allowRemoteControl: false,
    allowRemotePreview: true
  }), {
    allowRemoteRead: true,
    allowRemoteFiles: true,
    allowRemoteControl: false,
    allowRemotePreview: true
  });
  assert.deepEqual(parseUpdateCloudPermissionsInput({
    allowRemoteRead: false,
    allowRemoteFiles: true,
    allowRemoteControl: false,
    allowRemotePreview: false
  }), {
    allowRemoteRead: false,
    allowRemoteFiles: true,
    allowRemoteControl: false,
    allowRemotePreview: false
  });
  assert.throws(() => parseUpdateCloudPermissionsInput({
    allowRemoteRead: true,
    allowRemoteFiles: false,
    allowRemoteControl: false
  }));
  assert.throws(() => parseUpdateCloudPermissionsInput({
    allowRemoteRead: true,
    allowRemoteFiles: false,
    allowRemoteControl: false,
    allowRemotePreview: false,
    extra: true
  }));
});

test("cloud remote read parser accepts exact bounded request chunks", () => {
  assert.equal(parseCloudRemoteReadRequestFrame({
    type: "remote.read.request.start",
    protocolVersion: 1,
    requestId: "read_request_01",
    operation: "sessions.list",
    bodyBytes: 2,
    chunkCount: 1,
    bodySha256: "a".repeat(64),
    deadlineAt: "2026-08-09T12:34:56.000Z",
    sentAt: "2026-08-09T12:34:55.000Z"
  }).operation, "sessions.list");
  assert.equal(parseCloudRemoteReadRequestFrame({
    type: "remote.read.request.chunk",
    protocolVersion: 1,
    requestId: "read_request_01",
    index: 0,
    data: Buffer.from("{}").toString("base64")
  }).type, "remote.read.request.chunk");
});

test("cloud remote read parser rejects unknown fields and operation input escape hatches", () => {
  assert.throws(() => parseCloudRemoteReadRequestFrame({
    type: "remote.read.request.end",
    protocolVersion: 1,
    requestId: "read_request_01",
    bodySha256: "a".repeat(64),
    sentAt: "2026-08-09T12:34:56.000Z",
    path: "/api/private"
  }));
  assert.throws(() => parseCloudRemoteReadOperationInput("sessions.list", {
    limit: 8,
    path: "/api/private"
  }));
  assert.deepEqual(parseCloudRemoteReadOperationInput("transcript.page", {
    agentSessionId: "codex:one",
    beforeEntryId: "entry:20",
    limit: 20
  }), {
    agentSessionId: "codex:one",
    beforeEntryId: "entry:20",
    limit: 20
  });
  assert.deepEqual(parseCloudRemoteReadOperationInput("transcript.entries.post", {
    agentSessionId: "codex:one",
    entryIds: ["entry:1", "entry:2"]
  }), {
    agentSessionId: "codex:one",
    entryIds: ["entry:1", "entry:2"]
  });
  assert.throws(() => parseCloudRemoteReadOperationInput("transcript.page", {
    agentSessionId: "codex:one",
    beforeEntryId: "entry:20",
    limit: 51
  }));
  assert.throws(() => parseCloudRemoteReadOperationInput("transcript.entries.get", {
    agentSessionId: "codex:one",
    entryIds: [],
    path: "/api/private"
  }));
});

test("cloud operation input parsers preserve validated operation-specific shapes", () => {
  assert.deepEqual(parseCloudRemoteReadOperationInput("managedSessions.get", {
    sessionId: "managed-1",
    view: "debug",
    debugLogTail: 25
  }), {
    sessionId: "managed-1",
    view: "debug",
    debugLogTail: 25
  });
  assert.deepEqual(parseCloudRemoteReadOperationInput("changes.post", {
    agentSessionId: "codex:one",
    groupId: "changes-1",
    sourceEntryRanges: [{ prefix: "entry", start: 1, end: 3 }]
  }), {
    agentSessionId: "codex:one",
    groupId: "changes-1",
    sourceEntryRanges: [{ prefix: "entry", start: 1, end: 3 }]
  });
  assert.deepEqual(parseRemoteControlOperationInput("managed.input", {
    sessionId: "managed-1",
    input: "continue"
  }), {
    sessionId: "managed-1",
    input: "continue"
  });
});

test("cloud file, git and preview operations remain exact and bounded", () => {
  assert.deepEqual(parseCloudRemoteReadOperationInput("assets.ticket.create", {
    agentSessionId: "codex:one",
    download: false,
    kind: "local_image",
    path: "C:\\Users\\person\\AppData\\Local\\Temp\\screenshot.png",
    workspaceId: "workspace-1"
  }), {
    agentSessionId: "codex:one",
    download: false,
    kind: "local_image",
    path: "C:\\Users\\person\\AppData\\Local\\Temp\\screenshot.png",
    workspaceId: "workspace-1"
  });
  assert.deepEqual(parseCloudRemoteReadOperationInput("assets.ticket.read", {
    ticket: "12345678-1234-1234-1234-123456789abc"
  }), { ticket: "12345678-1234-1234-1234-123456789abc" });
  assert.throws(() => parseCloudRemoteReadOperationInput("assets.ticket.create", {
    kind: "local_image",
    path: "bad\0path.png"
  }));
  assert.deepEqual(parseCloudRemoteReadOperationInput("workspace.files.list", {
    workspaceId: "workspace-1",
    path: "src",
    cursor: "n_Y3Vyc29y",
    limit: 100
  }), {
    workspaceId: "workspace-1",
    path: "src",
    cursor: "n_Y3Vyc29y",
    limit: 100
  });
  assert.throws(() => parseCloudRemoteReadOperationInput("workspace.files.read", {
    workspaceId: "workspace-1",
    path: "../secret"
  }));
  assert.throws(() => parseCloudRemoteReadOperationInput("workspace.files.read", {
    workspaceId: "workspace-1",
    path: "C:\\secret"
  }));
  assert.deepEqual(parseCloudRemoteReadOperationInput("managed.git.refresh", {
    sessionId: "session-1",
    view: "diff"
  }), { sessionId: "session-1", view: "diff" });
  assert.deepEqual(parseRemoteControlOperationInput("preview.configure", {
    sessionId: "session-1",
    port: 5173,
    networkMode: "device-direct"
  }), { sessionId: "session-1", port: 5173, networkMode: "device-direct" });
  assert.deepEqual(parseRemoteControlOperationInput("preview.configure", {
    sessionId: "session-1",
    port: 5173,
    networkMode: "deskcue-host"
  }), { sessionId: "session-1", port: 5173, networkMode: "deskcue-host" });
});

test("cloud relay parser accepts a bounded acknowledgement", () => {
  assert.deepEqual(parseCloudRelayServerJson(JSON.stringify({
    type: "relay.ack",
    protocolVersion: 1,
    messageId: "msg_example_1",
    stream: "session-summaries",
    ackedSequence: 1,
    receivedAt: "2026-08-09T10:00:00.000Z",
    accepted: true
  })), {
    type: "relay.ack",
    protocolVersion: 1,
    messageId: "msg_example_1",
    stream: "session-summaries",
    ackedSequence: 1,
    receivedAt: "2026-08-09T10:00:00.000Z",
    accepted: true
  });
});

test("cloud relay parser rejects unsupported protocol versions and oversized frames", () => {
  assert.throws(() => parseCloudRelayServerJson(JSON.stringify({
    type: "relay.ack",
    protocolVersion: 2
  })));
  assert.throws(() => parseCloudRelayServerJson(`{"padding":"${"x".repeat(17_000)}"}`));
});

test("cloud relay parser rejects noncanonical timestamps and unknown handshake fields", () => {
  const acknowledgement = {
    type: "relay.ack",
    protocolVersion: 1,
    messageId: "msg_example_1",
    stream: "session-summaries",
    ackedSequence: 1,
    receivedAt: "2026-08-09T10:00:00.000Z",
    accepted: true
  };
  assert.throws(() => parseCloudRelayServerJson(JSON.stringify({
    ...acknowledgement,
    receivedAt: "August 9, 2026 10:00:00 UTC"
  })));
  assert.throws(() => parseCloudRelayServerJson(JSON.stringify({
    ...acknowledgement,
    ignored: "field"
  })));
  assert.throws(() => parseCloudRelayServerJson(JSON.stringify({
    type: "relay.welcome",
    protocolVersion: 1,
    connectionId: "connection_1",
    machineId: "machine_1",
    negotiatedCapabilities: ["session.summary"],
    streamPositions: [{ stream: "session-summaries", nextSequence: 1, ignored: true }],
    heartbeatIntervalMs: 30_000,
    maxFrameBytes: 16_384,
    connectedAt: "2026-08-09T10:00:00.000Z"
  })));
});

test("cloud remote control parser models only exact bounded operations", () => {
  assert.deepEqual(parseRemoteControlOperationInput("managed.input", {
    sessionId: "session-1",
    input: "continue"
  }), { sessionId: "session-1", input: "continue" });
  assert.deepEqual(parseRemoteControlOperationInput("source.attach", {
    agentSessionId: "source-1"
  }), { agentSessionId: "source-1" });
  assert.throws(() => parseRemoteControlOperationInput("managed.interrupt", {
    sessionId: "session-1",
    path: "/api/access/reset"
  }));
  assert.deepEqual(parseRemoteControlOperationInput("managed.stop", {
    sessionId: "session-1"
  }), { sessionId: "session-1" });
  assert.equal(parseRemoteControlRequestFrame({
    type: "remote.control.request.start",
    protocolVersion: 1,
    requestId: "request_control_1",
    commandId: "command_stable_1",
    operation: "managed.input",
    bodyBytes: 2,
    chunkCount: 1,
    bodySha256: "a".repeat(64),
    deadlineAt: "2026-08-11T12:00:01.000Z",
    sentAt: "2026-08-11T12:00:00.000Z"
  }).commandId, "command_stable_1");
});

test("cloud realtime parser accepts only the local DeskCue websocket path", () => {
  assert.equal(
    parseRemoteRealtimePath("/ws?protocolVersion=1&protocolCapability=cursor-replay&clientId=cloud-1"),
    "/ws?protocolVersion=1&protocolCapability=cursor-replay&clientId=cloud-1"
  );
  for (const path of [
    "/api/sessions?protocolVersion=1",
    "/ws?protocolVersion=1&token=secret",
    "https://example.test/ws?protocolVersion=1",
    "/ws?protocolVersion=1&protocolVersion=1"
  ]) {
    assert.throws(() => parseRemoteRealtimePath(path));
  }
  assert.equal(parseRemoteRealtimeServerFrame({
    type: "remote.realtime.open",
    protocolVersion: 1,
    streamId: "stream_cloud_1",
    path: "/ws?protocolVersion=1&protocolCapability=cursor-replay",
    deadlineAt: "2026-08-11T12:00:01.000Z",
    sentAt: "2026-08-11T12:00:00.000Z"
  }).type, "remote.realtime.open");
  assert.throws(() => parseRemoteRealtimeServerFrame({
    type: "remote.realtime.close",
    protocolVersion: 1,
    streamId: "stream_cloud_1",
    code: 1000,
    reason: "😀".repeat(31),
    sentAt: "2026-08-11T12:00:00.000Z"
  }));
});
