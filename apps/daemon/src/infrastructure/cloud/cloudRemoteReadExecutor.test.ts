import assert from "node:assert/strict";
import test from "node:test";

import { ProtocolSchemaError } from "@deskcue/protocol";
import { isValidCloudProcessLocalAuthorization } from "#security/cloudProcessLocalCredential";

import { CloudRemoteReadExecutor } from "./cloudRemoteReadExecutor.ts";

test("remote read executor maps the typed sessions.list operation to one loopback route", async () => {
  let capturedUrl = "";
  const executor = new CloudRemoteReadExecutor({
    daemonOrigin: "http://127.0.0.1:4100",
    fetchImplementation: async (input) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ sessions: [{ id: "source-1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const result = await executor.execute("sessions.list", {
    limit: 8,
    includeLiveMetadata: true,
    sourceId: "codex"
  });

  assert.equal(
    capturedUrl,
    "http://127.0.0.1:4100/api/agents/sessions?limit=8&source=codex&includeLiveMetadata=1"
  );
  assert.deepEqual(result, { status: 200, body: { sessions: [{ id: "source-1" }] } });
});

test("remote read executor rejects unknown fields before issuing a request", async () => {
  let called = false;
  const executor = new CloudRemoteReadExecutor({
    daemonOrigin: "http://127.0.0.1:4100",
    fetchImplementation: async () => {
      called = true;
      return new Response("{}");
    }
  });

  await assert.rejects(
    executor.execute("sessions.list", { limit: 8, path: "/api/secrets" }),
    ProtocolSchemaError
  );
  assert.equal(called, false);
});

test("remote read executor resolves opaque session routes without a loopback request", async () => {
  const cloudSessionId = `sess_${"a".repeat(64)}`;
  let fetched = false;
  const executor = new CloudRemoteReadExecutor({
    daemonOrigin: "http://127.0.0.1:4100",
    fetchImplementation: async () => {
      fetched = true;
      return Response.json({});
    },
    resolveSessionRoute: async (receivedId) => {
      assert.equal(receivedId, cloudSessionId);
      return { kind: "agent", sessionId: "codex:source-1" };
    }
  });

  assert.deepEqual(
    await executor.execute("sessions.resolveRoute", { cloudSessionId }),
    { status: 200, body: { route: { kind: "agent", sessionId: "codex:source-1" } } }
  );
  assert.equal(fetched, false);
});

test("remote read executor returns not found when an opaque session is stale", async () => {
  const executor = new CloudRemoteReadExecutor({
    daemonOrigin: "http://127.0.0.1:4100",
    resolveSessionRoute: async () => null
  });

  assert.deepEqual(
    await executor.execute("sessions.resolveRoute", { cloudSessionId: `sess_${"b".repeat(64)}` }),
    { status: 404, body: { error: "session_not_found" } }
  );
});

test("remote read executor attaches the process-local Cloud credential", async () => {
  let authorized = false;
  const executor = new CloudRemoteReadExecutor({
    daemonOrigin: "http://127.0.0.1:4100",
    fetchImplementation: async (_input, init) => {
      const headers = new Headers(init?.headers);
      authorized = isValidCloudProcessLocalAuthorization(
        headers.get("authorization") ?? undefined
      );
      return new Response("{}", { status: 200 });
    }
  });
  await executor.execute("overview.get", {});
  assert.equal(authorized, true);
});

test("remote read executor maps overview and managed session reads without arbitrary paths", async () => {
  const urls: string[] = [];
  const executor = new CloudRemoteReadExecutor({
    daemonOrigin: "http://127.0.0.1:4100",
    fetchImplementation: async (input) => {
      urls.push(String(input));
      return new Response("{}", { status: 200 });
    }
  });
  await executor.execute("overview.get", { sessionLimit: 16 });
  await executor.execute("managedSessions.get", {
    sessionId: "managed/session",
    view: "debug",
    debugLogTail: 100
  });
  assert.deepEqual(urls, [
    "http://127.0.0.1:4100/api/overview?sessionLimit=16",
    "http://127.0.0.1:4100/api/sessions/managed%2Fsession?view=debug&logTail=100"
  ]);
});

test("remote read executor refuses non-loopback targets", () => {
  assert.throws(
    () => new CloudRemoteReadExecutor({ daemonOrigin: "https://example.test" }),
    /trusted loopback/
  );
});

test("remote read executor aborts an active loopback request during shutdown", async () => {
  const shutdown = new AbortController();
  let requestStarted = false;
  const executor = new CloudRemoteReadExecutor({
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

  const execution = executor.execute("overview.get", {}, shutdown.signal);
  assert.equal(requestStarted, true);
  shutdown.abort(new Error("connector_shutdown"));
  await assert.rejects(execution, /connector_shutdown/);
});

test("remote read executor maps transcript history GET and POST operations exactly", async () => {
  const requests: Array<{ url: string; method: string; body: string | null }> = [];
  const executor = new CloudRemoteReadExecutor({
    daemonOrigin: "http://127.0.0.1:4100",
    fetchImplementation: async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null
      });
      return new Response("{}", { status: 200 });
    }
  });

  await executor.execute("transcript.page", {
    agentSessionId: "codex:source/1",
    beforeEntryId: "source@100-0",
    limit: 20
  });
  await executor.execute("transcript.entries.get", {
    agentSessionId: "codex:source/1",
    entryIds: ["entry-1", "entry-2"]
  });
  await executor.execute("transcript.entries.post", {
    agentSessionId: "codex:source/1",
    entryIds: ["entry-1", "entry-2"]
  });

  assert.deepEqual(requests, [
    {
      url: "http://127.0.0.1:4100/api/agents/sessions/codex%3Asource%2F1/" +
        "transcript-page?beforeEntryId=source%40100-0&limit=20",
      method: "GET",
      body: null
    },
    {
      url: "http://127.0.0.1:4100/api/agents/sessions/codex%3Asource%2F1/transcript-entries?entryIds=entry-1%2Centry-2",
      method: "GET",
      body: null
    },
    {
      url: "http://127.0.0.1:4100/api/agents/sessions/codex%3Asource%2F1/transcript-entries",
      method: "POST",
      body: JSON.stringify({ entryIds: ["entry-1", "entry-2"] })
    }
  ]);
});

test("remote read executor maps the bounded reviewed mutation exactly", async () => {
  const requests: Array<{ url: string; method: string; body: string | null }> = [];
  const executor = new CloudRemoteReadExecutor({
    daemonOrigin: "http://127.0.0.1:4100",
    fetchImplementation: async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null
      });
      return new Response("{}", { status: 200 });
    }
  });

  await executor.execute("sessions.reviewed.post", {
    agentSessionId: "codex:source/1"
  });

  assert.deepEqual(requests, [{
    url: "http://127.0.0.1:4100/api/agents/sessions/codex%3Asource%2F1/reviewed",
    method: "POST",
    body: "{}"
  }]);
});

