import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WebSocketServer } from "ws";

import type {
  AgentSessionSummary,
  LocalLlmChatSummary,
  ServerEvent,
  SessionSummary
} from "@deskcue/protocol";
import type { DaemonEventBus } from "#application/ports";
import { SqliteDatabaseContext } from "#persistence/connection/sqliteConnection";

import { CloudConnectorService } from "./cloudConnectorService.ts";

class TestEventBus extends EventEmitter implements DaemonEventBus {
  publishServerEvent(event: ServerEvent) {
    this.emit("event", event);
  }
}

test("cloud connector assembles a typed read request and returns bounded chunks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-cloud-read-"));
  const context = new SqliteDatabaseContext(join(directory, "deskcue.sqlite"));
  const responseFrames: Array<Record<string, unknown>> = [];
  let executedInput: unknown;
  const requestBody = Buffer.from(JSON.stringify({ limit: 8, includeLiveMetadata: true }), "utf8");
  const requestDigest = createHash("sha256").update(requestBody).digest("hex");
  let resolveResponse!: () => void;
  const responseComplete = new Promise<void>((resolve) => { resolveResponse = resolve; });
  let resolveExpiredResponse!: () => void;
  const expiredResponseComplete = new Promise<void>((resolve) => { resolveExpiredResponse = resolve; });
  const httpServer = createServer((request, response) => {
    if (request.url === "/machines/enroll") {
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ machine: { machineId: "mach_read" }, machineCredential: "credential" }));
      return;
    }
    if (request.url === "/machines/mach_read/connections") {
      const address = httpServer.address();
      assert.ok(address && typeof address === "object");
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({
        connectionToken: "connection-token",
        relayUrl: `ws://127.0.0.1:${address.port}/relay/machines/mach_read`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        cursors: { "session-summaries": 0 }
      }));
      return;
    }
    response.writeHead(404).end();
  });
  const websocketServer = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (request, socket, head) => {
    websocketServer.handleUpgrade(request, socket, head, (websocket) => websocketServer.emit("connection", websocket, request));
  });
  websocketServer.on("connection", (socket) => {
    socket.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as Record<string, unknown>;
      if (frame.type === "relay.hello") {
        assert.deepEqual(frame.capabilities, [
          "session.summary", "deskcue.read", "deskcue.realtime", "deskcue.files"
        ]);
        socket.send(JSON.stringify({
          type: "relay.welcome", protocolVersion: 1, connectionId: "connection_read",
          machineId: "mach_read", negotiatedCapabilities: [
            "session.summary", "deskcue.read", "deskcue.realtime", "deskcue.files"
          ],
          streamPositions: [{ stream: "session-summaries", nextSequence: 1 }],
          heartbeatIntervalMs: 30_000, maxFrameBytes: 16_384, connectedAt: new Date().toISOString()
        }));
        socket.send(JSON.stringify({
          type: "remote.read.request.start", protocolVersion: 1, requestId: "read_request_01",
          operation: "sessions.list", bodyBytes: requestBody.length, chunkCount: 1,
          bodySha256: requestDigest, deadlineAt: new Date(Date.now() + 10_000).toISOString(),
          sentAt: new Date().toISOString()
        }));
        socket.send(JSON.stringify({
          type: "remote.read.request.chunk", protocolVersion: 1, requestId: "read_request_01",
          index: 0, data: requestBody.toString("base64")
        }));
        socket.send(JSON.stringify({
          type: "remote.read.request.end", protocolVersion: 1, requestId: "read_request_01",
          bodySha256: requestDigest, sentAt: new Date().toISOString()
        }));
        const abandonedBody = Buffer.from("{}", "utf8");
        socket.send(JSON.stringify({
          type: "remote.read.request.start", protocolVersion: 1, requestId: "read_expired_01",
          operation: "sessions.list", bodyBytes: abandonedBody.length, chunkCount: 1,
          bodySha256: createHash("sha256").update(abandonedBody).digest("hex"),
          deadlineAt: new Date(Date.now() + 25).toISOString(),
          sentAt: new Date().toISOString()
        }));
        return;
      }
      if (typeof frame.type === "string" && frame.type.startsWith("remote.read.response.")) {
        responseFrames.push(frame);
        if (frame.type === "remote.read.response.end" && frame.requestId === "read_request_01") resolveResponse();
        if (frame.type === "remote.read.response.end" && frame.requestId === "read_expired_01") resolveExpiredResponse();
      }
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  assert.ok(address && typeof address === "object");
  const service = new CloudConnectorService(
    context,
    new TestEventBus(),
    { listLocalLlmChats: async () => [], listManagedSessions: () => [], listSourceSessions: async () => [] },
    {
      fetchImplementation: fetch,
      remoteReadExecutor: {
        async execute(operation, input) {
          assert.equal(operation, "sessions.list");
          executedInput = input;
          return { status: 200, body: { sessions: [], padding: "x".repeat(20_000) } };
        }
      }
    }
  );
  try {
    service.start();
    await service.connect({
      cloudOrigin: `http://127.0.0.1:${address.port}`,
      displayName: "Read machine",
      enrollmentTicket: "ticket-placeholder",
      allowRemoteRead: true,
      allowRemoteFiles: true,
      allowRemoteControl: false,
      allowRemotePreview: false
    });
    assert.equal(service.getStatus().remoteReadEnabled, true);
    assert.equal(service.getStatus().remoteFilesEnabled, true);
    await Promise.race([
      Promise.all([responseComplete, expiredResponseComplete]),
      new Promise((_, reject) => setTimeout(() => reject(new Error("read response timeout")), 5_000))
    ]);
    assert.deepEqual(executedInput, { limit: 8, includeLiveMetadata: true });
    const start = responseFrames.find((frame) =>
      frame.type === "remote.read.response.start" && frame.requestId === "read_request_01"
    );
    const chunks = responseFrames.filter((frame) =>
      frame.type === "remote.read.response.chunk" && frame.requestId === "read_request_01"
    );
    assert.ok(start && Number(start.chunkCount) > 1);
    assert.equal(chunks.length, start.chunkCount);
    const assembled = Buffer.concat(chunks.sort((a, b) => Number(a.index) - Number(b.index)).map((frame) => Buffer.from(String(frame.data), "base64")));
    assert.equal(createHash("sha256").update(assembled).digest("hex"), start.bodySha256);
    const expiredStart = responseFrames.find((frame) =>
      frame.type === "remote.read.response.start" && frame.requestId === "read_expired_01"
    );
    assert.equal(expiredStart?.status, 504);
  } finally {
    await service.close();
    await new Promise<void>((resolve) => websocketServer.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    context.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("cloud connector rejects and cancels an oversized streamed enrollment response", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-cloud-enrollment-bound-"));
  const context = new SqliteDatabaseContext(join(directory, "deskcue.sqlite"));
  let responseCancelled = false;
  const service = new CloudConnectorService(
    context,
    new TestEventBus(),
    {
      listLocalLlmChats: async () => [],
      listManagedSessions: () => [],
      listSourceSessions: async () => []
    },
    {
      fetchImplementation: async (input) => {
        assert.match(String(input), /\/machines\/enroll$/);
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(40_000));
            controller.enqueue(new Uint8Array(40_000));
          },
          cancel() {
            responseCancelled = true;
          }
        }), { status: 201, headers: { "content-type": "application/json" } });
      }
    }
  );
  try {
    await assert.rejects(service.connect({
      cloudOrigin: "https://cloud.example.test",
      displayName: "Bounded response machine",
      enrollmentTicket: "ticket-placeholder",
      allowRemoteRead: false,
      allowRemoteFiles: false,
      allowRemoteControl: false,
      allowRemotePreview: false
    }), /cloud_http_response_too_large/);
    assert.equal(responseCancelled, true);
    assert.equal(service.getStatus().machineId, null);
    assert.equal(service.getStatus().state, "disconnected");
  } finally {
    await service.close();
    context.close();
    await rm(directory, { force: true, recursive: true });
  }
});

