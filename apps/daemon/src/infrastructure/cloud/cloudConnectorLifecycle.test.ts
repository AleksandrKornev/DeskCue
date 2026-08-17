import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WebSocketServer } from "ws";

import type { AgentSessionSummary, ServerEvent } from "@deskcue/protocol";
import type { DaemonEventBus } from "#application/ports";
import { SqliteCloudConnectorStore } from "#persistence/cloud/cloudConnectorStore";
import { SqliteDatabaseContext } from "#persistence/connection/sqliteConnection";

import { CloudConnectorService } from "./cloudConnectorService.ts";
import { EncryptedFileCloudSecretStore } from "./connector/cloudSecretStore.ts";

class TestEventBus extends EventEmitter implements DaemonEventBus {
  publishServerEvent(event: ServerEvent) {
    this.emit("event", event);
  }
}

function connectInput(
  cloudOrigin: string,
  permissions: Partial<{
    allowRemoteRead: boolean;
    allowRemoteFiles: boolean;
    allowRemoteControl: boolean;
    allowRemotePreview: boolean;
  }> = {}
) {
  return {
    cloudOrigin,
    displayName: "Lifecycle machine",
    enrollmentTicket: "ticket-placeholder",
    allowRemoteRead: false,
    allowRemoteFiles: false,
    allowRemoteControl: false,
    allowRemotePreview: false,
    ...permissions
  };
}

function emptyProjections() {
  return {
    listLocalLlmChats: async () => [],
    listManagedSessions: () => [],
    listSourceSessions: async () => []
  };
}

function sourceSession(sourceSessionId: string): AgentSessionSummary {
  return {
    id: `codex:${sourceSessionId}`,
    agentId: "codex",
    agentLabel: "Codex",
    sourceSessionId,
    title: "Private stale title",
    workspacePath: "D:\\private",
    workspaceName: "Private workspace",
    updatedAt: "2026-08-11T04:00:00.000Z",
    model: "private-model",
    originator: null,
    cliVersion: null,
    source: null,
    filePath: "D:\\private\\transcript.jsonl",
    attachMode: "resume",
    workState: "running"
  };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-cloud-lifecycle-"));
  const context = new SqliteDatabaseContext(join(directory, "deskcue.sqlite"));
  return {
    context,
    directory,
    async dispose() {
      context.close();
      await rm(directory, { force: true, recursive: true });
    }
  };
}

test("a scheduled Cloud connection isolates store failures from the local daemon", async () => {
  const fixture = await createFixture();
  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (reason: unknown) => {
    unhandledRejections.push(reason);
  };
  const fetchImplementation = async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.pathname === "/machines/enroll") {
      return jsonResponse(201, {
        machine: { machineId: "machine-store-failure" },
        machineCredential: "credential-placeholder"
      });
    }
    return new Response(null, { status: 404 });
  };
  const service = new CloudConnectorService(
    fixture.context,
    new TestEventBus(),
    emptyProjections(),
    { fetchImplementation: fetchImplementation as typeof fetch }
  );

  process.on("unhandledRejection", onUnhandledRejection);
  try {
    await service.connect(connectInput("https://store-failure.example"));
    fixture.context.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(unhandledRejections, []);
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
    await service.close();
    await fixture.dispose();
  }
});

async function waitFor(predicate: () => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for Cloud connector lifecycle state.");
}

test("cloud connector start is idempotent for listeners, timers, and relay attempts", async () => {
  const fixture = await createFixture();
  let relayAttempts = 0;
  const fetchImplementation = async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.pathname === "/machines/enroll") {
      return jsonResponse(201, {
        machine: { machineId: "machine-start-idempotency" },
        machineCredential: "credential-placeholder"
      });
    }
    if (url.pathname.endsWith("/connections")) {
      relayAttempts += 1;
      return new Response(null, { status: 401 });
    }
    return new Response(null, { status: 404 });
  };
  const events = new TestEventBus();
  const service = new CloudConnectorService(
    fixture.context,
    events,
    emptyProjections(),
    { fetchImplementation: fetchImplementation as typeof fetch }
  );
  const originalSetInterval = globalThis.setInterval;
  let intervalRegistrations = 0;

  try {
    await service.connect(connectInput("https://start-idempotency.example"));
    globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
      intervalRegistrations += 1;
      return originalSetInterval(...args);
    }) as typeof setInterval;
    service.start();
    service.start();
    globalThis.setInterval = originalSetInterval;

    await waitFor(() => relayAttempts >= 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual({
      eventListeners: events.listenerCount("event"),
      intervalRegistrations,
      relayAttempts
    }, {
      eventListeners: 1,
      intervalRegistrations: 1,
      relayAttempts: 1
    });
  } finally {
    globalThis.setInterval = originalSetInterval;
    await service.close();
    await fixture.dispose();
  }
});

