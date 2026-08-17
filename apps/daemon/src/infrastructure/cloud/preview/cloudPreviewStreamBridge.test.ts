import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import {
  CLOUD_PREVIEW_MAX_CREDIT_BYTES,
  CLOUD_PREVIEW_MAX_WS_STREAMS
} from "@deskcue/protocol";
import type { CloudPreviewClientFrame, CloudPreviewServerFrame } from "@deskcue/protocol";

import { CloudPreviewRequestPolicy } from "./cloudPreviewRequestPolicy.ts";
import { CloudPreviewStreamBridge } from "./cloudPreviewStreamBridge.ts";
import type { CloudPreviewWebSocketEvents } from "./cloudPreviewStreamBridge.ts";

const emptySha256 = createHash("sha256").update("").digest("hex");

function neverEndingBody(): AsyncIterable<Buffer> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise<IteratorResult<Buffer>>(() => {}),
        return: async () => ({ done: true, value: undefined })
      };
    }
  };
}

async function* streamBody(...chunks: Buffer[]) {
  yield* chunks;
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for Preview stream state.");
}

function createPolicy() {
  return new CloudPreviewRequestPolicy(async () => ({
    networkMode: "device-direct",
    origin: "http://localhost:5173",
    port: 5173
  }));
}

function createBridge(
  sent: CloudPreviewClientFrame[],
  executeHttp: ConstructorParameters<typeof CloudPreviewStreamBridge>[0]["executeHttp"],
  options: Pick<
    ConstructorParameters<typeof CloudPreviewStreamBridge>[0],
    "responseIdleTimeoutMs"
  > = {}
) {
  return new CloudPreviewStreamBridge({
    executeHttp,
    ...options,
    policy: createPolicy(),
    sendFrame(frame) { sent.push(frame); return true; }
  });
}

function httpChunk(streamId: string, body: Buffer, sequence = 0): CloudPreviewServerFrame {
  return {
    type: "preview.http.request.chunk",
    protocolVersion: 1,
    streamId,
    sequence,
    data: body.toString("base64")
  };
}

function wsMessageChunk(streamId: string, messageId: string, body: Buffer): CloudPreviewServerFrame {
  return {
    type: "preview.ws.message.chunk",
    protocolVersion: 1,
    streamId,
    direction: "client",
    messageId,
    sequence: 0,
    data: body.toString("base64")
  };
}

function now() {
  return new Date().toISOString();
}

function httpStart(
  streamId: string,
  deadlineAt = new Date(Date.now() + 60_000).toISOString(),
  contentLength = 0
): CloudPreviewServerFrame {
  return {
    type: "preview.http.request.start",
    protocolVersion: 1,
    streamId,
    owner: { kind: "session", ownerId: "session-1" },
    viewerId: "abcdefghijklmnopqrstuvwx",
    method: "GET",
    path: "/",
    headers: [["accept", "text/html"]],
    contentLength,
    deadlineAt,
    sentAt: now()
  };
}

function httpEnd(
  streamId: string,
  body = Buffer.alloc(0),
  chunkCount = body.byteLength === 0 ? 0 : 1
): CloudPreviewServerFrame {
  return {
    type: "preview.http.request.end",
    protocolVersion: 1,
    streamId,
    bodyBytes: body.byteLength,
    chunkCount,
    bodySha256: createHash("sha256").update(body).digest("hex"),
    sentAt: now()
  };
}

function responseCredit(streamId: string, creditBytes: number): CloudPreviewServerFrame {
  return {
    type: "preview.flow.credit",
    protocolVersion: 1,
    streamId,
    direction: "http.response",
    creditBytes,
    sentAt: now()
  };
}