function managedSession(adapterId = "codex", id = "local-session-id"): SessionSummary {
  return {
    id,
    workspaceId: "private-workspace-id",
    workspaceName: "Private workspace",
    adapterId,
    sourceSessionId: null,
    command: "secret command",
    status: "running",
    startedAt: "2026-08-09T10:00:00.000Z",
    finishedAt: null,
    lastActivityAt: "2026-08-09T10:01:00.000Z",
    exitCode: null,
    preview: { port: null, active: false, networkMode: "device-direct", targetUrl: null },
    replyState: { phase: "waiting", promptText: "private prompt", requestedAt: "2026-08-09T10:00:30.000Z" },
    git: {
      isGitRepo: true,
      branch: "main",
      isDirty: false,
      changedFiles: [],
      diff: "",
      lastUpdatedAt: "2026-08-09T10:00:00.000Z"
    }
  };
}

function sourceSession(): AgentSessionSummary {
  return {
    id: "claude-code:source-session-id",
    agentId: "claude-code",
    agentLabel: "Claude Code",
    sourceSessionId: "source-session-id",
    title: "Private Claude title",
    workspacePath: "D:\\private",
    workspaceName: "Private workspace",
    updatedAt: "2026-08-09T10:02:00.000Z",
    model: "private-model",
    originator: null,
    cliVersion: null,
    source: null,
    filePath: "D:\\private\\transcript.jsonl",
    attachMode: "resume",
    workState: "running"
  };
}