test("permission replacement preserves machine identity and reconnects with only the new grants", async () => {
  const fixture = await createFixture();
  const relayHellos: Array<Record<string, unknown>> = [];
  const capabilityBodies: unknown[] = [];
  let enrollmentCount = 0;
  let connectionCount = 0;
  let oldRelayClosed = false;
  const server = createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/machines/enroll") {
      enrollmentCount += 1;
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({
        machine: { machineId: "machine-permissions" },
        machineCredential: "machine-credential-placeholder"
      }));
      return;
    }
    if (request.method === "POST" &&
        request.url === "/machines/machine-permissions/connections") {
      connectionCount += 1;
      const address = server.address();
      assert.ok(address && typeof address === "object");
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({
        connectionToken: `connection-token-placeholder-${connectionCount}`,
        relayUrl: `ws://127.0.0.1:${address.port}/relay/machines/machine-permissions`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        cursors: { "session-summaries": 0 }
      }));
      return;
    }
    if (request.method === "PUT" &&
        request.url === "/machines/machine-permissions/capabilities") {
      assert.equal(
        request.headers.authorization,
        "Bearer machine-credential-placeholder"
      );
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      capabilityBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
      response.writeHead(204).end();
      return;
    }
    response.writeHead(404).end();
  });
  const sockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    sockets.handleUpgrade(request, socket, head, (websocket) => {
      sockets.emit("connection", websocket, request);
    });
  });
  let relaySequence = 0;
  sockets.on("connection", (socket) => {
    relaySequence += 1;
    const sequence = relaySequence;
    socket.once("close", () => {
      if (sequence === 1) oldRelayClosed = true;
    });
    socket.once("message", (data) => {
      const hello = JSON.parse(data.toString()) as Record<string, unknown>;
      relayHellos.push(hello);
      socket.send(JSON.stringify({
        type: "relay.welcome",
        protocolVersion: 1,
        connectionId: `connection-permissions-${sequence}`,
        machineId: "machine-permissions",
        negotiatedCapabilities: hello.capabilities,
        streamPositions: [{ stream: "session-summaries", nextSequence: 1 }],
        heartbeatIntervalMs: 30_000,
        maxFrameBytes: 16_384,
        connectedAt: new Date().toISOString()
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const service = new CloudConnectorService(
    fixture.context,
    new TestEventBus(),
    emptyProjections(),
    { fetchImplementation: fetch }
  );
  const store = new SqliteCloudConnectorStore(fixture.context);

  try {
    service.start();
    await service.connect(connectInput(`http://127.0.0.1:${address.port}`, {
      allowRemoteRead: true,
      allowRemoteFiles: true,
      allowRemoteControl: true,
      allowRemotePreview: false
    }));
    await waitFor(() => service.getStatus().connected);
    const before = store.readActiveProfile();
    assert.ok(before);
    const identityBefore = store.readIdentity();
    const secretBefore = new EncryptedFileCloudSecretStore(fixture.directory)
      .read(before.credentialRef);

    const status = await service.updatePermissions({
      allowRemoteRead: false,
      allowRemoteFiles: true,
      allowRemoteControl: false,
      allowRemotePreview: false
    });

    assert.equal(status.machineId, before.machineId);
    assert.equal(status.remoteReadEnabled, false);
    assert.equal(status.remoteFilesEnabled, true);
    assert.equal(status.remoteControlEnabled, false);
    await waitFor(() => relayHellos.length === 2 && service.getStatus().connected);
    assert.equal(oldRelayClosed, true);
    assert.equal(enrollmentCount, 1);
    assert.deepEqual(capabilityBodies, [{
      capabilities: ["session.summary", "deskcue.files"]
    }]);
    assert.deepEqual(relayHellos[1]?.capabilities, ["session.summary", "deskcue.files"]);
    assert.deepEqual(store.readIdentity(), identityBefore);
    assert.deepEqual(
      new EncryptedFileCloudSecretStore(fixture.directory).read(before.credentialRef),
      secretBefore
    );
  } finally {
    await service.close();
    await new Promise<void>((resolve) => sockets.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fixture.dispose();
  }
});

test("permission revoke aborts a stale token request before scheduling the new relay", async () => {
  const fixture = await createFixture();
  let tokenRequests = 0;
  let firstTokenAborted = false;
  let capabilitiesUpdated = false;
  const fetchImplementation = async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.pathname === "/machines/enroll") {
      return jsonResponse(201, {
        machine: { machineId: "machine-token-race" },
        machineCredential: "machine-credential-placeholder"
      });
    }
    if (url.pathname.endsWith("/capabilities")) {
      capabilitiesUpdated = true;
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith("/connections")) {
      tokenRequests += 1;
      const requestSequence = tokenRequests;
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          if (requestSequence === 1) firstTokenAborted = true;
          reject(init.signal?.reason);
        }, { once: true });
      });
    }
    return new Response(null, { status: 404 });
  };
  const service = new CloudConnectorService(
    fixture.context,
    new TestEventBus(),
    emptyProjections(),
    { fetchImplementation: fetchImplementation as typeof fetch }
  );

  try {
    service.start();
    await service.connect(connectInput("https://token-race.example", {
      allowRemoteRead: true,
      allowRemoteControl: true
    }));
    await waitFor(() => tokenRequests === 1);

    await service.updatePermissions({
      allowRemoteRead: true,
      allowRemoteFiles: false,
      allowRemoteControl: false,
      allowRemotePreview: false
    });

    assert.equal(firstTokenAborted, true);
    assert.equal(capabilitiesUpdated, true);
    await waitFor(() => tokenRequests === 2);
  } finally {
    await service.close();
    await fixture.dispose();
  }
});

