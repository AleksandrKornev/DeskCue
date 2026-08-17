import express from "express";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import type { Server } from "node:http";
import test from "node:test";

import { createAccessTokenMiddleware, isAllowedOrigin } from "./accessControl.ts";
import {
  createCloudInternalRequestHeaders,
  isAuthorizedCloudInternalRequest,
  isAuthorizedCloudInternalWebSocketRequest
} from "./cloudInternalRequestAuth.ts";
import { findLanIPv4Address } from "../../networkHosts.ts";

test("allows loopback origins and configured LAN origins only", () => {
  assert.equal(isAllowedOrigin(undefined, [], true), true);
  assert.equal(isAllowedOrigin("http://localhost:4173", [], true), true);
  assert.equal(isAllowedOrigin("http://127.0.0.1:4173", [], true), true);
  assert.equal(isAllowedOrigin("http://localhost:3000", [], true), false);
  assert.equal(isAllowedOrigin("http://127.0.0.1:8080", [], true), false);
  assert.equal(isAllowedOrigin("ftp://localhost:4173", [], true), false);
  assert.equal(isAllowedOrigin("http://localhost:4173/path", [], true), false);
  assert.equal(isAllowedOrigin("http://user:password@localhost:4173", [], true), false);
  assert.equal(isAllowedOrigin("http://localhost:4173?unexpected=true", [], true), false);
  assert.equal(isAllowedOrigin("http://deskcue-lan.local:4173", ["http://deskcue-lan.local:4173"], true), true);
  assert.equal(isAllowedOrigin("http://other-lan-host.local:4173", ["http://deskcue-lan.local:4173"], true), false);
});

test("allows local interface origins on production and dev web ports", (context) => {
  const lanAddress = findLanIPv4Address();
  if (!lanAddress) {
    context.skip("No LAN IPv4 address on this machine");
    return;
  }

  assert.equal(isAllowedOrigin(`http://${lanAddress}:4100`, [], true), true);
  assert.equal(isAllowedOrigin(`http://${lanAddress}:4173`, [], true), true);
  assert.equal(isAllowedOrigin(`http://${lanAddress}:4101`, [], true), false);
});

test("allows any origin when auth is disabled", () => {
  assert.equal(isAllowedOrigin("http://deskcue-lan.local:4173", [], false), true);
  assert.equal(isAllowedOrigin("http://blocked.example", ["http://allowed.example"], false), true);
});

function requestStatus(baseUrl: string, path: string, headers: Record<string, string>) {
  const url = new URL(path, baseUrl);

  return new Promise<number>((resolve, reject) => {
    const clientRequest = request(url, {
      headers,
      method: "GET"
    }, (response) => {
      response.resume();
      response.on("end", () => {
        resolve(response.statusCode ?? 0);
      });
    });
    clientRequest.on("error", reject);
    clientRequest.end();
  });
}

function closeServer(server: Server) {
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

function withServer(app: express.Express, callback: (baseUrl: string) => Promise<void>) {
  const server = createServer(app);

  return new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", async () => {
      try {
        const address = server.address();
        assert(address && typeof address === "object");
        await callback(`http://127.0.0.1:${address.port}`);
        closeServer(server).then(resolve, reject);
      } catch (error) {
        closeServer(server).then(() => reject(error), reject);
      }
    });
  });
}

