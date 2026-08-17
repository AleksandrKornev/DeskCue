import express from "express";
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { resetWebSocketMetricsForTests } from "#realtime/live/metrics";

import {
  readRequestMetricSnapshots,
  requestLogger,
  resetRequestMetricsForTests,
  setRequestMetrics
} from "./requestLogger.ts";

beforeEach(() => {
  resetRequestMetricsForTests();
  resetWebSocketMetricsForTests();
});

test("request logger preserves incoming request id in the response header", async () => {
  const app = express();
  app.use(requestLogger);
  app.get("/ok", (_request, response) => {
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

    const response = await fetch(`http://127.0.0.1:${address.port}/ok`, {
      headers: {
        "x-request-id": "request-1"
      }
    });

    assert.equal(response.headers.get("x-request-id"), "request-1");
  } finally {
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

test("request logger redacts access tokens from query context", async () => {
  const app = express();
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (line?: unknown) => {
    lines.push(String(line));
  };

  app.use(requestLogger);
  app.get("/ok", (_request, response) => {
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

    await fetch(
      `http://127.0.0.1:${address.port}/ok?token=secret-token&access_token=secret-access&sessionId=session-1`
    );

    const payload = JSON.parse(lines.at(-1) ?? "{}") as {
      context?: {
        query?: Record<string, unknown>;
      };
    };

    assert.equal(payload.context?.query?.token, "[redacted]");
    assert.equal(payload.context?.query?.access_token, "[redacted]");
    assert.equal(payload.context?.query?.sessionId, "session-1");
  } finally {
    console.log = originalLog;
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

test("request logger redacts preview tickets embedded in paths", async () => {
  const app = express();
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (line?: unknown) => {
    lines.push(String(line));
  };

  app.use(requestLogger);
  app.get("/api/preview/sessions/:id/__deskcue_ticket__/:ticket/*path", (_request, response) => {
    response.sendStatus(204);
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  try {
    const address = server.address();
    if (!address || typeof address !== "object") {
      throw new Error("Expected server to listen on a TCP address.");
    }

    const secretTicket = "preview-secret-ticket";
    await fetch(
      `http://127.0.0.1:${address.port}/api/preview/sessions/session-1/__deskcue_ticket__/${secretTicket}/app.js`
    );

    const serialized = lines.at(-1) ?? "";
    const payload = JSON.parse(serialized) as { context?: { path?: string } };
    assert.equal(serialized.includes(secretTicket), false);
    assert.equal(
      payload.context?.path,
      "/api/preview/sessions/session-1/__deskcue_ticket__/[redacted]/app.js"
    );
  } finally {
    console.log = originalLog;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("request logger records command metadata without command contents", async () => {
  const app = express();
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (line?: unknown) => {
    lines.push(String(line));
  };

  app.use(express.json());
  app.use(requestLogger);
  app.post("/command", (_request, response) => {
    response.json({ ok: true });
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  try {
    const address = server.address();
    if (!address || typeof address !== "object") {
      throw new Error("Expected server to listen on a TCP address.");
    }

    const secretCommand = "tool --token super-secret-value";
    await fetch(`http://127.0.0.1:${address.port}/command`, {
      body: JSON.stringify({ command: secretCommand }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });

    const serialized = lines.at(-1) ?? "";
    const payload = JSON.parse(serialized) as {
      context?: { body?: Record<string, unknown> };
    };
    assert.equal(serialized.includes(secretCommand), false);
    assert.equal(serialized.includes("super-secret-value"), false);
    assert.equal(payload.context?.body?.command, undefined);
    assert.equal(payload.context?.body?.commandLength, secretCommand.length);
  } finally {
    console.log = originalLog;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("request logger includes response bytes and route metrics", async () => {
  const app = express();
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (line?: unknown) => {
    lines.push(String(line));
  };

  app.use(requestLogger);
  app.get("/heavy", (_request, response) => {
    setRequestMetrics(response, {
      agentSessionId: "codex:source-1",
      endpoint: "agent.transcript-view",
      etagHit: true,
      readMode: "source-version"
    });
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

    await fetch(`http://127.0.0.1:${address.port}/heavy`);

    const payload = JSON.parse(lines.at(-1) ?? "{}") as {
      context?: {
        metrics?: Record<string, unknown>;
        responseBytes?: number | null;
      };
    };

    assert.equal(payload.context?.responseBytes, 11);
    assert.equal(payload.context?.metrics?.endpoint, "agent.transcript-view");
    assert.equal(payload.context?.metrics?.etagHit, true);
    assert.equal(payload.context?.metrics?.readMode, "source-version");

    const snapshot = readRequestMetricSnapshots().endpoints.find(
      (endpoint) => endpoint.endpoint === "agent.transcript-view"
    );
    assert.ok(snapshot);
    assert.equal(snapshot.etagHitCount >= 1, true);
    assert.equal(typeof snapshot.memory.maxRssBytes, "number");
    assert.equal(typeof snapshot.memory.averageHeapUsedDeltaBytes, "number");
    assert.equal(snapshot.statusCounts.some((item) => item.statusCode === 200), true);
    assert.equal(snapshot.readModes.some((item) => item.readMode === "source-version"), true);
    assert.equal(
      readRequestMetricSnapshots().sessions.some((item) =>
        item.sessionKind === "agent-session" &&
        item.sessionId === "codex:source-1" &&
        item.responseBytes >= 11
      ),
      true
    );
    assert.equal(typeof readRequestMetricSnapshots().websocket.connectionCount, "number");
  } finally {
    console.log = originalLog;
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

test("request logger counts streamed response bytes without content length", async () => {
  const app = express();
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (line?: unknown) => {
    lines.push(String(line));
  };

  app.use(requestLogger);
  app.get("/stream", (_request, response) => {
    setRequestMetrics(response, {
      endpoint: "agent.transcript-view",
      etagHit: false,
      readMode: "streaming"
    });
    response.type("text/plain");
    response.write("hello");
    response.end(" world");
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  try {
    const address = server.address();
    if (!address || typeof address !== "object") {
      throw new Error("Expected server to listen on a TCP address.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/stream`);
    assert.equal(await response.text(), "hello world");

    const payload = JSON.parse(lines.at(-1) ?? "{}") as {
      context?: {
        responseBytes?: number | null;
      };
    };
    const snapshot = readRequestMetricSnapshots().endpoints.find(
      (endpoint) => endpoint.endpoint === "agent.transcript-view"
    );

    assert.equal(payload.context?.responseBytes, 11);
    assert.ok(snapshot);
    assert.equal(snapshot.responseBytes, 11);
  } finally {
    console.log = originalLog;
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