test("failed mixed permission sync keeps revocations local and never applies new grants", async () => {
  const fixture = await createFixture();
  let tokenRequests = 0;
  const fetchImplementation = async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.pathname === "/machines/enroll") {
      return jsonResponse(201, {
        machine: { machineId: "machine-permission-rollback" },
        machineCredential: "machine-credential-placeholder"
      });
    }
    if (url.pathname.endsWith("/capabilities")) {
      return jsonResponse(503, { error: "temporarily unavailable" });
    }
    if (url.pathname.endsWith("/connections")) {
      tokenRequests += 1;
      return new Response(null, { status: 401 });
    }
    return new Response(null, { status: 404 });
  };
  const service = new CloudConnectorService(
    fixture.context,
    new TestEventBus(),
    emptyProjections(),
    { fetchImplementation: fetchImplementation as typeof fetch }
  );

  try {
    service.start();
    await service.connect(connectInput("https://permission-rollback.example", {
      allowRemoteRead: true,
      allowRemoteFiles: false,
      allowRemoteControl: true,
      allowRemotePreview: false
    }));
    await waitFor(() => tokenRequests === 1);

    await assert.rejects(service.updatePermissions({
      allowRemoteRead: true,
      allowRemoteFiles: true,
      allowRemoteControl: false,
      allowRemotePreview: true
    }), /capabilities_http_503/);

    const status = service.getStatus();
    assert.equal(status.state, "degraded");
    assert.equal(status.lastErrorCode, "capabilities_http_503");
    assert.equal(status.remoteReadEnabled, true);
    assert.equal(status.remoteFilesEnabled, false);
    assert.equal(status.remoteControlEnabled, false);
    assert.equal(status.remotePreviewEnabled, false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(tokenRequests, 1);
  } finally {
    await service.close();
    await fixture.dispose();
  }
});