test("access token middleware protects API routes when a token is configured", async () => {
  const app = express();
  app.use(createAccessTokenMiddleware("secret-token"));
  app.get("/api/protected", (_request, response) => {
    response.json({
      ok: true
    });
  });
  app.post("/api/access/reset", (_request, response) => {
    response.json({
      ok: true
    });
  });

  await withServer(app, async (baseUrl) => {
    const lanHeaders = {
      "x-forwarded-for": "203.0.113.70"
    };
    const localWithoutBrowserContext = await fetch(`${baseUrl}/api/protected`);
    const localSameOrigin = await fetch(`${baseUrl}/api/protected`, {
      headers: {
        origin: baseUrl
      }
    });
    const localSameOriginWithoutOriginHeader = await fetch(`${baseUrl}/api/protected`, {
      headers: {
        "sec-fetch-site": "same-origin"
      }
    });
    const localOtherOrigin = await fetch(`${baseUrl}/api/protected`, {
      headers: {
        origin: "http://127.0.0.1:3000"
      }
    });
    const proxiedExternalHostStatus = await requestStatus(baseUrl, "/api/protected", {
      host: "203.0.113.23:4173"
    });
    const proxiedExternalOrigin = await fetch(`${baseUrl}/api/protected`, {
      headers: {
        origin: "http://203.0.113.23:4173"
      }
    });
    const unauthorized = await fetch(`${baseUrl}/api/protected`, {
      headers: lanHeaders
    });
    const authorized = await fetch(`${baseUrl}/api/protected`, {
      headers: {
        ...lanHeaders,
        authorization: "Bearer secret-token"
      }
    });
    const cookieAuthorized = await fetch(`${baseUrl}/api/protected`, {
      headers: {
        ...lanHeaders,
        cookie: "deskcue_access=secret-token"
      }
    });
    const unauthorizedReset = await fetch(`${baseUrl}/api/access/reset`, {
      headers: lanHeaders,
      method: "POST"
    });

    assert.equal(localWithoutBrowserContext.status, 401);
    assert.equal(localSameOrigin.status, 200);
    assert.equal(localSameOriginWithoutOriginHeader.status, 200);
    assert.equal(localOtherOrigin.status, 401);
    assert.equal(proxiedExternalHostStatus, 401);
    assert.equal(proxiedExternalOrigin.status, 401);
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(await unauthorized.json(), {
      error: "DeskCue access token is required."
    });
    assert.equal(authorized.status, 200);
    assert.deepEqual(await authorized.json(), {
      ok: true
    });
    assert.equal(cookieAuthorized.status, 200);
    assert.deepEqual(await cookieAuthorized.json(), {
      ok: true
    });
    assert.equal(unauthorizedReset.status, 401);
  });
});

test("forwarded headers do not override the socket and exact-origin trust boundary", async () => {
  const app = express();
  app.use(createAccessTokenMiddleware("secret-token"));
  app.get("/api/protected", (_request, response) => {
    response.json({ ok: true });
  });

  await withServer(app, async (baseUrl) => {
    const url = new URL(baseUrl);
    const externalOriginResponse = await fetch(`${baseUrl}/api/protected`, {
      headers: {
        host: `203.0.113.20:${url.port}`,
        origin: `http://203.0.113.20:${url.port}`,
        "x-forwarded-for": "127.0.0.1"
      }
    });
    const localOriginResponse = await fetch(`${baseUrl}/api/protected`, {
      headers: {
        origin: baseUrl,
        "x-forwarded-for": "203.0.113.20"
      }
    });

    assert.equal(externalOriginResponse.status, 401);
    assert.equal(localOriginResponse.status, 200);
  });
});

test("access token middleware keeps pairing routes open and sensitive routes protected", async () => {
  const app = express();
  app.use(createAccessTokenMiddleware("secret-token"));
  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true
    });
  });
  app.get("/api/access/link", (_request, response) => {
    response.json({
      ok: true
    });
  });
  app.get("/api/access/link/:pairCode/status", (_request, response) => {
    response.json({
      ok: true
    });
  });
  app.post("/api/access/pair", (_request, response) => {
    response.json({
      ok: true
    });
  });
  app.post("/api/sessions/:sessionId/preview", (_request, response) => {
    response.json({
      ok: true
    });
  });
  app.get("/api/assets/file", (_request, response) => {
    response.json({
      ok: true
    });
  });
  app.get("/api/assets/ticket/:ticket", (_request, response) => {
    response.json({
      ok: true
    });
  });
  app.get("/api/push/status", (_request, response) => {
    response.json({
      ok: true
    });
  });

  await withServer(app, async (baseUrl) => {
    const lanHeaders = {
      "x-forwarded-for": "203.0.113.70"
    };
    const health = await fetch(`${baseUrl}/api/health`);
    const link = await fetch(`${baseUrl}/api/access/link`);
    const linkStatus = await fetch(`${baseUrl}/api/access/link/code-1/status`);
    const pair = await fetch(`${baseUrl}/api/access/pair`, {
      method: "POST"
    });
    const preview = await fetch(`${baseUrl}/api/sessions/session-1/preview`, {
      headers: lanHeaders,
      method: "POST"
    });
    const asset = await fetch(`${baseUrl}/api/assets/file`, {
      headers: lanHeaders
    });
    const assetTicket = await fetch(`${baseUrl}/api/assets/ticket/ticket-1`);
    const push = await fetch(`${baseUrl}/api/push/status`, {
      headers: lanHeaders
    });

    assert.equal(health.status, 200);
    assert.equal(link.status, 200);
    assert.equal(linkStatus.status, 200);
    assert.equal(pair.status, 200);
    assert.equal(preview.status, 401);
    assert.equal(asset.status, 401);
    assert.equal(assetTicket.status, 200);
    assert.equal(push.status, 401);
  });
});