describe("CloudPreviewStreamBridge HTTP", () => {
  it("requires response credit before sending bounded body chunks", async () => {
    const sent: CloudPreviewClientFrame[] = [];
    const responseBody = Buffer.alloc(10 * 1024, 7);
    const bridge = createBridge(sent, async () => ({
      body: streamBody(responseBody),
      cancel() {},
      contentLength: responseBody.byteLength,
      headers: [["content-type", "application/octet-stream"]],
      status: 200
    }));
    bridge.activateEpoch(1);

    assert.equal(await bridge.handleFrame(httpStart("stream_http_01"), 1), true);
    assert.equal(sent.at(-1)?.type, "preview.flow.credit");
    assert.equal(await bridge.handleFrame(httpEnd("stream_http_01"), 1), true);
    assert.equal(sent.at(-1)?.type, "preview.http.response.start");
    assert.equal(sent.some((frame) => frame.type === "preview.http.response.chunk"), false);

    assert.equal(await bridge.handleFrame(responseCredit("stream_http_01", 4 * 1024), 1), true);
    const firstChunk = sent.find((frame) => frame.type === "preview.http.response.chunk");
    assert.equal(firstChunk?.type === "preview.http.response.chunk"
      ? Buffer.from(firstChunk.data, "base64").byteLength
      : 0, 4 * 1024);
    assert.equal(sent.some((frame) => frame.type === "preview.http.response.end"), false);

    assert.equal(await bridge.handleFrame(responseCredit("stream_http_01", 6 * 1024), 1), true);
    assert.equal(sent.at(-1)?.type, "preview.http.response.end");
    const end = sent.at(-1);
    assert.equal(end?.type === "preview.http.response.end" ? end.bodyBytes : null, responseBody.byteLength);
    assert.equal(
      end?.type === "preview.http.response.end" ? end.bodySha256 : null,
      createHash("sha256").update(responseBody).digest("hex")
    );
  });

  it("streams request chunks into the shared proxy and replenishes credit on consumption", async () => {
    const sent: CloudPreviewClientFrame[] = [];
    let requestBody: AsyncIterator<Buffer> | null = null;
    const bridge = createBridge(sent, async (request) => {
      requestBody = request.body[Symbol.asyncIterator]();
      return {
        body: streamBody(),
        cancel() {},
        contentLength: 0,
        headers: [],
        status: 204
      };
    });
    const body = Buffer.from("streamed request");
    bridge.activateEpoch(1);
    await bridge.handleFrame(httpStart("stream_http_upload", undefined, body.byteLength), 1);
    const creditsBeforeChunk = sent.filter((frame) => frame.type === "preview.flow.credit").length;
    await bridge.handleFrame(httpChunk("stream_http_upload", body), 1);
    assert.equal(sent.filter((frame) => frame.type === "preview.flow.credit").length, creditsBeforeChunk);
    const requestBodyIterator = requestBody as AsyncIterator<Buffer> | null;
    assert.ok(requestBodyIterator);
    const consumed = await requestBodyIterator.next();
    assert.equal(consumed.value?.toString(), body.toString());
    assert.equal(sent.filter((frame) => frame.type === "preview.flow.credit").length, creditsBeforeChunk + 1);
    await bridge.handleFrame(httpEnd("stream_http_upload", body), 1);
  });

  it("ends a HEAD or zero-body response without waiting for credit or pulling upstream", async () => {
    const sent: CloudPreviewClientFrame[] = [];
    let bodyPulled = false;
    const bridge = createBridge(sent, async () => ({
      body: (async function* () {
        bodyPulled = true;
        yield Buffer.from("must-not-be-read");
      })(),
      cancel() {},
      contentLength: 0,
      headers: [],
      status: 204
    }));
    bridge.activateEpoch(1);
    await bridge.handleFrame(httpStart("stream_http_empty"), 1);
    assert.equal(await bridge.handleFrame(httpEnd("stream_http_empty"), 1), true);
    assert.equal(bodyPulled, false);
    const end = sent.at(-1);
    assert.equal(end?.type, "preview.http.response.end");
    assert.equal(end?.type === "preview.http.response.end" ? end.bodyBytes : null, 0);
    assert.equal(end?.type === "preview.http.response.end" ? end.bodySha256 : null, emptySha256);
  });

  it("cancels an executing request and ignores stale connection epochs", async () => {
    const sent: CloudPreviewClientFrame[] = [];
    let executionSignal: AbortSignal | undefined;
    let releaseExecution: (() => void) | undefined;
    const bridge = createBridge(sent, async ({ signal }) => {
      executionSignal = signal;
      await new Promise<void>((resolve) => { releaseExecution = resolve; });
      return { body: streamBody(), cancel() {}, contentLength: 0, headers: [], status: 204 };
    });
    bridge.activateEpoch(4);
    await bridge.handleFrame(httpStart("stream_http_02"), 4);
    const finishing = bridge.handleFrame(httpEnd("stream_http_02"), 4);
    await Promise.resolve();
    assert.equal(await bridge.handleFrame({
      type: "preview.http.request.cancel",
      protocolVersion: 1,
      streamId: "stream_http_02",
      reason: "browser_closed",
      sentAt: now()
    }, 4), true);
    assert.equal(executionSignal?.aborted, true);
    releaseExecution?.();
    assert.equal(await finishing, false);

    assert.equal(bridge.activateEpoch(5), true);
    assert.equal(await bridge.handleFrame(httpStart("stream_stale_01"), 4), false);
    assert.equal(await bridge.handleFrame(httpStart("stream_fresh_01"), 5), true);
    assert.equal(bridge.activateEpoch(6), true);
    bridge.close();
    assert.equal(await bridge.handleFrame(httpStart("stream_closed_01"), 6), false);
  });

  it("fails a stream that attempts to accumulate an unbounded credit window", async () => {
    const sent: CloudPreviewClientFrame[] = [];
    const bridge = createBridge(sent, async () => ({
      body: streamBody(Buffer.from("ok")),
      cancel() {},
      contentLength: 2,
      headers: [],
      status: 200
    }));
    bridge.activateEpoch(1);
    await bridge.handleFrame(httpStart("stream_http_03"), 1);
    assert.equal(await bridge.handleFrame(responseCredit("stream_http_03", CLOUD_PREVIEW_MAX_CREDIT_BYTES), 1), true);
    assert.equal(await bridge.handleFrame(responseCredit("stream_http_03", 1), 1), true);
    assert.equal(sent.at(-1)?.type, "preview.http.response.error");
    assert.equal(await bridge.handleFrame(httpEnd("stream_http_03"), 1), false);
  });

  it("emits the first response chunk before upstream completion and does not pull ahead of credit", async () => {
    const sent: CloudPreviewClientFrame[] = [];
    const first = Buffer.from("first");
    const second = Buffer.from("second");
    let secondPullStarted = false;
    let releaseSecond!: () => void;
    const secondReady = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const bridge = createBridge(sent, async () => ({
      body: (async function* () {
        yield first;
        secondPullStarted = true;
        await secondReady;
        yield second;
      })(),
      cancel() {},
      contentLength: first.byteLength + second.byteLength,
      headers: [["content-type", "text/event-stream"]],
      status: 200
    }));
    bridge.activateEpoch(1);
    await bridge.handleFrame(httpStart("stream_http_streaming"), 1);
    await bridge.handleFrame(httpEnd("stream_http_streaming"), 1);

    await bridge.handleFrame(responseCredit("stream_http_streaming", first.byteLength), 1);
    const firstChunk = sent.find((frame) => frame.type === "preview.http.response.chunk");
    assert.equal(
      firstChunk?.type === "preview.http.response.chunk"
        ? Buffer.from(firstChunk.data, "base64").toString()
        : null,
      "first"
    );
    assert.equal(secondPullStarted, false);
    assert.equal(sent.some((frame) => frame.type === "preview.http.response.end"), false);

    const remaining = bridge.handleFrame(
      responseCredit("stream_http_streaming", second.byteLength),
      1
    );
    await waitFor(() => secondPullStarted);
    assert.equal(sent.filter((frame) => frame.type === "preview.http.response.chunk").length, 1);
    releaseSecond();
    assert.equal(await remaining, true);
    assert.equal(sent.at(-1)?.type, "preview.http.response.end");
  });

  it("aborts an in-flight upstream response reader when Cloud cancels", async () => {
    const sent: CloudPreviewClientFrame[] = [];
    let responseSignal: AbortSignal | undefined;
    let upstreamCancelled = false;
    let waitingForNextChunk = false;
    const bridge = createBridge(sent, async ({ signal }) => {
      responseSignal = signal;
      return {
        body: (async function* () {
          yield Buffer.from("first");
          waitingForNextChunk = true;
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          });
        })(),
        cancel() { upstreamCancelled = true; },
        contentLength: null,
        headers: [],
        status: 200
      };
    });
    bridge.activateEpoch(1);
    await bridge.handleFrame(httpStart("stream_http_cancel"), 1);
    await bridge.handleFrame(httpEnd("stream_http_cancel"), 1);
    const pumping = bridge.handleFrame(responseCredit("stream_http_cancel", 1024), 1);
    await waitFor(() => waitingForNextChunk);
    assert.ok(sent.some((frame) => frame.type === "preview.http.response.chunk"));

    assert.equal(await bridge.handleFrame({
      type: "preview.http.request.cancel",
      protocolVersion: 1,
      streamId: "stream_http_cancel",
      reason: "browser_closed",
      sentAt: now()
    }, 1), true);
    assert.equal(responseSignal?.aborted, true);
    assert.equal(upstreamCancelled, true);
    assert.equal(await pumping, false);
    assert.equal(sent.some((frame) => frame.type === "preview.http.response.end"), false);
  });

  it("cancels response streams on deadline, epoch replacement, and shutdown", async () => {
    const sent: CloudPreviewClientFrame[] = [];
    let cancelled = 0;
    const bridge = createBridge(sent, async () => ({
      body: neverEndingBody(),
      cancel() { cancelled += 1; },
      contentLength: null,
      headers: [],
      status: 200
    }), { responseIdleTimeoutMs: 25 });
    bridge.activateEpoch(1);
    await bridge.handleFrame(
      httpStart("stream_http_deadline", new Date(Date.now() + 50).toISOString()),
      1
    );
    await bridge.handleFrame(httpEnd("stream_http_deadline"), 1);
    void bridge.handleFrame(responseCredit("stream_http_deadline", 1024), 1);
    await waitFor(() => cancelled === 1);
    const deadlineError = sent.find((frame) =>
      frame.type === "preview.http.response.error" && frame.streamId === "stream_http_deadline"
    );
    assert.equal(
      deadlineError?.type === "preview.http.response.error" ? deadlineError.code : null,
      "deadline_exceeded"
    );

    await bridge.handleFrame(httpStart("stream_http_epoch"), 1);
    await bridge.handleFrame(httpEnd("stream_http_epoch"), 1);
    assert.equal(bridge.activateEpoch(2), true);
    assert.equal(cancelled, 2);

    await bridge.handleFrame(httpStart("stream_http_shutdown"), 2);
    await bridge.handleFrame(httpEnd("stream_http_shutdown"), 2);
    bridge.close();
    assert.equal(cancelled, 3);
  });

  it("uses the request deadline only until response start and keeps active SSE alive", async () => {
    const sent: CloudPreviewClientFrame[] = [];
    const bridge = createBridge(sent, async () => ({
      body: (async function* () {
        yield Buffer.from("event: one\n\n");
        await new Promise((resolve) => setTimeout(resolve, 40));
        yield Buffer.from("event: two\n\n");
      })(),
      cancel() {},
      contentLength: null,
      headers: [["content-type", "text/event-stream"]],
      status: 200
    }), { responseIdleTimeoutMs: 100 });
    bridge.activateEpoch(1);
    await bridge.handleFrame(
      httpStart("stream_http_sse", new Date(Date.now() + 20).toISOString()),
      1
    );
    await bridge.handleFrame(httpEnd("stream_http_sse"), 1);
    await bridge.handleFrame(responseCredit("stream_http_sse", 1024), 1);
    await waitFor(() => sent.some((frame) =>
      frame.type === "preview.http.response.end" && frame.streamId === "stream_http_sse"
    ));
    assert.equal(sent.some((frame) =>
      frame.type === "preview.http.response.error" && frame.streamId === "stream_http_sse"
    ), false);
  });

  it("keeps an active request upload alive past its initial deadline", async () => {
    const sent: CloudPreviewClientFrame[] = [];
    const received: Buffer[] = [];
    const bridge = createBridge(sent, async ({ body }) => {
      for await (const chunk of body) received.push(chunk);
      return {
        body: streamBody(),
        cancel() {},
        contentLength: 0,
        headers: [],
        status: 204
      };
    }, { responseIdleTimeoutMs: 40 });
    const body = Buffer.from("abc");
    bridge.activateEpoch(1);
    await bridge.handleFrame(
      httpStart("stream_http_active_upload", new Date(Date.now() + 20).toISOString(), body.byteLength),
      1
    );
    for (let sequence = 0; sequence < body.byteLength; sequence += 1) {
      await new Promise((resolve) => setTimeout(resolve, 15));
      await bridge.handleFrame(
        httpChunk("stream_http_active_upload", body.subarray(sequence, sequence + 1), sequence),
        1
      );
    }
    await bridge.handleFrame(httpEnd("stream_http_active_upload", body, body.byteLength), 1);
    await waitFor(() => sent.some((frame) =>
      frame.type === "preview.http.response.end" && frame.streamId === "stream_http_active_upload"
    ));
    assert.equal(Buffer.concat(received).toString(), body.toString());
    assert.equal(sent.some((frame) =>
      frame.type === "preview.http.response.error" && frame.streamId === "stream_http_active_upload"
    ), false);
  });

  it("cancels a request upload that becomes idle", async () => {
    const sent: CloudPreviewClientFrame[] = [];
    const bridge = createBridge(sent, async ({ body }) => {
      for await (const _chunk of body) {
        // Consume request credit while waiting for the declared remainder.
      }
      return {
        body: streamBody(),
        cancel() {},
        contentLength: 0,
        headers: [],
        status: 204
      };
    }, { responseIdleTimeoutMs: 25 });
    bridge.activateEpoch(1);
    await bridge.handleFrame(
      httpStart("stream_http_idle_upload", new Date(Date.now() + 20).toISOString(), 2),
      1
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    await bridge.handleFrame(httpChunk("stream_http_idle_upload", Buffer.from("a")), 1);
    await waitFor(() => sent.some((frame) =>
      frame.type === "preview.http.response.error" &&
      frame.streamId === "stream_http_idle_upload" &&
      frame.code === "deadline_exceeded"
    ));
  });
});