test("remote read executor preserves GET and POST semantics for transcript changes", async () => {
  const requests: Array<{ url: string; method: string; body: string | null }> = [];
  const executor = new CloudRemoteReadExecutor({
    daemonOrigin: "http://127.0.0.1:4100",
    fetchImplementation: async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null
      });
      return new Response("{}", { status: 200 });
    }
  });
  const input = {
    agentSessionId: "codex:source-1",
    groupId: "changes/1",
    sourceEntryIds: ["entry-1", "entry-2"]
  };
  await executor.execute("changes.get", input);
  await executor.execute("changes.post", input);

  assert.deepEqual(requests, [
    {
      url: "http://127.0.0.1:4100/api/agents/sessions/codex%3Asource-1/changes/changes%2F1?entryIds=entry-1%2Centry-2",
      method: "GET",
      body: null
    },
    {
      url: "http://127.0.0.1:4100/api/agents/sessions/codex%3Asource-1/changes/changes%2F1",
      method: "POST",
      body: JSON.stringify({ entryIds: ["entry-1", "entry-2"] })
    }
  ]);
});

test("remote read executor maps bounded workspace file operations without accepting a route", async () => {
  const urls: string[] = [];
  const executor = new CloudRemoteReadExecutor({
    daemonOrigin: "http://127.0.0.1:4100",
    fetchImplementation: async (input) => {
      urls.push(String(input));
      return Response.json({});
    }
  });

  await executor.execute("workspace.files.list", {
    workspaceId: "workspace/1",
    path: "src/components",
    cursor: "n_YnV0dG9uLnRzeA",
    limit: 80
  });
  await executor.execute("workspace.files.read", {
    workspaceId: "workspace/1",
    path: "src/components/Button.tsx"
  });

  assert.deepEqual(urls, [
    "http://127.0.0.1:4100/api/workspaces/workspace%2F1/files?path=src%2Fcomponents&cursor=n_YnV0dG9uLnRzeA&limit=80",
    "http://127.0.0.1:4100/api/workspaces/workspace%2F1/file?path=src%2Fcomponents%2FButton.tsx"
  ]);
});

