import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPreviewEgressPath } from "#http/routes/system/preview/egress/previewEgressTarget";

import {
  CloudPreviewRequestPolicy,
  CloudPreviewRequestRejectedError,
  isCloudPreviewRuntimeAllowed,
  sanitizeCloudPreviewRequestHeaders
} from "./cloudPreviewRequestPolicy.ts";

describe("CloudPreviewRequestPolicy", () => {
  it("resolves only the active owner-backed loopback target", async () => {
    const policy = new CloudPreviewRequestPolicy(async (owner) => ({
      networkMode: "device-direct",
      origin: "http://localhost:5173",
      port: owner.id === "session-1" ? 5173 : 5174
    }));

    const result = await policy.authorize({
      headers: [["accept", "text/html"], ["authorization", "Bearer application-token"]],
      method: "GET",
      owner: { id: "session-1", kind: "session" },
      pathAndQuery: "/dashboard?mode=compact",
      transport: "http",
      viewerId: "abcdefghijklmnopqrstuvwx"
    });

    assert.equal(result.target.origin, "http://localhost:5173");
    assert.deepEqual(result.headers, [
      ["accept", "text/html"],
      ["authorization", "Bearer application-token"]
    ]);
    assert.equal(result.pathAndQuery, "/dashboard?mode=compact");
  });

  it("rejects a target even if a compromised resolver returns a non-loopback origin", async () => {
    const policy = new CloudPreviewRequestPolicy(async () => ({
      networkMode: "deskcue-host",
      origin: "http://192.168.1.20:8080",
      port: 8080
    }));

    await assert.rejects(
      policy.authorize({
        headers: [],
        method: "GET",
        owner: { id: "session-1", kind: "session" },
        pathAndQuery: "/",
        transport: "http",
        viewerId: "abcdefghijklmnopqrstuvwx"
      }),
      (error: unknown) => error instanceof CloudPreviewRequestRejectedError &&
        error.code === "preview_unavailable"
    );
  });

  it("accepts locally configured deskcue-host mode while retaining a loopback primary target", async () => {
    const policy = new CloudPreviewRequestPolicy(async () => ({
      networkMode: "deskcue-host",
      origin: "http://localhost:5173",
      port: 5173
    }));

    const result = await policy.authorize({
      headers: [],
      method: "GET",
      owner: { id: "session-1", kind: "session" },
      pathAndQuery: "/",
      transport: "http",
      viewerId: "abcdefghijklmnopqrstuvwx"
    });
    assert.equal(result.target.networkMode, "deskcue-host");
    assert.equal(result.targetUrl.href, "http://localhost:5173/");
  });

  it("authorizes owner-scoped WS and WSS egress through the same protected resolver", async () => {
    const policy = new CloudPreviewRequestPolicy(async () => ({
      networkMode: "deskcue-host",
      origin: "http://localhost:5173",
      port: 5173
    }));
    const targets = [
      ["http://localhost:6200/socket", "ws://localhost:6200/socket"],
      ["https://localhost:6201/socket", "wss://localhost:6201/socket"],
      ["ws://localhost:6202/socket", "ws://localhost:6202/socket"],
      ["wss://localhost:6203/socket", "wss://localhost:6203/socket"]
    ] as const;
    for (const [href, expectedHref] of targets) {
      const target = new URL(href);
      const result = await policy.authorize({
        headers: [["origin", "https://preview.example"]],
        method: "GET",
        owner: { id: "session-1", kind: "session" },
        pathAndQuery: buildPreviewEgressPath("", target),
        transport: "websocket",
        viewerId: "abcdefghijklmnopqrstuvwx"
      });

      assert.equal(result.egress, true);
      assert.equal(result.targetUrl.href, expectedHref);
      assert.equal(typeof result.lookup, "function");
    }
  });

  it("rejects WebSocket URL families before an HTTP operation reaches Node transport", async () => {
    const policy = new CloudPreviewRequestPolicy(async () => ({
      networkMode: "deskcue-host",
      origin: "http://localhost:5173",
      port: 5173
    }));

    for (const href of ["ws://localhost:6202/socket", "wss://localhost:6203/socket"]) {
      await assert.rejects(policy.authorize({
        headers: [],
        method: "GET",
        owner: { id: "session-1", kind: "session" },
        pathAndQuery: buildPreviewEgressPath("", new URL(href)),
        transport: "http",
        viewerId: "abcdefghijklmnopqrstuvwx"
      }), (error: unknown) => error instanceof CloudPreviewRequestRejectedError &&
        error.code === "invalid_request");
    }
  });

  it("rejects credentials and local Preview control/egress paths", async () => {
    const policy = new CloudPreviewRequestPolicy(async () => ({
      networkMode: "device-direct",
      origin: "http://localhost:5173",
      port: 5173
    }));
    const blocked = [
      "/?access_token=secret",
      "/__deskcue_egress__/encoded/path",
      "/__deskcue_ticket__/secret/",
      "//example.com/path",
      "/path#fragment"
    ];

    for (const pathAndQuery of blocked) {
      await assert.rejects(policy.authorize({
        headers: [],
        method: "GET",
        owner: { id: "session-1", kind: "session" },
        pathAndQuery,
        transport: "http",
        viewerId: "abcdefghijklmnopqrstuvwx"
      }), CloudPreviewRequestRejectedError);
    }
  });

  it("requires both local consent and negotiated capability", () => {
    assert.equal(isCloudPreviewRuntimeAllowed({
      allowRemotePreview: true,
      negotiatedCapabilities: ["deskcue.preview"]
    }), true);
    assert.equal(isCloudPreviewRuntimeAllowed({
      allowRemotePreview: false,
      negotiatedCapabilities: ["deskcue.preview"]
    }), false);
    assert.equal(isCloudPreviewRuntimeAllowed({
      allowRemotePreview: true,
      negotiatedCapabilities: ["deskcue.read"]
    }), false);
  });
});

describe("sanitizeCloudPreviewRequestHeaders", () => {
  it("keeps application credentials after the Cloud boundary stripped service credentials", () => {
    assert.deepEqual(sanitizeCloudPreviewRequestHeaders([
      ["Accept", "text/html"],
      ["Cookie", "app_session=opaque"],
      ["Authorization", "Basic application-credential"],
      ["Origin", "https://app.deskcue.io"],
      ["If-None-Match", "etag"]
    ]), [
      ["accept", "text/html"],
      ["cookie", "app_session=opaque"],
      ["authorization", "Basic application-credential"],
      ["origin", "https://app.deskcue.io"],
      ["if-none-match", "etag"]
    ]);
  });
});