test("access token middleware keeps web app shell routes public for pairing", async () => {
  const app = express();
  app.use(createAccessTokenMiddleware("secret-token"));
  app.get("/", (_request, response) => {
    response.type("html").send("web shell");
  });
  app.get("/pair/:pairCode", (_request, response) => {
    response.type("html").send("pair shell");
  });
  app.get("/ws", (_request, response) => {
    response.json({
      ok: true
    });
  });
  app.get("/api/protected", (_request, response) => {
    response.json({
      ok: true
    });
  });

  await withServer(app, async (baseUrl) => {
    const lanHeaders = {
      "x-forwarded-for": "203.0.113.70"
    };
    const root = await fetch(`${baseUrl}/`, {
      headers: lanHeaders
    });
    const pair = await fetch(`${baseUrl}/pair/code-1`, {
      headers: lanHeaders
    });
    const ws = await fetch(`${baseUrl}/ws`, {
      headers: lanHeaders
    });
    const api = await fetch(`${baseUrl}/api/protected`, {
      headers: lanHeaders
    });

    assert.equal(root.status, 200);
    assert.equal(pair.status, 200);
    assert.equal(ws.status, 401);
    assert.equal(api.status, 401);
  });
});

test("access token middleware allows API routes when auth is disabled", async () => {
  const app = express();
  app.use(createAccessTokenMiddleware("secret-token", false));
  app.get("/api/protected", (_request, response) => {
    response.json({
      ok: true
    });
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/protected`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true
    });
  });
});

test("process-local Cloud authorization bypasses device auth only for the actual loopback peer", async () => {
  const app = express();
  app.use(createAccessTokenMiddleware("device-token"));
  app.get("/api/overview", (_request, response) => response.json({ ok: true }));

  await withServer(app, async (baseUrl) => {
    const authorized = await fetch(`${baseUrl}/api/overview`, {
      headers: createCloudInternalRequestHeaders()
    });
    assert.equal(authorized.status, 200);
  });

  const headers = createCloudInternalRequestHeaders();
  const cloudRequest = (method: string, path: string) => ({
    method,
    path,
    headers,
    socket: { remoteAddress: "127.0.0.1" }
  }) as unknown as express.Request;
  const externalPeerRequest = {
    headers,
    socket: { remoteAddress: "203.0.113.70" }
  } as unknown as express.Request;
  assert.equal(isAuthorizedCloudInternalRequest(externalPeerRequest), false);
  const forgedTokenRequest = {
    headers: { authorization: "DeskCueCloudInternal forged" },
    socket: { remoteAddress: "127.0.0.1" }
  } as unknown as express.Request;
  assert.equal(isAuthorizedCloudInternalRequest(forgedTokenRequest), false);
  for (const [method, path] of [
    ["GET", "/api/assets/ticket/ticket-1"],
    ["GET", "/api/overview"],
    ["GET", "/api/workspaces/workspace-1/files"],
    ["GET", "/api/agents/sessions/codex%3Asession-1/transcript-view"],
    ["GET", "/api/agents/sessions/codex%3Asession-1/changes/group-1"],
    ["POST", "/api/assets/ticket"],
    ["POST", "/api/agents/sessions/codex%3Asession-1/reviewed"],
    ["POST", "/api/agents/sessions/codex%3Asession-1/changes/group-1"],
    ["POST", "/api/sessions/session-1/refresh-git"],
    ["POST", "/api/sessions/session-1/stop"]
  ]) {
    assert.equal(isAuthorizedCloudInternalRequest(cloudRequest(method, path)), true, path);
  }
  for (const [method, path] of [
    ["GET", "/api/assets/ticket"],
    ["POST", "/api/assets/ticket/ticket-1"],
    ["GET", "/api/workspaces/workspace-1/secrets"],
    ["POST", "/api/sessions/session-1/prompt"],
    ["POST", "/api/sessions/session-1/refresh-git/private"],
    ["POST", "/api/agents/sessions/codex%3Asession-1/reviewed/private"],
    ["DELETE", "/api/agents/sessions/codex%3Asession-1/reviewed"]
  ]) {
    assert.equal(isAuthorizedCloudInternalRequest(cloudRequest(method, path)), false, path);
  }
  const internalWebSocketRequest = {
    url: "/ws?protocolVersion=1",
    headers,
    socket: { remoteAddress: "127.0.0.1" }
  };
  assert.equal(isAuthorizedCloudInternalWebSocketRequest(internalWebSocketRequest as never), true);
  assert.equal(isAuthorizedCloudInternalWebSocketRequest({
    ...internalWebSocketRequest,
    url: "/api/sessions"
  } as never), false);
  assert.equal(isAuthorizedCloudInternalWebSocketRequest({
    ...internalWebSocketRequest,
    socket: { remoteAddress: "203.0.113.70" }
  } as never), false);
});
