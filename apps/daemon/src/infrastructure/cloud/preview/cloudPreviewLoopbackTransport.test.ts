import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { WebSocketServer } from "ws";

import { PreviewCookieJar } from "#http/routes/system/preview/egress/previewCookieJar";
import { resolvePreviewWebSocketTargetUrls } from "#http/routes/system/preview/egress/previewWebSocketTarget";
import { MAX_REWRITABLE_PREVIEW_JAVASCRIPT_BYTES } from "#http/routes/system/preview/relay/previewContentRewrite";

import {
  executeCloudPreviewLoopbackHttp,
  openCloudPreviewLoopbackWebSocket
} from "./cloudPreviewLoopbackTransport.ts";

function listen(server: import("node:http").Server) {
  return new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server: import("node:http").Server) {
  return new Promise<void>((resolve, reject) => server.close((error) => {
    if (error) reject(error);
    else resolve();
  }));
}

function readAddress(server: import("node:http").Server) {
  const address = server.address();

  assert.ok(address && typeof address === "object");

  return address;
}

test("loopback HTTP exposes response chunks without waiting for upstream completion and cancels its reader", async () => {
  let readerCancelled = false;
  const server = createServer((_request, response) => {
    response.once("close", () => { readerCancelled = true; });
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.flushHeaders();
    response.write("first-event");
  });

  await listen(server);
  const address = readAddress(server);
  const origin = `http://127.0.0.1:${address.port}`;
  const result = await executeCloudPreviewLoopbackHttp({
    body: Buffer.alloc(0),
    headers: [["accept", "text/event-stream"]],
    method: "GET",
    owner: { id: "session-1", kind: "session" },
    pathAndQuery: "/events",
    signal: new AbortController().signal,
    target: {
      networkMode: "device-direct",
      origin,
      port: address.port
    },
    targetUrl: new URL("/events", origin),
    viewerKey: "abcdefghijklmnopqrstuvwx",
    egress: false,
    stripAuthorization: false
  });
  const body = result.body[Symbol.asyncIterator]();
  const first = await body.next();

  assert.equal(first.done, false);

  assert.equal(first.value?.toString(), "first-event");
  assert.equal(readerCancelled, false);

  await body.return?.();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(readerCancelled, true);
  await close(server);
});

test("loopback WebSocket preserves protocol, text messages, and exact target", async () => {
  const server = createServer();
  const websocketServer = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    assert.equal(request.url, "/hmr");
    const address = readAddress(server);

    assert.equal(request.headers.origin, `http://127.0.0.1:${address.port}`);

    assert.equal(request.headers.referer, `http://127.0.0.1:${address.port}/hmr`);

    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request);
    });
  });
  websocketServer.on("headers", (headers) => {
    headers.push("X-Preview-Handshake: forwarded");
    headers.push("Set-Cookie: ws_app=opaque; Path=/");
  });
  websocketServer.on("connection", (socket) => {
    socket.on("message", (data, binary) => socket.send(data, { binary }));
  });

  await listen(server);
  const address = readAddress(server);
  let resolveMessage!: (message: { binary: boolean; body: Buffer }) => void;
  const received = new Promise<{ binary: boolean; body: Buffer }>((resolve) => {
    resolveMessage = resolve;
  });
  const session = await openCloudPreviewLoopbackWebSocket({
    headers: [
      ["origin", "https://viewer.preview.deskcue.io"],
      ["referer", "https://viewer.preview.deskcue.io/hmr"]
    ],
    method: "GET",
    owner: { id: "session-1", kind: "session" },
    pathAndQuery: "/hmr",
    protocols: [],
    signal: new AbortController().signal,
    target: {
      networkMode: "device-direct",
      origin: `http://127.0.0.1:${address.port}`,
      port: address.port
    },
    targetUrl: new URL(`ws://127.0.0.1:${address.port}/hmr`),
    viewerKey: "abcdefghijklmnopqrstuvwx",
    egress: false,
    stripAuthorization: false
  }, {
    onClose() {},
    onMessage(body, binary) { resolveMessage({ binary, body }); }
  });
  assert.deepEqual(
    session.headers.find(([name]) => name === "x-preview-handshake"),
    ["x-preview-handshake", "forwarded"]
  );

  assert.deepEqual(
    session.headers.find(([name]) => name === "set-cookie"),
    ["set-cookie", "ws_app=opaque; Path=/"]
  );

  session.send(Buffer.from("vite-hmr"), false);

  try {
    const message = await received;

    assert.equal(message.binary, false);

    assert.equal(message.body.toString(), "vite-hmr");
  } finally {
    session.close(1000, "test_complete");
    for (const client of websocketServer.clients) client.close();
    await new Promise<void>((resolve) => websocketServer.close(() => resolve()));
    await close(server);
  }
});

