import assert from "node:assert/strict";
import test from "node:test";

import { isValidCloudProcessLocalAuthorization } from "#security/cloudProcessLocalCredential";

import { CloudRemoteControlExecutor } from "./cloudRemoteControlExecutor.ts";

test("remote control executor maps only the modelled write operations", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const executor = new CloudRemoteControlExecutor({
    daemonOrigin: "http://127.0.0.1:4100",
    fetchImplementation: async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json({ id: "session" });
    }
  });

  await executor.execute("source.attach", { agentSessionId: "source/id", prompt: "continue" });
  await executor.execute("managed.input", { sessionId: "managed/id", input: "continue" });
  await executor.execute("managed.interrupt", { sessionId: "managed/id" });
  await executor.execute("managed.stop", { sessionId: "managed/id" });

  assert.deepEqual(requests.map(({ url, init }) => ({
    url,
    method: init?.method,
    body: init?.body
  })), [
    {
      url: "http://127.0.0.1:4100/api/agents/sessions/source%2Fid/attach",
      method: "POST",
      body: JSON.stringify({ prompt: "continue" })
    },
    {
      url: "http://127.0.0.1:4100/api/sessions/managed%2Fid/input?compact=1",
      method: "POST",
      body: JSON.stringify({ input: "continue" })
    },
    {
      url: "http://127.0.0.1:4100/api/sessions/managed%2Fid/interrupt?compact=1",
      method: "POST",
      body: JSON.stringify({})
    },
    {
      url: "http://127.0.0.1:4100/api/sessions/managed%2Fid/stop?compact=1",
      method: "POST",
      body: JSON.stringify({})
    }
  ]);
});

test("remote control executor attaches the process-local Cloud credential", async () => {
  let authorized = false;
  const executor = new CloudRemoteControlExecutor({
    daemonOrigin: "http://127.0.0.1:4100",
    fetchImplementation: async (_url, init) => {
      authorized = isValidCloudProcessLocalAuthorization(
        new Headers(init?.headers).get("authorization") ?? undefined
      );
      return Response.json({ id: "session" });
    }
  });

  await executor.execute("managed.input", { sessionId: "session", input: "private text" });
  assert.equal(authorized, true);
});

test("remote control executor rejects unknown fields before a local request", async () => {
  let fetched = false;
  const executor = new CloudRemoteControlExecutor({
    daemonOrigin: "http://127.0.0.1:4100",
    fetchImplementation: async () => {
      fetched = true;
      return Response.json({});
    }
  });

  await assert.rejects(
    executor.execute("managed.interrupt", { sessionId: "session", path: "/api/access/reset" })
  );

  assert.equal(fetched, false);
});

test("remote control does not execute external desktop fallback actions", async () => {
  const executor = new CloudRemoteControlExecutor({
    daemonOrigin: "http://127.0.0.1:4100",
    fetchImplementation: async () => Response.json({ kind: "external_desktop_fallback" })
  });

  assert.deepEqual(
    await executor.execute("managed.interrupt", { sessionId: "session" }),
    { status: 200, body: { kind: "external_desktop_fallback" } }
  );
});

test("remote control forwards the bounded session shape without prompt history or logs", async () => {
  const executor = new CloudRemoteControlExecutor({
    daemonOrigin: "http://127.0.0.1:4100",
    fetchImplementation: async () => Response.json({
      id: "session",
      workspaceId: "workspace",
      status: "running",
      command: "private command",
      sourceSessionFilePath: "private source path",
      replyState: { phase: "waiting", promptText: "private prompt" },
      promptRecovery: {
        phase: "outcome_unknown",
        promptText: "private recovery prompt",
        requestedAt: "2026-08-11T10:00:00.000Z",
        retryable: false
      },
      actionRequest: { kind: "approval", command: "private tool command", reason: "private reason" },
      inputHistory: ["private prompt"],
      logs: ["private output"],
      git: {
        changedFiles: ["secret/new-name.txt"],
        changedFilePreviousPaths: { "secret/new-name.txt": "secret/old-name.txt" },
        changedFileStatuses: { "secret/new-name.txt": "R" },
        diff: "private diff",
        diffTruncated: true
      }
    }, { status: 201 })
  });

  assert.deepEqual(
    await executor.execute("source.attach", { agentSessionId: "source", prompt: "private prompt" }),
    {
      status: 201,
      body: {
        id: "session",
        workspaceId: "workspace",
        status: "running",
        command: "",
        sourceSessionFilePath: null,
        replyState: { phase: "waiting", promptText: null },
        promptRecovery: {
          phase: "outcome_unknown",
          promptText: null,
          requestedAt: "2026-08-11T10:00:00.000Z",
          retryable: false
        },
        actionRequest: { kind: "approval", command: null, reason: null },
        inputHistory: [],
        logs: [],
        git: {
          changedFiles: [],
          changedFilePreviousPaths: {},
          changedFileStatuses: {},
          diff: "",
          diffTruncated: false
        }
      }
    }
  );
});

test("remote control does not relay a local error body that could echo private input", async () => {
  const executor = new CloudRemoteControlExecutor({
    daemonOrigin: "http://127.0.0.1:4100",
    fetchImplementation: async () => Response.json({
      error: "private prompt was rejected"
    }, { status: 409 })
  });

  assert.deepEqual(
    await executor.execute("managed.input", { sessionId: "session", input: "private prompt" }),
    { status: 409, body: { error: "remote_control_failed" } }
  );
});

test("remote control refuses non-loopback targets", () => {
  assert.throws(
    () => new CloudRemoteControlExecutor({ daemonOrigin: "https://cloud.example.test" }),
    /trusted loopback/
  );
});

test("remote control executor aborts an active loopback request during shutdown", async () => {
  const shutdown = new AbortController();
  let requestStarted = false;
  const executor = new CloudRemoteControlExecutor({
    daemonOrigin: "http://127.0.0.1:4100",
    fetchImplementation: async (_input, init) => {
      requestStarted = true;
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;

        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }

        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }
  });

  const execution = executor.execute(
    "managed.interrupt",
    { sessionId: "session" },
    shutdown.signal
  );

  assert.equal(requestStarted, true);
  shutdown.abort(new Error("connector_shutdown"));
  await assert.rejects(execution, /connector_shutdown/);
});
