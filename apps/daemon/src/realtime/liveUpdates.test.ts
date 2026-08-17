import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import test, { beforeEach } from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import type { RawData } from "ws";

import { DESKCUE_PROTOCOL_CAPABILITIES, DESKCUE_PROTOCOL_VERSION } from "@deskcue/protocol";
import { accessDeviceStore } from "#access/accessDevices";
import type { DaemonApplication } from "#application/daemonApplication";
import { daemonConfig } from "#config/daemonConfig";
import { createCloudInternalRequestHeaders } from "#http/routes/access/cloudInternalRequestAuth";

import { readWebSocketMetricsSnapshot, resetWebSocketMetricsForTests } from "./live/metrics.ts";
import {
  createLiveUpdates,
  MAX_WEBSOCKET_INBOUND_PAYLOAD_BYTES,
  sanitizeWebSocketRequestPath
} from "./live/server.ts";

beforeEach(() => {
  resetWebSocketMetricsForTests();
});

function createTestWebSocketUrl(port: number, rawQuery = "") {
  const query = new URLSearchParams(rawQuery);
  query.set("protocolVersion", String(DESKCUE_PROTOCOL_VERSION));
  for (const capability of DESKCUE_PROTOCOL_CAPABILITIES) {
    query.append("protocolCapability", capability);
  }
  return `ws://127.0.0.1:${port}/ws?${query.toString()}`;
}

function listen(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });
}