function wsOpen(streamId: string): CloudPreviewServerFrame {
  return {
    type: "preview.ws.open",
    protocolVersion: 1,
    streamId,
    owner: { kind: "session", ownerId: "session-1" },
    viewerId: "abcdefghijklmnopqrstuvwx",
    path: "/hmr",
    headers: [],
    protocols: ["vite-hmr"],
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    sentAt: now()
  };
}

function wsMessageStart(
  streamId: string,
  messageId: string,
  body: Buffer,
  binary: boolean
): CloudPreviewServerFrame {
  return {
    type: "preview.ws.message.start",
    protocolVersion: 1,
    streamId,
    direction: "client",
    messageId,
    binary,
    bodyBytes: body.byteLength,
    chunkCount: 1,
    bodySha256: createHash("sha256").update(body).digest("hex"),
    sentAt: now()
  };
}

function wsMessageEnd(streamId: string, messageId: string, body: Buffer): CloudPreviewServerFrame {
  return {
    type: "preview.ws.message.end",
    protocolVersion: 1,
    streamId,
    direction: "client",
    messageId,
    bodySha256: createHash("sha256").update(body).digest("hex"),
    sentAt: now()
  };
}

describe("CloudPreviewStreamBridge WebSocket", () => {
  it("allows 24 concurrent streams while keeping the per-machine boundary bounded", async () => {
    const sent: CloudPreviewClientFrame[] = [];
    const bridge = new CloudPreviewStreamBridge({
      executeHttp: async () => ({
        body: streamBody(),
        cancel() {},
        contentLength: 0,
        headers: [],
        status: 204
      }),
      openWebSocket: async () => ({
        close() {},
        headers: [],
        protocol: null,
        send() {}
      }),
      policy: createPolicy(),
      sendFrame(frame) { sent.push(frame); return true; }
    });
    bridge.activateEpoch(1);

    assert.equal(CLOUD_PREVIEW_MAX_WS_STREAMS, 24);
    for (let index = 0; index < CLOUD_PREVIEW_MAX_WS_STREAMS; index += 1) {
      assert.equal(
        await bridge.handleFrame(wsOpen(`stream_ws_${index.toString().padStart(2, "0")}`), 1),
        true
      );
    }

    const overflowStreamId = "stream_ws_overflow";
    assert.equal(await bridge.handleFrame(wsOpen(overflowStreamId), 1), true);
    assert.equal(
      sent.filter((frame) => frame.type === "preview.ws.opened").length,
      CLOUD_PREVIEW_MAX_WS_STREAMS
    );
    assert.ok(sent.some((frame) =>
      frame.type === "preview.ws.close" &&
      frame.streamId === overflowStreamId &&
      frame.code === 1013 &&
      frame.reason === "preview_unavailable"
    ));

    bridge.close();
  });

  it("gates both WebSocket directions with credit and preserves binary messages", async () => {
    const sent: CloudPreviewClientFrame[] = [];
    let events: CloudPreviewWebSocketEvents | undefined;
    const received: Array<{ binary: boolean; body: Buffer }> = [];
    const bridge = new CloudPreviewStreamBridge({
      executeHttp: async () => ({
        body: streamBody(),
        cancel() {},
        contentLength: 0,
        headers: [],
        status: 204
      }),
      openWebSocket: async (_request, nextEvents) => {
        events = nextEvents;
        return {
          close() {},
          headers: [],
          protocol: "vite-hmr",
          send(body, binary) { received.push({ binary, body }); }
        };
      },
      policy: createPolicy(),
      sendFrame(frame) { sent.push(frame); return true; }
    });
    bridge.activateEpoch(1);
    assert.equal(await bridge.handleFrame(wsOpen("stream_ws_01"), 1), true);
    assert.ok(sent.some((frame) => frame.type === "preview.ws.opened"));
    assert.ok(sent.some((frame) => frame.type === "preview.flow.credit" && frame.direction === "ws.client"));

    const clientBody = Buffer.from("client-message");
    const messageId = "preview_client_message_01";
    await bridge.handleFrame(wsMessageStart("stream_ws_01", messageId, clientBody, true), 1);
    await bridge.handleFrame(wsMessageChunk("stream_ws_01", messageId, clientBody), 1);
    await bridge.handleFrame(wsMessageEnd("stream_ws_01", messageId, clientBody), 1);
    assert.equal(received[0]?.binary, true);
    assert.deepEqual(received[0]?.body, clientBody);

    events?.onMessage(Buffer.from("server-message"), false);
    assert.equal(sent.some((frame) =>
      frame.type === "preview.ws.message.start" && frame.direction === "server"
    ), false);
    assert.equal(sent.some((frame) => frame.type === "preview.ws.message.chunk" && frame.direction === "server"), false);
    await bridge.handleFrame({
      type: "preview.flow.credit",
      protocolVersion: 1,
      streamId: "stream_ws_01",
      direction: "ws.server",
      creditBytes: 1,
      sentAt: now()
    }, 1);
    assert.equal(sent.some((frame) =>
      frame.type === "preview.ws.message.start" && frame.direction === "server"
    ), false);
    assert.equal(sent.some((frame) => frame.type === "preview.ws.message.chunk" && frame.direction === "server"), false);
    await bridge.handleFrame({
      type: "preview.flow.credit",
      protocolVersion: 1,
      streamId: "stream_ws_01",
      direction: "ws.server",
      creditBytes: Buffer.byteLength("server-message") - 1,
      sentAt: now()
    }, 1);
    assert.ok(sent.some((frame) => frame.type === "preview.ws.message.chunk" && frame.direction === "server"));
    assert.ok(sent.some((frame) => frame.type === "preview.ws.message.end" && frame.direction === "server"));
  });
});