test("disconnect during enrollment prevents the delayed response from activating a profile or credential", async () => {
  const fixture = await createFixture();
  let enrollmentStarted = false;
  let releaseEnrollment!: () => void;
  const enrollmentGate = new Promise<void>((resolve) => {
    releaseEnrollment = resolve;
  });
  const fetchImplementation = async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.pathname === "/machines/enroll") {
      enrollmentStarted = true;
      await enrollmentGate;
      return jsonResponse(201, {
        machine: { machineId: "machine-delayed-enrollment" },
        machineCredential: "credential-placeholder"
      });
    }
    return new Response(null, { status: 401 });
  };
  const service = new CloudConnectorService(
    fixture.context,
    new TestEventBus(),
    emptyProjections(),
    { fetchImplementation: fetchImplementation as typeof fetch }
  );
  let connectPromise: Promise<unknown> | null = null;

  try {
    service.start();
    connectPromise = service.connect(connectInput("https://delayed-enrollment.example"));
    await waitFor(() => enrollmentStarted);
    await service.disconnect();
    releaseEnrollment();
    await Promise.allSettled([connectPromise]);

    const status = service.getStatus();
    assert.equal(status.enabled, false);
    assert.equal(status.state, "disconnected");
    assert.equal(status.machineId, null);
    const identity = new SqliteCloudConnectorStore(fixture.context).readIdentity();
    assert.ok(identity);
    const secret = new EncryptedFileCloudSecretStore(fixture.directory).read(identity.credentialRef);
    assert.equal(secret.machineCredential.length, 0);
  } finally {
    releaseEnrollment();
    if (connectPromise) await Promise.allSettled([connectPromise]);
    await service.close();
    await fixture.dispose();
  }
});

test("close aborts an active enrollment request without waiting for its HTTP timeout", async () => {
  const fixture = await createFixture();
  let requestStarted = false;
  let requestAborted = false;
  const service = new CloudConnectorService(
    fixture.context,
    new TestEventBus(),
    emptyProjections(),
    {
      fetchImplementation: (async (_input, init) => {
        requestStarted = true;
        return await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            requestAborted = true;
            reject(signal.reason);
            return;
          }
          signal?.addEventListener("abort", () => {
            requestAborted = true;
            reject(signal.reason);
          }, { once: true });
        });
      }) as typeof fetch
    }
  );
  const enrollment = service.connect(connectInput("https://close-enrollment.example"));
  void enrollment.catch(() => undefined);
  try {
    await waitFor(() => requestStarted);
    const startedAt = Date.now();
    await service.close();
    assert.ok(Date.now() - startedAt < 500);
    assert.equal(requestAborted, true);
    await assert.rejects(enrollment);
  } finally {
    await service.close();
    await fixture.dispose();
  }
});

test("close aborts an active connection-token request without waiting for its HTTP timeout", async () => {
  const fixture = await createFixture();
  let connectionStarted = false;
  let connectionAborted = false;
  const fetchImplementation = async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.pathname === "/machines/enroll") {
      return jsonResponse(201, {
        machine: { machineId: "machine-close-connection" },
        machineCredential: "credential-placeholder"
      });
    }
    connectionStarted = true;
    return await new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        connectionAborted = true;
        reject(signal.reason);
        return;
      }
      signal?.addEventListener("abort", () => {
        connectionAborted = true;
        reject(signal.reason);
      }, { once: true });
    });
  };
  const service = new CloudConnectorService(
    fixture.context,
    new TestEventBus(),
    emptyProjections(),
    { fetchImplementation: fetchImplementation as typeof fetch }
  );
  try {
    service.start();
    await service.connect(connectInput("https://close-connection.example"));
    await waitFor(() => connectionStarted);
    const startedAt = Date.now();
    await service.close();
    assert.ok(Date.now() - startedAt < 500);
    assert.equal(connectionAborted, true);
  } finally {
    await service.close();
    await fixture.dispose();
  }
});

test("a stale connection failure after re-enrollment cannot mutate state or reconnect", async () => {
  const fixture = await createFixture();
  let enrollmentSequence = 0;
  let connectionAttempts = 0;
  let staleConnectionStarted = false;
  let releaseStaleConnection!: () => void;
  const staleConnectionGate = new Promise<void>((resolve) => {
    releaseStaleConnection = resolve;
  });
  const fetchImplementation = async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.pathname === "/machines/enroll") {
      enrollmentSequence += 1;
      return jsonResponse(201, {
        machine: { machineId: `machine-stale-${enrollmentSequence}` },
        machineCredential: "credential-placeholder"
      });
    }
    if (url.pathname.endsWith("/connections")) {
      connectionAttempts += 1;
      if (url.pathname.includes("machine-stale-1")) {
        staleConnectionStarted = true;
        await staleConnectionGate;
        return new Response(null, { status: 500 });
      }
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }
    return new Response(null, { status: 404 });
  };
  const service = new CloudConnectorService(
    fixture.context,
    new TestEventBus(),
    emptyProjections(),
    { fetchImplementation: fetchImplementation as typeof fetch }
  );
  try {
    service.start();
    await service.connect(connectInput("https://stale-connection.example"));
    await waitFor(() => staleConnectionStarted);
    await service.disconnect();
    await service.connect(connectInput("https://stale-connection.example"));
    assert.equal(service.getStatus().machineId, "machine-stale-2");
    assert.equal(service.getStatus().state, "connecting");
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(connectionAttempts, 1);

    releaseStaleConnection();
    await new Promise((resolve) => setTimeout(resolve, 1_400));
    assert.equal(service.getStatus().state, "connecting");
    assert.equal(service.getStatus().lastErrorCode, null);
    assert.equal(connectionAttempts, 1);
  } finally {
    releaseStaleConnection();
    await service.close();
    await fixture.dispose();
  }
});

