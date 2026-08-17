import assert from "node:assert/strict";
import test from "node:test";

import { createTelegramApiClient } from "./telegramNotifications.ts";

function rejectWhenAborted(signal: AbortSignal | null | undefined) {
  assert.ok(signal);
  return new Promise<never>((_resolve, reject) => {
    const keepAlive = setTimeout(
      () => reject(new Error("Expected Telegram request deadline to abort.")),
      1_000
    );
    const onAbort = () => {
      clearTimeout(keepAlive);
      reject(signal.reason);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

test("Telegram IPv4 fallback receives a fresh deadline after the primary request times out", async () => {
  const client = createTelegramApiClient(
    async (_input, init) => rejectWhenAborted(init?.signal),
    async (_input, init) => {
      assert.equal(init?.signal?.aborted, false);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
  );

  const response = await client.fetchWithIpv4Fallback.fetchWithAttemptDeadline!(
    "https://api.telegram.org/test",
    undefined,
    5
  );

  assert.equal(response.ok, true);
});

test("Telegram IPv4 fallback does not outlive a closing delivery gate", async () => {
  const controller = new AbortController();
  controller.abort(new Error("closing"));
  let ipv4Calls = 0;
  const client = createTelegramApiClient(
    async () => {
      throw Object.assign(new Error("connect timed out"), { code: "ETIMEDOUT" });
    },
    async () => {
      ipv4Calls += 1;
      return new Response("", { status: 200 });
    }
  );

  await assert.rejects(
    client.fetchWithIpv4Fallback.fetchWithAttemptDeadline!(
      "https://api.telegram.org/test",
      { signal: controller.signal },
      100
    )
  );
  assert.equal(ipv4Calls, 0);
});

test("Telegram pairing API gives the IPv4 fallback its own deadline", async () => {
  let ipv4Calls = 0;
  const client = createTelegramApiClient(
    async (_input, init) => rejectWhenAborted(init?.signal),
    async (_input, init) => {
      ipv4Calls += 1;
      assert.equal(init?.signal?.aborted, false);
      return Response.json({ ok: true, result: { id: 1, username: "deskcue_bot" } });
    }
  );

  const result = await client.request<{ result: { username: string } }>(
    "bot-token-placeholder",
    "getMe",
    undefined,
    undefined,
    5
  );

  assert.equal(result.result.username, "deskcue_bot");
  assert.equal(ipv4Calls, 1);
});

test("Telegram Bot API retries one transient fetch failure without using IPv4 fallback", async () => {
  let primaryCalls = 0;
  let ipv4Calls = 0;
  const client = createTelegramApiClient(
    async () => {
      primaryCalls += 1;
      if (primaryCalls === 1) throw new TypeError("fetch failed");
      return Response.json({ ok: true, result: { id: 1, username: "deskcue_bot" } });
    },
    async () => {
      ipv4Calls += 1;
      return new Response("", { status: 500 });
    }
  );

  const result = await client.request<{ result: { username: string } }>(
    "bot-token-placeholder",
    "getMe",
    undefined,
    undefined,
    100
  );

  assert.equal(result.result.username, "deskcue_bot");
  assert.equal(primaryCalls, 2);
  assert.equal(ipv4Calls, 0);
});

test("Telegram Bot API does not retry a transient failure after shutdown", async () => {
  const controller = new AbortController();
  let primaryCalls = 0;
  let ipv4Calls = 0;
  const client = createTelegramApiClient(
    async () => {
      primaryCalls += 1;
      controller.abort(new Error("closing"));
      throw new TypeError("fetch failed");
    },
    async () => {
      ipv4Calls += 1;
      return new Response("", { status: 500 });
    }
  );

  await assert.rejects(client.request(
    "bot-token-placeholder",
    "getMe",
    undefined,
    controller.signal,
    100
  ));

  assert.equal(primaryCalls, 1);
  assert.equal(ipv4Calls, 0);
});

test("Telegram Bot API errors do not echo remote secret-bearing descriptions", async () => {
  const client = createTelegramApiClient(
    async () => Response.json({
      ok: false,
      description: "Rejected bot-token-placeholder"
    }, { status: 401 }),
    async () => new Response("", { status: 500 })
  );

  await assert.rejects(
    client.request(
      "bot-token-placeholder",
      "getMe",
      undefined,
      undefined,
      10
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "Telegram Bot API request failed with HTTP 401.");
      assert.equal(error.message.includes("bot-token-placeholder"), false);
      return true;
    }
  );
});
