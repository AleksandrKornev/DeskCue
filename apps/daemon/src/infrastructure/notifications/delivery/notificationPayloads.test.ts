import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentTurnFinishedNotification } from "./notificationPayloads.ts";

function turnFinishedPayload(managedSessionId?: string) {
  return {
    agentId: "codex" as const,
    agentLabel: "Codex",
    agentSessionId: "codex:source-1",
    completedAt: "2026-08-22T00:00:00.000Z",
    ...(managedSessionId ? { managedSessionId } : {}),
    sourceSessionId: "source-1",
    status: "completed" as const,
    title: "Finished task",
    workspaceName: "Workspace",
    workspacePath: "C:\\workspace"
  };
}

test("agent turn notification opens its unambiguous managed session", () => {
  const notification = buildAgentTurnFinishedNotification(
    turnFinishedPayload("managed session/1")
  );

  assert.equal(notification.url, "/sessions/managed%20session%2F1/overview");
  assert.equal(notification.data?.managedSessionId, "managed session/1");
});

test("agent turn notification falls back to source detail without a managed session", () => {
  const notification = buildAgentTurnFinishedNotification(turnFinishedPayload());

  assert.equal(notification.url, "/?agent=codex%3Asource-1");
  assert.equal(notification.data?.managedSessionId, null);
});