test("WebSocket target normalization preserves secure transport and secure-cookie context", () => {
  const owner = { id: "session-1", kind: "session" } as const;
  const viewerKey = "abcdefghijklmnopqrstuvwx";
  const secure = resolvePreviewWebSocketTargetUrls(
    new URL("wss://remote.example:9443/socket?channel=preview")
  );
  const insecure = resolvePreviewWebSocketTargetUrls(
    new URL("ws://remote.example:9080/socket?channel=preview")
  );

  assert.equal(secure.websocketUrl.href, "wss://remote.example:9443/socket?channel=preview");
  assert.equal(secure.httpUrl.href, "https://remote.example:9443/socket?channel=preview");
  assert.equal(insecure.websocketUrl.href, "ws://remote.example:9080/socket?channel=preview");
  assert.equal(insecure.httpUrl.href, "http://remote.example:9080/socket?channel=preview");

  const cookieJar = new PreviewCookieJar();

  cookieJar.store(owner, viewerKey, secure.httpUrl, ["secure_session=opaque; Path=/; Secure"]);

  assert.equal(cookieJar.read(owner, viewerKey, secure.httpUrl), "secure_session=opaque");
  assert.equal(cookieJar.read(owner, viewerKey, insecure.httpUrl), null);
});

async function collectBody(body: AsyncIterable<Buffer>) {
  const chunks: Buffer[] = [];

  for await (const chunk of body) chunks.push(chunk);

  return Buffer.concat(chunks);
}

test("loopback HTTP allows bounded JavaScript chunks larger than the HTML rewrite limit", async () => {
  const source = Buffer.alloc(3 * 1024 * 1024, 0x20);
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "content-length": String(source.byteLength),
      "content-type": "text/javascript; charset=utf-8"
    });

    response.end(source);
  });

  await listen(server);
  const address = readAddress(server);
  const origin = `http://127.0.0.1:${address.port}`;

  try {
    const result = await executeCloudPreviewLoopbackHttp({
      body: Buffer.alloc(0),
      headers: [],
      method: "GET",
      owner: { id: "session-1", kind: "session" },
      pathAndQuery: "/static/large-remote.js",
      signal: new AbortController().signal,
      target: { networkMode: "device-direct", origin, port: address.port },
      targetUrl: new URL("/static/large-remote.js", origin),
      viewerKey: "abcdefghijklmnopqrstuvwx",
      egress: false,
      stripAuthorization: false
    });
    const body = await collectBody(result.body);

    assert.equal(result.status, 200);
    assert.ok(body.byteLength > source.byteLength);
    assert.ok(body.byteLength <= MAX_REWRITABLE_PREVIEW_JAVASCRIPT_BYTES);
    assert.ok(body.subarray(body.byteLength - source.byteLength).equals(source));
  } finally {
    await close(server);
  }
});