test("relay event callbacks contain store failures without process-level errors", async () => {
  const fixture = await createFixture();
  const uncaughtExceptions: unknown[] = [];
  const unhandledRejections: unknown[] = [];
  const onUncaughtException = (error: unknown) => uncaughtExceptions.push(error);
  const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);
  let relayClosed = false;
  const server = createServer((request, response) => {
    if (request.url === "/machines/enroll") {
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({
        machine: { machineId: "machine-event-boundary" },
        machineCredential: "credential-placeholder"
      }));
      return;
    }
    if (request.url === "/machines/machine-event-boundary/connections") {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({
        connectionToken: "connection-token-placeholder",
        relayUrl: `ws://127.0.0.1:${address.port}/relay/machines/machine-event-boundary`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        cursors: { "session-summaries": 0 }
      }));
      return;
    }
    response.writeHead(404).end();
  });
  const sockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    sockets.handleUpgrade(request, socket, head, (websocket) => {
      sockets.emit("connection", websocket, request);
    });
  });
  sockets.on("connection", (socket) => {
    socket.once("message", () => {
      fixture.context.close();
      socket.send("{invalid-relay-frame");
    });
    socket.once("close", () => {
      relayClosed = true;
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const service = new CloudConnectorService(
    fixture.context,
    new TestEventBus(),
    emptyProjections(),
    { fetchImplementation: fetch }
  );

  process.on("uncaughtException", onUncaughtException);
  process.on("unhandledRejection", onUnhandledRejection);
  try {
    service.start();
    await service.connect(connectInput(`http://127.0.0.1:${address.port}`));
    await waitFor(() => relayClosed);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(uncaughtExceptions, []);
    assert.deepEqual(unhandledRejections, []);
  } finally {
    process.off("uncaughtException", onUncaughtException);
    process.off("unhandledRejection", onUnhandledRejection);
    await service.close();
    await new Promise<void>((resolve) => sockets.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fixture.dispose();
  }
});

test("stale async projection after disconnect and re-enrollment cannot write to the old profile", async () => {
  const fixture = await createFixture();
  let machineSequence = 0;
  const fetchImplementation = async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.pathname === "/machines/enroll") {
      machineSequence += 1;
      return jsonResponse(201, {
        machine: { machineId: `machine-projection-${machineSequence}` },
        machineCredential: "credential-placeholder"
      });
    }
    return new Response(null, { status: 401 });
  };
  let deferNextProjection = false;
  let projectionStarted = false;
  let releaseProjection!: (sessions: AgentSessionSummary[]) => void;
  const projectionGate = new Promise<AgentSessionSummary[]>((resolve) => {
    releaseProjection = resolve;
  });
  const projections = {
    listLocalLlmChats: async () => [],
    listManagedSessions: () => [],
    listSourceSessions: async () => {
      if (!deferNextProjection) return [];
      deferNextProjection = false;
      projectionStarted = true;
      return projectionGate;
    }
  };
  const events = new TestEventBus();
  const service = new CloudConnectorService(
    fixture.context,
    events,
    projections,
    { fetchImplementation: fetchImplementation as typeof fetch }
  );
  const store = new SqliteCloudConnectorStore(fixture.context);
  let secondConnect: Promise<unknown> | null = null;

  try {
    service.start();
    await service.connect(connectInput("https://projection-old.example"));
    const oldProfile = store.readActiveProfile();
    assert.ok(oldProfile);

    deferNextProjection = true;
    events.emit("event", {});
    await waitFor(() => projectionStarted);
    await service.disconnect();
    secondConnect = service.connect(connectInput("https://projection-new.example"));
    await waitFor(() => store.readActiveProfile()?.cloudOrigin === "https://projection-new.example");

    releaseProjection([sourceSession("stale-source-session")]);
    await secondConnect;
    secondConnect = null;

    const staleRows = fixture.context.database.prepare(`
      SELECT COUNT(*) AS count FROM cloud_sync_outbox WHERE profile_id = ?
    `).get(oldProfile.id) as { count: number };
    assert.equal(staleRows.count, 0);
  } finally {
    releaseProjection([]);
    if (secondConnect) await Promise.allSettled([secondConnect]);
    await service.close();
    await fixture.dispose();
  }
});

test("a stale Preview token request hands reconnect to the current active profile", async () => {
  const fixture = await createFixture();
  const server = createServer();
  const sockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    sockets.handleUpgrade(request, socket, head, (websocket) => {
      sockets.emit("connection", websocket, request);
    });
  });
  let newRelayWelcomed = false;
  let newPreviewOpened = false;
  sockets.on("connection", (socket, request) => {
    if (request.url === "/relay/machines/machine-new/preview") {
      newPreviewOpened = true;
      return;
    }
    socket.once("message", () => {
      const machineId = request.url?.includes("machine-new") ? "machine-new" : "machine-old";
      socket.send(JSON.stringify({
        type: "relay.welcome",
        protocolVersion: 1,
        connectionId: `connection-${machineId}`,
        machineId,
        negotiatedCapabilities: ["session.summary", "deskcue.preview"],
        streamPositions: [{ stream: "session-summaries", nextSequence: 1 }],
        heartbeatIntervalMs: 30_000,
        maxFrameBytes: 16_384,
        connectedAt: new Date().toISOString()
      }));
      if (machineId === "machine-new") newRelayWelcomed = true;
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const relayUrl = (machineId: string) =>
    `ws://127.0.0.1:${address.port}/relay/machines/${machineId}`;
  let enrollmentCount = 0;
  let oldConnectionRequests = 0;
  let newConnectionRequests = 0;
  let oldPreviewTokenRequested = false;
  let releaseOldPreviewToken!: () => void;
  const oldPreviewTokenGate = new Promise<void>((resolve) => {
    releaseOldPreviewToken = resolve;
  });
  const connectionResponse = (machineId: string, sequence: number) => jsonResponse(201, {
    connectionToken: `connection-token-placeholder-${machineId}-${sequence}`,
    relayUrl: relayUrl(machineId),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    cursors: { "session-summaries": 0 }
  });
  const fetchImplementation = async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.pathname === "/machines/enroll") {
      enrollmentCount += 1;
      const machineId = enrollmentCount === 1 ? "machine-old" : "machine-new";
      return jsonResponse(201, {
        machine: { machineId },
        machineCredential: `credential-placeholder-${machineId}`
      });
    }
    if (url.pathname === "/machines/machine-old/connections") {
      oldConnectionRequests += 1;
      if (oldConnectionRequests === 2) {
        oldPreviewTokenRequested = true;
        await oldPreviewTokenGate;
      }
      return connectionResponse("machine-old", oldConnectionRequests);
    }
    if (url.pathname === "/machines/machine-new/connections") {
      newConnectionRequests += 1;
      return connectionResponse("machine-new", newConnectionRequests);
    }
    return new Response(null, { status: 404 });
  };
  const service = new CloudConnectorService(
    fixture.context,
    new TestEventBus(),
    emptyProjections(),
    {
      fetchImplementation: fetchImplementation as typeof fetch,
      previewTargetResolver: async () => ({
        networkMode: "device-direct",
        origin: "http://127.0.0.1:4100",
        port: 4100
      })
    }
  );
  const previewConnectInput = {
    ...connectInput(`http://127.0.0.1:${address.port}`),
    allowRemotePreview: true
  };

  try {
    service.start();
    await service.connect(previewConnectInput);
    await waitFor(() => oldPreviewTokenRequested);
    await service.disconnect();
    await service.connect(previewConnectInput);
    await waitFor(() => newRelayWelcomed);
    assert.equal(newConnectionRequests, 1);

    releaseOldPreviewToken();
    await waitFor(() => newPreviewOpened);
    assert.equal(newConnectionRequests, 2);
    assert.equal(oldConnectionRequests, 2);
  } finally {
    releaseOldPreviewToken();
    await service.close();
    await new Promise<void>((resolve) => sockets.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fixture.dispose();
  }
});
