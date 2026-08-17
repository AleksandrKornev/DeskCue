import assert from "node:assert/strict";
import test from "node:test";

import {
  CloudConnectorHttpClient,
  parseCloudConnectionTokenResponse
} from "./connector/cloudConnectorHttpClient.ts";

test("Cloud connector HTTP client enrolls with the exact bounded request contract", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const client = new CloudConnectorHttpClient(async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return Response.json({
      machine: { machineId: "machine-1" },
      machineCredential: "credential-placeholder"
    }, { status: 201 });
  });
  const request = {
    enrollmentTicket: "ticket-placeholder",
    installationId: "installation-1",
    displayName: "Machine",
    localDaemonVersion: "0.1.0",
    capabilities: ["session.summary"] as const
  };

  assert.deepEqual(
    await client.enroll("https://cloud.example.test", {
      ...request,
      capabilities: [...request.capabilities]
    }),
    {
      machine: { machineId: "machine-1" },
      machineCredential: "credential-placeholder"
    }
  );
  assert.equal(capturedUrl, "https://cloud.example.test/machines/enroll");
  assert.equal(new Headers(capturedInit?.headers).has("authorization"), false);
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), request);
});

test("Cloud connector HTTP client creates and polls a browser enrollment attempt", async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const client = new CloudConnectorHttpClient(async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) as unknown });
    if (String(input).endsWith("/poll")) {
      return Response.json({
        status: "connected",
        machine: { machineId: "machine-1" },
        machineCredential: "machine-credential-placeholder",
        expiresAt
      });
    }
    return Response.json({
      attemptId: "attempt-1",
      attemptSecret: "attempt-secret-placeholder",
      verificationUrl: "https://accounts.example.test/enroll/attempt-1",
      expiresAt,
      pollIntervalMs: 1_000
    }, { status: 201 });
  });

  const attempt = await client.createEnrollmentAttempt("https://api.example.test", {
    installationId: "installation-1",
    displayName: "Machine",
    localDaemonVersion: "0.1.0",
    capabilities: ["session.summary"]
  });
  assert.equal(attempt.verificationUrl, "https://accounts.example.test/enroll/attempt-1");
  assert.deepEqual(
    await client.pollEnrollmentAttempt(
      "https://api.example.test",
      attempt.attemptId,
      attempt.attemptSecret
    ),
    {
      status: "connected",
      machine: { machineId: "machine-1" },
      machineCredential: "machine-credential-placeholder",
      expiresAt
    }
  );
  assert.deepEqual(requests.map((request) => request.url), [
    "https://api.example.test/machines/enrollment-attempts",
    "https://api.example.test/machines/enrollment-attempts/attempt-1/poll"
  ]);
  assert.deepEqual(requests[1]?.body, { attemptSecret: "attempt-secret-placeholder" });
});

test("Cloud enrollment verification URL allows HTTPS or loopback HTTP only", async () => {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const responseFor = (verificationUrl: string) => Response.json({
    attemptId: "attempt-1",
    attemptSecret: "attempt-secret-placeholder",
    verificationUrl,
    expiresAt,
    pollIntervalMs: 1_000
  });
  const request = {
    installationId: "installation-1",
    displayName: "Machine",
    localDaemonVersion: "0.1.0",
    capabilities: ["session.summary"] as const
  };
  const loopbackClient = new CloudConnectorHttpClient(async () => responseFor(
    "http://127.0.0.1:5100/enroll/attempt-1"
  ));
  assert.equal(
    (await loopbackClient.createEnrollmentAttempt("http://127.0.0.1:5100", {
      ...request,
      capabilities: [...request.capabilities]
    })).verificationUrl,
    "http://127.0.0.1:5100/enroll/attempt-1"
  );
  for (const unsafeUrl of [
    "http://accounts.example.test/enroll/attempt-1",
    "javascript:alert(1)",
    "file:///tmp/enroll"
  ]) {
    const client = new CloudConnectorHttpClient(async () => responseFor(unsafeUrl));
    await assert.rejects(client.createEnrollmentAttempt("https://api.example.test", {
      ...request,
      capabilities: [...request.capabilities]
    }), /enrollment_attempt_invalid_verification_url/);
  }
});