test("remote read executor mirrors registered workspace files without a Cloud deny-list", async () => {
  const requests: string[] = [];
  const executor = new CloudRemoteReadExecutor({
    daemonOrigin: "http://127.0.0.1:4100",
    fetchImplementation: async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/file?")) {
        return Response.json({
          binary: false,
          content: "LOCAL_SETTING=example",
          modifiedAt: "2026-08-14T00:00:00.000Z",
          path: ".env",
          sizeBytes: 21,
          truncated: false,
          workspaceId: "workspace-1"
        });
      }
      return Response.json({
        entries: [
          { kind: "file", name: ".env", path: ".env", readable: true },
          { kind: "file", name: ".env.example", path: ".env.example", readable: true },
          { kind: "directory", name: ".git", path: ".git", readable: true },
          { kind: "file", name: ".editorconfig", path: ".editorconfig", readable: true },
          { kind: "file", name: "index.ts", path: "src/index.ts", readable: true }
        ],
        hasMore: false,
        nextCursor: null,
        path: "",
        workspaceId: "workspace-1"
      });
    }
  });

  const listed = await executor.execute("workspace.files.list", {
    workspaceId: "workspace-1",
    path: ""
  });
  const read = await executor.execute("workspace.files.read", {
    workspaceId: "workspace-1",
    path: ".env"
  });

  assert.deepEqual(
    (listed.body as { entries: Array<{ path: string }> }).entries.map((entry) => entry.path),
    [".env", ".env.example", ".git", ".editorconfig", "src/index.ts"]
  );
  assert.equal(read.status, 200);
  assert.equal(requests.length, 2);
});

test("remote read executor creates a scoped asset ticket and relays its binary body", async () => {
  const requests: Array<{ body: string | null; method: string; url: string }> = [];
  const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  const executor = new CloudRemoteReadExecutor({
    daemonOrigin: "http://127.0.0.1:4100",
    fetchImplementation: async (input, init) => {
      const url = String(input);
      requests.push({
        body: typeof init?.body === "string" ? init.body : null,
        method: init?.method ?? "GET",
        url
      });
      if (url.endsWith("/api/assets/ticket")) {
        return Response.json({
          expiresAt: "2026-08-14T00:15:00.000Z",
          url: "/api/assets/ticket/12345678-1234-1234-1234-123456789abc"
        }, { status: 201 });
      }
      return new Response(image, {
        headers: {
          "content-disposition": "inline; filename=screenshot.png",
          "content-type": "image/png"
        }
      });
    }
  });

  const created = await executor.execute("assets.ticket.create", {
    agentSessionId: "codex:one",
    kind: "local_image",
    path: "C:\\Users\\person\\AppData\\Local\\Temp\\screenshot.png"
  });
  const read = await executor.execute("assets.ticket.read", {
    ticket: "12345678-1234-1234-1234-123456789abc"
  });

  assert.equal(created.status, 201);
  assert.equal(read.status, 200);
  assert.equal(read.binary, true);
  assert.ok(Buffer.isBuffer(read.body));
  const envelope = read.body as Buffer;
  assert.equal(envelope.subarray(0, 4).toString("ascii"), "DCA1");
  const headerBytes = envelope.readUInt32BE(4);
  assert.deepEqual(JSON.parse(envelope.subarray(8, 8 + headerBytes).toString("utf8")), {
    contentDisposition: "inline; filename=screenshot.png",
    contentType: "image/png"
  });
  assert.deepEqual(envelope.subarray(8 + headerBytes), image);
  assert.equal(requests[0]?.method, "POST");
  assert.equal(requests[1]?.method, "GET");
});

test("remote read executor fails closed on mismatched workspace file responses", async () => {
  let responseKind: "directory" | "file" = "directory";
  const executor = new CloudRemoteReadExecutor({
    daemonOrigin: "http://127.0.0.1:4100",
    fetchImplementation: async () => responseKind === "directory"
      ? Response.json({
          entries: [],
          hasMore: false,
          nextCursor: null,
          path: "other",
          workspaceId: "workspace-1"
        })
      : Response.json({
          content: "not the requested workspace",
          path: "README.md",
          workspaceId: "workspace-2"
        })
  });

  assert.deepEqual(
    await executor.execute("workspace.files.list", {
      workspaceId: "workspace-1",
      path: "src"
    }),
    { status: 502, body: { error: "invalid_remote_response" } }
  );

  responseKind = "file";
  assert.deepEqual(
    await executor.execute("workspace.files.read", {
      workspaceId: "workspace-1",
      path: "README.md"
    }),
    { status: 502, body: { error: "invalid_remote_response" } }
  );
});

test("remote read executor maps git refresh to the exact managed session route", async () => {
  const requests: Array<{ url: string; method: string; body: string | null }> = [];
  const executor = new CloudRemoteReadExecutor({
    daemonOrigin: "http://127.0.0.1:4100",
    fetchImplementation: async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null
      });
      return Response.json({ id: "managed-1" });
    }
  });

  await executor.execute("managed.git.refresh", {
    sessionId: "managed/session",
    view: "diff"
  });
  await executor.execute("managed.git.refresh", { sessionId: "managed-2" });

  assert.deepEqual(requests, [
    {
      url: "http://127.0.0.1:4100/api/sessions/managed%2Fsession/refresh-git?view=diff",
      method: "POST",
      body: null
    },
    {
      url: "http://127.0.0.1:4100/api/sessions/managed-2/refresh-git",
      method: "POST",
      body: null
    }
  ]);
});