function closeServer(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function waitForOpen(client: WebSocket) {
  if (client.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  if (client.readyState === WebSocket.CLOSED || client.readyState === WebSocket.CLOSING) {
    return Promise.reject(new Error("WebSocket closed before it opened."));
  }

  return new Promise<void>((resolve, reject) => {
    client.once("open", () => resolve());
    client.once("error", reject);
  });
}

function waitForMessage(
  client: WebSocket,
  { includeProtocolHello = false }: { includeProtocolHello?: boolean } = {}
) {
  return new Promise<string>((resolve, reject) => {
    let onMessage: (message: RawData) => void;
    const timeout = setTimeout(() => {
      client.off("message", onMessage);
      reject(new Error("Timed out waiting for WebSocket message."));
    }, 1000);

    onMessage = (message: RawData) => {
      const text = String(message);
      if (!includeProtocolHello) {
        try {
          if (JSON.parse(text)?.type === "protocol.hello") {
            return;
          }
        } catch {
          // Return malformed payloads to the caller so the assertion owns them.
        }
      }
      clearTimeout(timeout);
      client.off("message", onMessage);
      resolve(text);
    };

    client.on("message", onMessage);
    client.once("error", reject);
  });
}

async function waitFor(condition: () => boolean) {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > 1000) {
      throw new Error("Timed out waiting for condition.");
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }
}

test("live updates tracks WebSocket presence and closes cleanly", async () => {
  const server = createServer();
  await listen(server);

  const session = {
    id: "session-1",
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    adapterId: "generic-cli",
    sourceSessionId: null,
    command: "npm test",
    status: "running" as const,
    startedAt: "2026-06-22T10:00:00.000Z",
    finishedAt: null,
    lastActivityAt: "2026-06-22T10:01:00.000Z",
    exitCode: null,
    preview: {
      active: false,
      networkMode: "device-direct" as const,
      port: null,
      targetUrl: null
    },
    replyState: {
      phase: "idle" as const,
      promptText: null,
      requestedAt: null
    },
    canSendInput: true,
    git: {
      branch: "main",
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: true,
      lastUpdatedAt: "2026-06-22T10:01:00.000Z"
    }
  };
  const events = new EventEmitter();
  const liveUpdates = createLiveUpdates({
    accessToken: null,
    authRequired: false,
    application: {
      events: Object.assign(events, {
        publishServerEvent: (event: unknown) => events.emit("event", event)
      }),
      managedSessions: {
        listSessions: () => [session]
      },
      sourceAgentSessions: {
        listRecentSessions: async () => []
      }
    } as unknown as DaemonApplication,
    decorateSession: (value) => value,
    server
  });

  const address = server.address();
  if (!address || typeof address !== "object") {
    throw new Error("Expected server to listen on a TCP address.");
  }

  const client = new WebSocket(createTestWebSocketUrl(address.port));
  const helloMessage = waitForMessage(client, { includeProtocolHello: true });
  await waitForOpen(client);
  const hello = JSON.parse(await helloMessage) as {
    payload?: { capabilities?: unknown[]; version?: number };
    type?: string;
  };
  assert.equal(hello.type, "protocol.hello");
  assert.equal(hello.payload?.version, 1);
  assert.equal(Array.isArray(hello.payload?.capabilities), true);
  client.send(JSON.stringify({ type: "presence", sessionId: "session-1" }));
  await waitFor(() => liveUpdates.getViewerCountForSession("session-1") === 1);

  assert.equal(liveUpdates.getViewerCountForSession("session-1"), 1);

  await new Promise<void>((resolve) => {
    liveUpdates.close(resolve);
  });
  await closeServer(server);
});

function fakeApplication(sessions: Array<{ id: string }>) {
  const events = new EventEmitter();

  return {
    events: Object.assign(events, {
      publishServerEvent: (event: unknown) => events.emit("event", event)
    }),
    managedSessions: {
      listSessions: () => sessions
    },
    sourceAgentSessions: {
      listRecentSessions: async () => []
    }
  } as unknown as DaemonApplication;
}

test("live updates leaves non-/ws upgrades for other application gateways", async () => {
  const server = createServer();
  await listen(server);
  const liveUpdates = createLiveUpdates({
    accessToken: null,
    authRequired: false,
    application: fakeApplication([]),
    decorateSession: (value) => value,
    server
  });
  const previewWebSockets = new WebSocketServer({ noServer: true });
  const handlePreviewUpgrade = (
    request: import("node:http").IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer
  ) => {
    if (new URL(request.url ?? "/", "http://deskcue.local").pathname !== "/preview") return;
    previewWebSockets.handleUpgrade(request, socket, head, (client) => {
      previewWebSockets.emit("connection", client, request);
    });
  };
  server.on("upgrade", handlePreviewUpgrade);
  previewWebSockets.on("connection", (socket) => {
    socket.on("message", (data) => socket.send(`preview:${data.toString()}`));
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const client = new WebSocket(`ws://127.0.0.1:${address.port}/preview`);

  try {
    await waitForOpen(client);
    const response = waitForMessage(client);
    client.send("ready");
    assert.equal(await response, "preview:ready");
  } finally {
    client.terminate();
    server.off("upgrade", handlePreviewUpgrade);
    await new Promise<void>((resolve) => previewWebSockets.close(() => resolve()));
    await new Promise<void>((resolve) => liveUpdates.close(resolve));
    await closeServer(server);
  }
});

function waitForUnexpectedResponse(client: WebSocket) {
  return new Promise<number>((resolve, reject) => {
    client.once("unexpected-response", (_request, response) => {
      response.resume();
      client.terminate();
      resolve(response.statusCode ?? 0);
    });
    client.once("open", () => reject(new Error("Expected WebSocket connection rejection.")));
    client.once("error", () => {
      // The unexpected-response event carries the status code; ws may also emit error.
    });
  });
}

test("live updates rejects clients without a compatible protocol handshake", async () => {
  const server = createServer();
  await listen(server);
  const liveUpdates = createLiveUpdates({
    accessToken: null,
    authRequired: false,
    application: fakeApplication([]),
    decorateSession: (value) => value,
    server
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const missingHandshake = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
  const wrongVersion = new WebSocket(createTestWebSocketUrl(address.port)
    .replace("protocolVersion=1", "protocolVersion=999"));
  const missingResponse = waitForUnexpectedResponse(missingHandshake);
  const wrongVersionResponse = waitForUnexpectedResponse(wrongVersion);

  try {
    assert.equal(await missingResponse, 426);
    assert.equal(await wrongVersionResponse, 426);
  } finally {
    missingHandshake.terminate();
    wrongVersion.terminate();
    await new Promise<void>((resolve) => liveUpdates.close(resolve));
    await closeServer(server);
  }
});

function waitForCloseCode(client: WebSocket) {
  if (client.readyState === WebSocket.CLOSED) {
    return Promise.resolve((client as WebSocket & { closeCode?: number }).closeCode ?? 1005);
  }

  return new Promise<number>((resolve, reject) => {
    client.once("close", (code) => {
      resolve(code);
    });
    client.once("error", reject);
  });
}

test("live updates closes clients that exceed the inbound payload budget", async () => {
  const server = createServer();
  await listen(server);
  const liveUpdates = createLiveUpdates({
    accessToken: null,
    authRequired: false,
    application: fakeApplication([]),
    decorateSession: (value) => value,
    server
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const client = new WebSocket(createTestWebSocketUrl(address.port));

  try {
    await waitForOpen(client);
    const closed = waitForCloseCode(client);
    client.send(Buffer.alloc(MAX_WEBSOCKET_INBOUND_PAYLOAD_BYTES + 1, "x"));
    assert.equal(await closed, 1009);
  } finally {
    client.terminate();
    await new Promise<void>((resolve) => liveUpdates.close(resolve));
    await closeServer(server);
  }
});

test("live updates counts duplicate sockets from one browser tab as one viewer", async () => {
  const server = createServer();
  await listen(server);

  const session = {
    id: "session-1"
  };
  const liveUpdates = createLiveUpdates({
    accessToken: null,
    authRequired: false,
    application: fakeApplication([session]),
    decorateSession: (value) => value,
    server
  });

  const address = server.address();
  assert(address && typeof address === "object");

  const firstClient = new WebSocket(createTestWebSocketUrl(address.port));
  const secondClient = new WebSocket(createTestWebSocketUrl(address.port));
  await Promise.all([waitForOpen(firstClient), waitForOpen(secondClient)]);

  firstClient.send(JSON.stringify({
    clientId: "browser-tab-1",
    type: "presence",
    sessionId: "session-1"
  }));
  secondClient.send(JSON.stringify({
    clientId: "browser-tab-1",
    type: "presence",
    sessionId: "session-1"
  }));

  await waitFor(() => liveUpdates.getViewerCountForSession("session-1") === 1);
  assert.equal(liveUpdates.getViewerCountForSession("session-1"), 1);

  firstClient.close();
  secondClient.close();
  await new Promise<void>((resolve) => {
    liveUpdates.close(resolve);
  });
  await closeServer(server);
});

test("live updates rejects WebSocket clients without the configured access token", async () => {
  const server = createServer();
  await listen(server);
  const liveUpdates = createLiveUpdates({
    accessToken: "secret-token",
    authRequired: true,
    application: fakeApplication([]),
    decorateSession: (value) => value,
    server
  });

  const address = server.address();
  assert(address && typeof address === "object");

  const lanHeaders = {
    "x-forwarded-for": "203.0.113.70"
  };
  const rejectedClient = new WebSocket(createTestWebSocketUrl(address.port), {
    headers: lanHeaders
  });
  const rejectedStatus = await waitForUnexpectedResponse(rejectedClient);
  const acceptedClient = new WebSocket(createTestWebSocketUrl(address.port, "token=secret-token"), {
    headers: lanHeaders
  });
  const cookieClient = new WebSocket(createTestWebSocketUrl(address.port), {
    headers: {
      ...lanHeaders,
      cookie: "deskcue_access=secret-token"
    }
  });

  assert.equal(rejectedStatus, 401);
  await waitForOpen(acceptedClient);
  await waitForOpen(cookieClient);
  acceptedClient.close();
  cookieClient.close();

  await new Promise<void>((resolve) => {
    liveUpdates.close(resolve);
  });
  await closeServer(server);
});

test("live updates allows only same-origin loopback WebSocket clients without a token", async () => {
  const server = createServer();
  await listen(server);
  const address = server.address();
  assert(address && typeof address === "object");
  const ownOrigin = `http://127.0.0.1:${address.port}`;
  const otherLoopbackOrigin = "http://127.0.0.1:3000";
  const liveUpdates = createLiveUpdates({
    accessToken: "secret-token",
    authRequired: true,
    allowedOrigins: [ownOrigin, otherLoopbackOrigin],
    application: fakeApplication([]),
    decorateSession: (value) => value,
    server
  });

  let proxiedExternalHost: WebSocket | null = null;
  let proxiedExternalOrigin: WebSocket | null = null;
  let missingOrigin: WebSocket | null = null;
  let otherLoopbackClient: WebSocket | null = null;
  let ownOriginClient: WebSocket | null = null;

  try {
    proxiedExternalHost = new WebSocket(createTestWebSocketUrl(address.port), {
      headers: {
        host: "203.0.113.23:4173"
      }
    });
    assert.equal(await waitForUnexpectedResponse(proxiedExternalHost), 401);

    proxiedExternalOrigin = new WebSocket(createTestWebSocketUrl(address.port), {
      origin: "http://203.0.113.23:4173"
    });
    assert.equal(await waitForUnexpectedResponse(proxiedExternalOrigin), 403);

    missingOrigin = new WebSocket(createTestWebSocketUrl(address.port));
    assert.equal(await waitForUnexpectedResponse(missingOrigin), 401);

    otherLoopbackClient = new WebSocket(createTestWebSocketUrl(address.port), {
      origin: otherLoopbackOrigin
    });
    assert.equal(await waitForUnexpectedResponse(otherLoopbackClient), 401);

    ownOriginClient = new WebSocket(createTestWebSocketUrl(address.port), {
      origin: ownOrigin
    });
    await waitForOpen(ownOriginClient);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.equal(ownOriginClient.readyState, WebSocket.OPEN);
  } finally {
    proxiedExternalHost?.terminate();
    proxiedExternalOrigin?.terminate();
    missingOrigin?.terminate();
    otherLoopbackClient?.terminate();
    ownOriginClient?.terminate();
    await new Promise<void>((resolve) => {
      liveUpdates.close(resolve);
    });
    await closeServer(server);
  }
});

test("live updates keeps an authorized cloud connector WebSocket open across access rechecks", async () => {
  const server = createServer();
  await listen(server);
  const liveUpdates = createLiveUpdates({
    accessToken: "secret-token",
    authRequired: true,
    application: fakeApplication([]),
    decorateSession: (value) => value,
    server
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const client = new WebSocket(createTestWebSocketUrl(address.port), {
    headers: createCloudInternalRequestHeaders()
  });

  try {
    await waitForOpen(client);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.equal(client.readyState, WebSocket.OPEN);
  } finally {
    client.terminate();
    await new Promise<void>((resolve) => {
      liveUpdates.close(resolve);
    });
    await closeServer(server);
  }
});

test("live updates closes connected clients when the access device is revoked", async () => {
  const previousConfig = {
    authRequired: daemonConfig.authRequired
  };
  const server = createServer();
  await listen(server);

  try {
    daemonConfig.authRequired = true;
    const device = accessDeviceStore.createDevice({
      ip: "127.0.0.1",
      label: "Test browser",
      userAgent: "test"
    });

    const liveUpdates = createLiveUpdates({
      application: fakeApplication([]),
      decorateSession: (value) => value,
      server
    });

    const address = server.address();
    assert(address && typeof address === "object");

    const client = new WebSocket(createTestWebSocketUrl(address.port, `token=${device.accessToken}`));
    await waitForOpen(client);

    assert.equal(accessDeviceStore.revokeCurrentDevice(device.device.id).revokedCount, 1);
    assert.equal(await waitForCloseCode(client), 4001);

    await new Promise<void>((resolve) => {
      liveUpdates.close(resolve);
    });
  } finally {
    daemonConfig.authRequired = previousConfig.authRequired;
    await closeServer(server);
  }
});

test("live updates closes connected clients when auth is enabled after connect", async () => {
  const previousConfig = {
    authRequired: daemonConfig.authRequired
  };
  const server = createServer();
  await listen(server);

  try {
    daemonConfig.authRequired = false;

    const liveUpdates = createLiveUpdates({
      application: fakeApplication([]),
      decorateSession: (value) => value,
      server
    });

    const address = server.address();
    assert(address && typeof address === "object");

    const client = new WebSocket(createTestWebSocketUrl(address.port), {
      headers: {
        "x-forwarded-for": "203.0.113.70"
      }
    });
    await waitForOpen(client);

    daemonConfig.authRequired = true;
    assert.equal(await waitForCloseCode(client), 4001);

    await new Promise<void>((resolve) => {
      liveUpdates.close(resolve);
    });
  } finally {
    daemonConfig.authRequired = previousConfig.authRequired;
    await closeServer(server);
  }
});

test("live updates rejects WebSocket clients from disallowed origins", async () => {
  const server = createServer();
  await listen(server);
  const liveUpdates = createLiveUpdates({
    accessToken: null,
    authRequired: true,
    allowedOrigins: ["http://allowed.example"],
    application: fakeApplication([]),
    decorateSession: (value) => value,
    server
  });

  const address = server.address();
  assert(address && typeof address === "object");

  const client = new WebSocket(createTestWebSocketUrl(address.port), {
    origin: "http://blocked.example"
  });
  const status = await waitForUnexpectedResponse(client);

  assert.equal(status, 403);

  await new Promise<void>((resolve) => {
    liveUpdates.close(resolve);
  });
  await closeServer(server);
});

test("live updates allows unauthenticated LAN origins when auth is disabled", async () => {
  const server = createServer();
  await listen(server);
  const liveUpdates = createLiveUpdates({
    accessToken: "secret-token",
    authRequired: false,
    allowedOrigins: ["http://allowed.example"],
    application: fakeApplication([]),
    decorateSession: (value) => value,
    server
  });

  const address = server.address();
  assert(address && typeof address === "object");

  const client = new WebSocket(createTestWebSocketUrl(address.port), {
    origin: "http://deskcue-lan.local:4173"
  });

  await waitForOpen(client);
  client.close();

  await new Promise<void>((resolve) => {
    liveUpdates.close(resolve);
  });
  await closeServer(server);
});

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

test("live updates keeps access monitor sockets out of presence and broadcasts", async () => {
  const server = createServer();
  await listen(server);

  const session = {
    id: "session-1",
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    adapterId: "generic-cli",
    sourceSessionId: null,
    command: "npm test",
    status: "running" as const,
    startedAt: "2026-06-22T10:00:00.000Z",
    finishedAt: null,
    lastActivityAt: "2026-06-22T10:01:00.000Z",
    exitCode: null,
    preview: {
      active: false,
      networkMode: "device-direct" as const,
      port: null,
      targetUrl: null
    },
    replyState: {
      phase: "idle" as const,
      promptText: null,
      requestedAt: null
    },
    canSendInput: true,
    git: {
      branch: "main",
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: true,
      lastUpdatedAt: "2026-06-22T10:01:00.000Z"
    }
  };
  const application = fakeApplication([session]);
  const liveUpdates = createLiveUpdates({
    accessToken: null,
    authRequired: false,
    application,
    decorateSession: (value) => value,
    server
  });

  const address = server.address();
  assert(address && typeof address === "object");

  const accessClient = new WebSocket(createTestWebSocketUrl(address.port, "mode=access"));
  const liveClient = new WebSocket(createTestWebSocketUrl(address.port));
  await Promise.all([waitForOpen(accessClient), waitForOpen(liveClient)]);

  accessClient.send(JSON.stringify({
    clientId: "browser-tab-1",
    type: "presence",
    sessionId: "session-1"
  }));
  await delay(20);
  assert.equal(liveUpdates.getViewerCountForSession("session-1"), 0);

  liveClient.send(JSON.stringify({
    clientId: "browser-tab-1",
    type: "presence",
    sessionId: "session-1"
  }));
  await waitFor(() => liveUpdates.getViewerCountForSession("session-1") === 1);

  let accessMessageReceived = false;
  accessClient.once("message", () => {
    accessMessageReceived = true;
  });
  const liveMessage = waitForMessage(liveClient);
  application.events.publishServerEvent({
    type: "session.updated",
    payload: session
  });

  assert.equal(JSON.parse(await liveMessage).type, "session.updated");
  await delay(20);
  assert.equal(accessMessageReceived, false);

  accessClient.close();
  liveClient.close();
  await new Promise<void>((resolve) => {
    liveUpdates.close(resolve);
  });
  await closeServer(server);
});

test("live updates sends session log events only to clients viewing the logs tab", async () => {
  const server = createServer();
  await listen(server);

  const session = {
    id: "session-1",
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    adapterId: "generic-cli",
    sourceSessionId: null,
    command: "npm test",
    status: "running" as const,
    startedAt: "2026-06-22T10:00:00.000Z",
    finishedAt: null,
    lastActivityAt: "2026-06-22T10:01:00.000Z",
    exitCode: null,
    preview: {
      active: false,
      networkMode: "device-direct" as const,
      port: null,
      targetUrl: null
    },
    replyState: {
      phase: "idle" as const,
      promptText: null,
      requestedAt: null
    },
    canSendInput: true,
    git: {
      branch: "main",
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: true,
      lastUpdatedAt: "2026-06-22T10:01:00.000Z"
    }
  };
  const application = fakeApplication([session]);
  const liveUpdates = createLiveUpdates({
    accessToken: null,
    authRequired: false,
    application,
    decorateSession: (value) => value,
    server
  });

  const address = server.address();
  assert(address && typeof address === "object");

  const overviewClient = new WebSocket(createTestWebSocketUrl(address.port));
  const logsClient = new WebSocket(createTestWebSocketUrl(address.port));
  await Promise.all([waitForOpen(overviewClient), waitForOpen(logsClient)]);

  overviewClient.send(JSON.stringify({
    type: "presence",
    sessionId: "session-1",
    sessionTab: "overview"
  }));
  logsClient.send(JSON.stringify({
    type: "presence",
    sessionId: "session-1",
    sessionTab: "logs"
  }));
  await waitFor(() => liveUpdates.getViewerCountForSession("session-1") === 2);

  let overviewLogReceived = false;
  overviewClient.on("message", (message) => {
    if (JSON.parse(String(message)).type === "session.log") {
      overviewLogReceived = true;
    }
  });

  const logsMessage = waitForMessage(logsClient);
  application.events.publishServerEvent({
    type: "session.log",
    payload: {
      sessionId: "session-1",
      log: {
        id: "log-1",
        stream: "stdout",
        text: "line",
        timestamp: "2026-06-22T10:02:00.000Z"
      }
    }
  });

  assert.equal(JSON.parse(await logsMessage).type, "session.log");
  await delay(20);
  assert.equal(overviewLogReceived, false);

  const overviewUpdate = waitForMessage(overviewClient);
  application.events.publishServerEvent({
    type: "session.updated",
    payload: session
  });
  assert.equal(JSON.parse(await overviewUpdate).type, "session.updated");

  overviewClient.close();
  logsClient.close();
  await new Promise<void>((resolve) => {
    liveUpdates.close(resolve);
  });
  await closeServer(server);
});

test("live updates replays buffered small events after cursor and accepts ack", async () => {
  const server = createServer();
  await listen(server);

  const application = fakeApplication([]);
  const liveUpdates = createLiveUpdates({
    accessToken: null,
    authRequired: false,
    application,
    decorateSession: (value) => value,
    server
  });

  const address = server.address();
  assert(address && typeof address === "object");

  const clientId = `replay-client-${Date.now()}`;
  let firstClient: WebSocket | null = null;
  let replayClient: WebSocket | null = null;

  try {
    firstClient = new WebSocket(createTestWebSocketUrl(address.port, `clientId=${clientId}`));
    await waitForOpen(firstClient);

    const firstMessage = waitForMessage(firstClient);
    application.events.publishServerEvent({
      type: "workspace.created",
      payload: {
        branch: null,
        createdAt: "2026-07-25T00:00:00.000Z",
        id: "workspace-live-replay-test",
        isGitRepo: false,
        name: "Replay workspace",
        path: "D:\\work\\replay"
      }
    });

    const firstPayload = JSON.parse(await firstMessage) as { cursor?: string; payload?: { id?: string } };
    assert.equal(firstPayload.payload?.id, "workspace-live-replay-test");
    assert.equal(Boolean(firstPayload.cursor), true);
    firstClient.send(JSON.stringify({
      clientId,
      cursor: firstPayload.cursor,
      type: "ack"
    }));
    await waitFor(() => readWebSocketMetricsSnapshot().ackCount >= 1);

    const firstClosed = waitForCloseCode(firstClient);
    firstClient.close();
    await firstClosed;
    await waitFor(() => readWebSocketMetricsSnapshot().disconnectedCount >= 1);

    const afterCursor = String(Number(firstPayload.cursor) - 1);
    replayClient = new WebSocket(createTestWebSocketUrl(
      address.port,
      `clientId=${clientId}&afterCursor=${afterCursor}`
    ));
    const replayMessage = waitForMessage(replayClient);
    await waitForOpen(replayClient);
    await waitFor(() => readWebSocketMetricsSnapshot().reconnectCount >= 1);

    const replayPayload = JSON.parse(await replayMessage) as {
      cursor?: string;
      payload?: { id?: string };
    };
    assert.equal(replayPayload.payload?.id, "workspace-live-replay-test");
    assert.equal(replayPayload.cursor, firstPayload.cursor);

    const metrics = readWebSocketMetricsSnapshot();
    assert.equal(metrics.ackCount >= 1, true);
    assert.equal(metrics.reconnectCount >= 1, true);
    assert.equal(metrics.replayedEventCount >= 1, true);
  } finally {
    firstClient?.terminate();
    replayClient?.terminate();
    await new Promise<void>((resolve) => {
      liveUpdates.close(resolve);
    });
    await closeServer(server);
  }
});

test("live updates publishes local LLM completion as hydration metadata without the answer", async () => {
  const server = createServer();
  await listen(server);

  const application = fakeApplication([]);
  const liveUpdates = createLiveUpdates({
    accessToken: null,
    authRequired: false,
    application,
    decorateSession: (value) => value,
    server
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const client = new WebSocket(createTestWebSocketUrl(address.port));

  try {
    await waitForOpen(client);
    const message = waitForMessage(client);
    application.events.publishServerEvent({
      type: "local.llm.chat.finished",
      payload: {
        answer: "x".repeat(512 * 1024),
        chatId: "chat-hydration-test",
        completedAt: "2026-08-06T00:00:00.000Z",
        error: null,
        model: "model",
        runtimeId: "ollama",
        status: "completed",
        title: "Hydration test"
      }
    });

    const event = JSON.parse(await message) as {
      payload?: { answer?: string | null; chatId?: string };
      type?: string;
    };
    assert.equal(event.type, "local.llm.chat.finished");
    assert.equal(event.payload?.chatId, "chat-hydration-test");
    assert.equal(event.payload?.answer, null);
    assert.equal(readWebSocketMetricsSnapshot().bufferedEventBytes < 1024, true);
  } finally {
    client.terminate();
    await new Promise<void>((resolve) => {
      liveUpdates.close(resolve);
    });
    await closeServer(server);
  }
});

test("live updates redacts access tokens from logged WebSocket paths", () => {
  assert.equal(
    sanitizeWebSocketRequestPath("/ws?token=secret-token&sessionId=session-1"),
    "/ws?token=%5Bredacted%5D&sessionId=session-1"
  );
  assert.equal(
    sanitizeWebSocketRequestPath("/ws?access_token=secret-token&deskcueToken=legacy-token"),
    "/ws?access_token=%5Bredacted%5D&deskcueToken=%5Bredacted%5D"
  );
});
