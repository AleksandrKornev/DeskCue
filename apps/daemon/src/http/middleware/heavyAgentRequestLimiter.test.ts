import express from "express";
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { daemonConfig } from "#config/daemonConfig";

import {
  requireHeavyAgentRequestBudget,
  resetHeavyAgentRequestLimiterForTests
} from "./heavyAgentRequestLimiter.ts";

beforeEach(() => {
  resetHeavyAgentRequestLimiterForTests();
});

test("heavy agent request limiter returns 429 after the configured budget", async () => {
  const originalMax = daemonConfig.heavyAgentRequestRateLimitMax;
  const originalWindowMs = daemonConfig.heavyAgentRequestRateLimitWindowMs;
  daemonConfig.heavyAgentRequestRateLimitMax = 1;
  daemonConfig.heavyAgentRequestRateLimitWindowMs = 60_000;

  const app = express();
  app.get("/heavy", (request, response) => {
    if (!requireHeavyAgentRequestBudget(request, response, "test-heavy-budget")) {
      return;
    }

    response.json({
      ok: true
    });
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  try {
    const address = server.address();
    if (!address || typeof address !== "object") {
      throw new Error("Expected server to listen on a TCP address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const firstResponse = await fetch(`${baseUrl}/heavy`);
    const secondResponse = await fetch(`${baseUrl}/heavy`);

    assert.equal(firstResponse.status, 200);
    assert.equal(secondResponse.status, 429);
    assert.equal(secondResponse.headers.get("ratelimit-limit"), "1");
    assert.equal(secondResponse.headers.get("ratelimit-remaining"), "0");
  } finally {
    daemonConfig.heavyAgentRequestRateLimitMax = originalMax;
    daemonConfig.heavyAgentRequestRateLimitWindowMs = originalWindowMs;
    resetHeavyAgentRequestLimiterForTests();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
});
