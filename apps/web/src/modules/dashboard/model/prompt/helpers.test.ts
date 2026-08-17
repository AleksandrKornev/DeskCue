import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentSessionDetail, SessionDetail, SessionSummary } from "@deskcue/protocol";

import {
  getExternalCodexDesktopThreadUrl,
  shouldAwaitSourceInterruptConfirmation
} from "./helpers";

function createSession(patch: Partial<SessionDetail>): SessionDetail {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    adapterId: "codex",
    sourceSessionId: "source-1",
    command: "codex",
    status: "read_only",
    startedAt: "2026-07-31T09:00:00.000Z",
    finishedAt: null,
    lastActivityAt: "2026-07-31T10:00:00.000Z",
    exitCode: null,
    preview: {
      active: false,
      networkMode: "device-direct",
      port: null,
      targetUrl: null,
      artifacts: []
    },
    replyState: {
      phase: "idle",
      promptText: null,
      requestedAt: null
    },
    git: {
      branch: null,
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: true,
      lastUpdatedAt: "2026-07-31T10:00:00.000Z"
    },
    logs: [],
    inputHistory: [],
    ...patch
  };
}

function createSessionSummary(patch: Partial<SessionSummary>): SessionSummary {
  const summary = { ...createSession({}) };
  Reflect.deleteProperty(summary, "inputHistory");
  Reflect.deleteProperty(summary, "logs");
  return {
    ...summary,
    ...patch
  };
}

function createAgentSession(patch: Partial<AgentSessionDetail>): AgentSessionDetail {
  return {
    id: "codex:thread-1",
    agentId: "codex",
    agentLabel: "Codex",
    sourceSessionId: "thread-1",
    title: "Desktop chat",
    workspacePath: null,
    workspaceName: null,
    updatedAt: "2026-07-31T10:00:00.000Z",
    model: null,
    originator: "Codex Desktop",
    cliVersion: null,
    source: "vscode",
    filePath: "C:/Users/example/.codex/sessions/thread.jsonl",
    attachMode: "read_only",
    workState: "running",
    transcript: [],
    ...patch
  };
}

describe("prompt helpers", () => {
  it("returns a Codex Desktop deep link only for the matching source chat", () => {
    const selectedSession = createSession({
      sourceSessionId: "thread/with spaces"
    });
    const agentSession = createAgentSession({
      sourceSessionId: "thread/with spaces"
    });

    assert.equal(
      getExternalCodexDesktopThreadUrl(selectedSession, agentSession),
      "codex://threads/thread%2Fwith%20spaces"
    );
    assert.equal(
      getExternalCodexDesktopThreadUrl(selectedSession, {
        ...agentSession,
        originator: "Codex CLI"
      }),
      null
    );
    assert.equal(
      getExternalCodexDesktopThreadUrl(selectedSession, {
        ...agentSession,
        sourceSessionId: "another-thread"
      }),
      null
    );
  });

  it("does not wait for source confirmation after a managed terminal stop", () => {
    assert.equal(
      shouldAwaitSourceInterruptConfirmation("claude-source-1", createSessionSummary({
        status: "stopped",
        canSendInput: true,
        replyState: {
          phase: "idle",
          promptText: null,
          requestedAt: null
        }
      })),
      false
    );
    assert.equal(
      shouldAwaitSourceInterruptConfirmation("codex-source-1", createSessionSummary({
        status: "running",
        canSendInput: true
      })),
      true
    );
    assert.equal(
      shouldAwaitSourceInterruptConfirmation(
        "codex-source-1",
        createSessionSummary({ status: "read_only" }),
        { wasQueuedPrompt: true }
      ),
      false
    );
  });
});