test("proxy HTTP rewrites local redirects, preserves browser-direct external redirects and Range", async () => {
  let externalRequests = 0;
  let assetRequestHeaders: import("node:http").IncomingHttpHeaders | null = null;
  const external = createServer((_request, response) => {
    externalRequests += 1;
    response.end("external");
  });

  await listen(external);
  const externalAddress = readAddress(external);
  const local = createServer((request, response) => {
    if (request.url === "/redirect-local") {
      const address = readAddress(local);

      response.writeHead(302, {
        location: `http://127.0.0.1:${address.port}/asset`
      }).end();
      return;
    }

    if (request.url === "/redirect-external") {
      response.writeHead(302, {
        location: `http://127.0.0.1:${externalAddress.port}/stolen`
      }).end();
      return;
    }

    assetRequestHeaders = request.headers;
    const address = readAddress(local);

    response.writeHead(206, {
      "access-control-allow-origin": `http://127.0.0.1:${address.port}`,
      "content-range": "bytes 0-1/2",
      "content-type": "text/plain",
      "content-security-policy": "default-src 'self'",
      "set-cookie": "private=1; Path=/auth",
      "x-frame-options": "SAMEORIGIN"
    });

    response.end("ok");
  });

  await listen(local);
  const localAddress = readAddress(local);
  const target = {
    networkMode: "device-direct" as const,
    origin: `http://127.0.0.1:${localAddress.port}`,
    port: localAddress.port
  };

  try {
    const redirect = await executeCloudPreviewLoopbackHttp({
      body: Buffer.alloc(0),
      headers: [["range", "bytes=0-1"]],
      method: "GET",
      owner: { id: "session-1", kind: "session" },
      pathAndQuery: "/redirect-local",
      signal: new AbortController().signal,
      target,
      targetUrl: new URL("/redirect-local", target.origin),
      viewerKey: "abcdefghijklmnopqrstuvwx",
      egress: false,
      stripAuthorization: false
    });

    assert.equal(redirect.status, 302);
    assert.deepEqual(redirect.headers.find(([name]) => name === "location"), ["location", "/asset"]);
    await redirect.cancel();

    const asset = await executeCloudPreviewLoopbackHttp({
      body: Buffer.alloc(0),
      headers: [
        ["range", "bytes=0-1"],
        ["authorization", "Bearer application-preview-token"],
        ["cookie", "app_session=opaque"],
        ["origin", "https://abcdefghijklmnopqrstuvwx.preview.deskcue.io"],
        ["referer", "https://abcdefghijklmnopqrstuvwx.preview.deskcue.io/asset"]
      ],
      method: "GET",
      owner: { id: "session-1", kind: "session" },
      pathAndQuery: "/asset",
      signal: new AbortController().signal,
      target,
      targetUrl: new URL("/asset", target.origin),
      viewerKey: "abcdefghijklmnopqrstuvwx",
      egress: false,
      stripAuthorization: false
    });

    assert.equal(asset.status, 206);
    assert.equal((await collectBody(asset.body)).toString(), "ok");
    const observedHeaders = assetRequestHeaders as import("node:http").IncomingHttpHeaders | null;

    assert.ok(observedHeaders);

    assert.equal(observedHeaders.range, "bytes=0-1");
    assert.equal(observedHeaders.authorization, "Bearer application-preview-token");
    assert.equal(observedHeaders.cookie, "app_session=opaque");
    assert.equal(observedHeaders.origin, target.origin);
    assert.equal(observedHeaders.referer, `${target.origin}/asset`);
    assert.deepEqual(
      asset.headers.find(([name]) => name === "set-cookie"),
      ["set-cookie", "private=1; Path=/auth"]
    );

    assert.deepEqual(asset.headers.find(([name]) => name === "content-security-policy"),
      ["content-security-policy", "default-src 'self'"]);
    assert.deepEqual(asset.headers.find(([name]) => name === "x-frame-options"),
      ["x-frame-options", "SAMEORIGIN"]);
    assert.deepEqual(
      asset.headers.find(([name]) => name === "access-control-allow-origin"),
      ["access-control-allow-origin", "https://abcdefghijklmnopqrstuvwx.preview.deskcue.io"]
    );

    const externalRedirect = await executeCloudPreviewLoopbackHttp({
      body: Buffer.alloc(0),
      headers: [],
      method: "GET",
      owner: { id: "session-1", kind: "session" },
      pathAndQuery: "/redirect-external",
      signal: new AbortController().signal,
      target,
      targetUrl: new URL("/redirect-external", target.origin),
      viewerKey: "abcdefghijklmnopqrstuvwx",
      egress: false,
      stripAuthorization: false
    });

    assert.deepEqual(
      externalRedirect.headers.find(([name]) => name === "location"),
      ["location", `http://127.0.0.1:${externalAddress.port}/stolen`]
    );

    await externalRedirect.cancel();
    assert.equal(externalRequests, 0);
  } finally {
    await close(local);
    await close(external);
  }
});
