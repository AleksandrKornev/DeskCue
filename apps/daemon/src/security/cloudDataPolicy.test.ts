import assert from "node:assert/strict";
import test from "node:test";

import { decideCloudDataTransfer, sanitizeCloudMetricContext } from "./cloudDataPolicy.ts";

test("cloud data policy allows scoped metadata without heavy upload opt-in", () => {
  const decision = decideCloudDataTransfer({
    kind: "source-version",
    optIn: false,
    redactionApplied: false,
    scope: {
      deviceId: "device-1",
      workspaceId: "workspace-1"
    }
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.requiresOptIn, false);
  assert.equal(decision.requiresRedaction, false);
});

test("cloud data policy blocks transcript upload without explicit opt-in and redaction", () => {
  const withoutOptIn = decideCloudDataTransfer({
    kind: "transcript",
    optIn: false,
    redactionApplied: true,
    scope: {
      agentSessionId: "codex:source-1",
      deviceId: "device-1",
      workspaceId: "workspace-1"
    }
  });
  const withoutRedaction = decideCloudDataTransfer({
    kind: "transcript",
    optIn: true,
    redactionApplied: false,
    scope: {
      agentSessionId: "codex:source-1",
      deviceId: "device-1",
      workspaceId: "workspace-1"
    }
  });

  assert.equal(withoutOptIn.allowed, false);
  assert.match(withoutOptIn.reason ?? "", /opt-in/);
  assert.equal(withoutRedaction.allowed, false);
  assert.match(withoutRedaction.reason ?? "", /redaction/);
});

test("cloud data policy requires heavy payload session scope", () => {
  const decision = decideCloudDataTransfer({
    kind: "diff",
    optIn: true,
    redactionApplied: true,
    scope: {
      deviceId: "device-1",
      workspacePath: "D:\\work\\project"
    }
  });

  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? "", /session/);
});

test("cloud metric context redacts sensitive payload fields", () => {
  assert.deepEqual(
    sanitizeCloudMetricContext({
      diffBody: "diff --git",
      endpoint: "cloud.sync",
      promptText: "secret prompt",
      responseBytes: 42,
      token: "secret-token"
    }),
    {
      diffBody: "[redacted]",
      endpoint: "cloud.sync",
      promptText: "[redacted]",
      responseBytes: 42,
      token: "[redacted]"
    }
  );
});