test("Cloud connector HTTP client validates the connection relay origin and path", async () => {
  let authorization: string | null = null;
  const client = new CloudConnectorHttpClient(async (_input, init) => {
    authorization = new Headers(init?.headers).get("authorization");
    return Response.json({
      connectionToken: "connection-token-placeholder",
      relayUrl: "wss://cloud.example.test/relay/machines/machine-1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      cursors: { "session-summaries": 0 }
    }, { status: 201 });
  });

  const connection = await client.createConnectionToken(
    "https://cloud.example.test",
    "machine-1",
    "credential-placeholder"
  );
  assert.equal(connection.relayUrl, "wss://cloud.example.test/relay/machines/machine-1");
  assert.equal(authorization, "Bearer credential-placeholder");

  const unsafeClient = new CloudConnectorHttpClient(async () => Response.json({
    connectionToken: "connection-token-placeholder",
    relayUrl: "wss://other.example.test/relay/machines/machine-1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    cursors: { "session-summaries": 0 }
  }, { status: 201 }));
  await assert.rejects(
    unsafeClient.createConnectionToken(
      "https://cloud.example.test",
      "machine-1",
      "credential-placeholder"
    ),
    /connection_invalid_relay_url/
  );
});

test("Cloud connector HTTP client atomically replaces machine capabilities", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const client = new CloudConnectorHttpClient(async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(null, { status: 204 });
  });
  const capabilities = [
    "session.summary",
    "deskcue.read",
    "deskcue.realtime",
    "deskcue.preview"
  ] as const;

  await client.replaceCapabilities(
    "https://cloud.example.test",
    "machine-1",
    "credential-placeholder",
    [...capabilities]
  );

  assert.equal(
    capturedUrl,
    "https://cloud.example.test/machines/machine-1/capabilities"
  );
  assert.equal(capturedInit?.method, "PUT");
  assert.equal(
    new Headers(capturedInit?.headers).get("authorization"),
    "Bearer credential-placeholder"
  );
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), { capabilities });

  const invalidClient = new CloudConnectorHttpClient(async () => Response.json(
    { machine: {} },
    { status: 200 }
  ));
  await assert.rejects(
    invalidClient.replaceCapabilities(
      "https://cloud.example.test",
      "machine-1",
      "credential-placeholder",
      ["session.summary"]
    ),
    /capabilities_invalid_response/
  );
});

test("Cloud connector HTTP client cancels an oversized streamed response", async () => {
  let cancelled = false;
  const client = new CloudConnectorHttpClient(async () => new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(40_000));
        controller.enqueue(new Uint8Array(40_000));
      },
      cancel() {
        cancelled = true;
      }
    }),
    { status: 201 }
  ));

  await assert.rejects(client.enroll("https://cloud.example.test", {
    enrollmentTicket: "ticket-placeholder",
    installationId: "installation-1",
    displayName: "Machine",
    localDaemonVersion: "0.1.0",
    capabilities: ["session.summary"]
  }), /cloud_http_response_too_large/);
  assert.equal(cancelled, true);
});

test("Cloud connection cursor is a bounded nonnegative safe sequence", () => {
  const response = {
    connectionToken: "connection-token-placeholder",
    relayUrl: "wss://cloud.example.test/relay/machines/machine-1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    cursors: { "session-summaries": Number.MAX_SAFE_INTEGER }
  };
  assert.equal(
    parseCloudConnectionTokenResponse(
      response,
      "https://cloud.example.test",
      "machine-1"
    ).cursors["session-summaries"],
    Number.MAX_SAFE_INTEGER
  );

  for (const invalidCursor of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, -1]) {
    assert.throws(
      () => parseCloudConnectionTokenResponse(
        { ...response, cursors: { "session-summaries": invalidCursor } },
        "https://cloud.example.test",
        "machine-1"
      ),
      /connection_invalid_response/
    );
  }
});

test("Cloud connector rejects unsafe credentials, machine ids, and expired tokens", async () => {
  const unsafeEnrollment = new CloudConnectorHttpClient(async () => Response.json({
    machine: { machineId: "machine/escape" },
    machineCredential: "credential-placeholder"
  }, { status: 201 }));
  await assert.rejects(unsafeEnrollment.enroll("https://cloud.example.test", {
    enrollmentTicket: "ticket-placeholder",
    installationId: "installation-1",
    displayName: "Machine",
    localDaemonVersion: "0.1.0",
    capabilities: ["session.summary"]
  }), /enrollment_invalid_response/);

  const response = {
    connectionToken: "connection-token-placeholder",
    relayUrl: "wss://cloud.example.test/relay/machines/machine-1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    cursors: { "session-summaries": 0 }
  };
  assert.throws(() => parseCloudConnectionTokenResponse(
    { ...response, connectionToken: "unsafe\r\ntoken" },
    "https://cloud.example.test",
    "machine-1"
  ), /connection_invalid_response/);
  assert.throws(() => parseCloudConnectionTokenResponse(
    { ...response, expiresAt: new Date(Date.now() - 1_000).toISOString() },
    "https://cloud.example.test",
    "machine-1"
  ), /connection_invalid_response/);
});
