import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentSessionSummary,
  LocalLlmChatSummary,
  RuntimeSummary,
  SessionSummary
} from "@deskcue/protocol";

import { buildCliStatusSnapshot } from "./cliStatusSnapshot.ts";

function agentSession(
  id: string,
  workState: AgentSessionSummary["workState"],
  updatedAt: string,
  subagent: AgentSessionSummary["subagent"] = null
) {
  return {
    agentId: "codex",
    agentLabel: "Codex",
    id,
    model: "gpt-5",
    subagent,
    title: id,
    updatedAt,
    workState,
    workspaceName: "DeskCueWorkspace"
  } as AgentSessionSummary;
}

function localChat(): LocalLlmChatSummary {
  return {
    agentMode: "ask",
    createdAt: "2026-09-14T09:00:00.000Z",
    generationError: null,
    generationState: "waiting_approval",
    id: "local-1",
    model: "qwen3",
    runtimeId: "lm-studio",
    title: "Local review",
    toolCapability: null,
    updatedAt: "2026-09-14T11:00:00.000Z",
    workspace: null
  };
}

test("CLI status snapshot counts root chats, active work and the latest cross-runtime activity", () => {
  const runtimes: RuntimeSummary[] = [
    {
      endpoint: null,
      id: "codex",
      installed: true,
      label: "Codex",
      lastActiveModel: null,
      loadedModelCount: 0,
      modelCount: 0,
      running: false,
      statusText: "installed"
    },
    {
      endpoint: "http://127.0.0.1:1234",
      id: "lm-studio",
      installed: true,
      label: "LM Studio",
      lastActiveModel: "qwen3",
      loadedModelCount: 1,
      modelCount: 3,
      running: true,
      statusText: "ready"
    }
  ];
  const snapshot = buildCliStatusSnapshot({
    agentChatCount: 1,
    agentChatCountExact: true,
    agentSessions: [
      agentSession("root", "running", "2026-09-14T10:00:00.000Z"),
      agentSession("child", "running", "2026-09-14T12:00:00.000Z", {
        depth: 1,
        nickname: "reviewer",
        parentSessionId: "root",
        role: "review"
      })
    ],
    agentSourceCounts: [{ agentId: "codex", count: 1, exact: true }],
    generatedAt: "2026-09-14T12:30:00.000Z",
    localChats: [localChat()],
    managedSessions: [],
    runtimes
  });

  assert.equal(snapshot.chatCount, 2);
  assert.equal(snapshot.chatCountExact, true);
  assert.equal(snapshot.activeChatCount, 2);
  assert.equal(snapshot.activeChatCountExact, true);
  assert.equal(snapshot.lastChat?.id, "local-1");
  assert.equal("active" in (snapshot.lastChat ?? {}), false);
  assert.deepEqual(
    snapshot.runtimes.map((runtime) => [runtime.id, runtime.chatCount, runtime.activeChatCount]),
    [["codex", 1, 1], ["lm-studio", 1, 1], ["generic-cli", 0, 0]]
  );
});

test("CLI status snapshot includes managed Generic CLI sessions without duplicating source agents", () => {
  const managedSession = {
    adapterId: "generic-cli",
    id: "generic-1",
    lastActivityAt: "2026-09-14T13:00:00.000Z",
    status: "running",
    workspaceName: "DeskCueWorkspace"
  } as SessionSummary;
  const snapshot = buildCliStatusSnapshot({
    agentChatCount: 0,
    agentChatCountExact: true,
    agentSessions: [],
    agentSourceCounts: [],
    localChats: [],
    managedSessions: [managedSession, { ...managedSession, adapterId: "codex", id: "managed-codex" }],
    runtimes: []
  });

  assert.equal(snapshot.chatCount, 1);
  assert.equal(snapshot.activeChatCount, 1);
  assert.equal(snapshot.lastChat?.sourceId, "generic-cli");
  assert.deepEqual(
    snapshot.runtimes.map((runtime) => [runtime.id, runtime.chatCount, runtime.activeChatCount]),
    [["generic-cli", 1, 1]]
  );
});