function localChats(): LocalLlmChatSummary[] {
  return (["ollama", "lm-studio"] as const).map((runtimeId, index) => ({
    id: `local-chat-${index}`,
    title: "Private local chat",
    runtimeId,
    model: "private-model",
    workspace: null,
    createdAt: "2026-08-09T10:00:00.000Z",
    updatedAt: `2026-08-09T10:0${index + 3}:00.000Z`,
    generationState: "idle",
    generationError: null,
    agentMode: "read_only",
    toolCapability: null
  }));
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for Cloud connector state.");
}

test("cloud connector rejects capabilities that were not locally granted", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-cloud-capability-escalation-"));
  const context = new SqliteDatabaseContext(join(directory, "deskcue.sqlite"));
  let relayCloseCode: number | null = null;
  const httpServer = createServer((request, response) => {
    if (request.url === "/machines/enroll") {
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({
        machine: { machineId: "mach_capability" },
        machineCredential: "credential-placeholder"
      }));
      return;
    }
    if (request.url === "/machines/mach_capability/connections") {
      const address = httpServer.address();
      assert.ok(address && typeof address === "object");
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({
        connectionToken: "connection-token-placeholder",
        relayUrl: `ws://127.0.0.1:${address.port}/relay/machines/mach_capability`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        cursors: { "session-summaries": 0 }
      }));
      return;
    }
    response.writeHead(404).end();
  });
  const websocketServer = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (request, socket, head) => {
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request);
    });
  });
  websocketServer.on("connection", (socket) => {
    socket.once("close", (code) => { relayCloseCode = code; });
    socket.once("message", () => {
      socket.send(JSON.stringify({
        type: "relay.welcome",
        protocolVersion: 1,
        connectionId: "connection_capability",
        machineId: "mach_capability",
        negotiatedCapabilities: ["session.summary", "deskcue.control"],
        streamPositions: [{ stream: "session-summaries", nextSequence: 1 }],
        heartbeatIntervalMs: 30_000,
        maxFrameBytes: 16_384,
        connectedAt: new Date().toISOString()
      }));
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  assert.ok(address && typeof address === "object");
  const service = new CloudConnectorService(
    context,
    new TestEventBus(),
    { listLocalLlmChats: async () => [], listManagedSessions: () => [], listSourceSessions: async () => [] },
    { fetchImplementation: fetch }
  );
  try {
    service.start();
    await service.connect({
      cloudOrigin: `http://127.0.0.1:${address.port}`,
      displayName: "Capability machine",
      enrollmentTicket: "ticket-placeholder",
      allowRemoteRead: false,
      allowRemoteFiles: false,
      allowRemoteControl: false,
      allowRemotePreview: false
    });
    await waitFor(() => relayCloseCode !== null);
    assert.equal(relayCloseCode, 1002);
    assert.equal(service.getStatus().connected, false);
    assert.equal(service.getStatus().remoteControlEnabled, false);
  } finally {
    await service.close();
    await new Promise<void>((resolve) => websocketServer.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    context.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("cloud connector replays the same durable metadata-only event after restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-cloud-connector-"));
  const context = new SqliteDatabaseContext(join(directory, "deskcue.sqlite"));
  const received: Array<Record<string, unknown>> = [];
  let connectionCount = 0;
  const httpServer = createServer((request, response) => {
    if (request.method === "POST" && request.url === "/machines/enroll") {
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({
        machine: { machineId: "mach_test" },
        machineCredential: "machine-credential-placeholder"
      }));
      return;
    }
    if (request.method === "POST" && request.url === "/machines/mach_test/connections") {
      assert.equal(request.headers.authorization, "Bearer machine-credential-placeholder");
      const address = httpServer.address();
      assert.ok(address && typeof address === "object");
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({
        connectionToken: `connection-token-${connectionCount + 1}`,
        relayUrl: `ws://127.0.0.1:${address.port}/relay/machines/mach_test`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        cursors: { "session-summaries": 0 }
      }));
      return;
    }
    response.writeHead(404).end();
  });
  const websocketServer = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (request, socket, head) => {
    assert.match(request.headers.authorization ?? "", /^Bearer connection-token-/);
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request);
    });
  });
  websocketServer.on("connection", (socket) => {
    connectionCount += 1;
    socket.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as Record<string, unknown>;
      if (frame.type === "relay.hello") {
        assert.deepEqual(frame.capabilities, ["session.summary"]);
        socket.send(JSON.stringify({
          type: "relay.welcome",
          protocolVersion: 1,
          connectionId: `connection_${connectionCount}`,
          machineId: "mach_test",
          negotiatedCapabilities: ["session.summary"],
          streamPositions: [{ stream: "session-summaries", nextSequence: 1 }],
          heartbeatIntervalMs: 30_000,
          maxFrameBytes: 16_384,
          connectedAt: new Date().toISOString()
        }));
        return;
      }
      received.push(frame);
      if (connectionCount >= 2) {
        socket.send(JSON.stringify({
          type: "relay.ack",
          protocolVersion: 1,
          messageId: frame.messageId,
          stream: "session-summaries",
          ackedSequence: frame.sequence,
          receivedAt: new Date().toISOString(),
          accepted: true
        }));
      }
    });
  });

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const projections = {
    listLocalLlmChats: async () => localChats(),
    listManagedSessions: () => [managedSession(), managedSession("generic-cli", "generic-session")],
    listSourceSessions: async () => [sourceSession()]
  };

  let first: CloudConnectorService | null = null;
  let second: CloudConnectorService | null = null;
  try {
    first = new CloudConnectorService(context, new TestEventBus(), projections);
    first.start();
    await first.connect({
      cloudOrigin: origin,
      displayName: "Test machine",
      enrollmentTicket: "ticket-placeholder",
      allowRemoteRead: false,
      allowRemoteFiles: false,
      allowRemoteControl: false,
      allowRemotePreview: false
    });
    assert.equal(first.getStatus().remoteReadEnabled, false);
    await waitFor(() => received.length >= 1);
    await first.close();
    first = null;

    second = new CloudConnectorService(context, new TestEventBus(), projections);
    second.start();
    await waitFor(() => received.length >= 6 && second?.getStatus().pendingEventCount === 0);

    assert.equal(received[0].messageId, received[1].messageId);
    assert.equal(received[0].sequence, 1);
    const payload = received[0].payload as { summary: Record<string, unknown> };
    assert.deepEqual(Object.keys(payload.summary).sort(), [
      "disclosureScope", "replyState", "runtime", "sessionId", "status", "updatedAt"
    ]);
    assert.equal(JSON.stringify(received[0]).includes("Private workspace"), false);
    assert.equal(JSON.stringify(received[0]).includes("D:\\private"), false);
    assert.deepEqual(
      [...new Set(received.slice(1).map((frame) => (
        frame.payload as { summary: { runtime: string } }
      ).summary.runtime))].sort(),
      ["claude_code", "codex", "generic_cli", "lm_studio", "ollama"]
    );
  } finally {
    await first?.close();
    await second?.close();
    await new Promise<void>((resolve) => websocketServer.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    context.close();
    await rm(directory, { force: true, recursive: true });
  }
});
