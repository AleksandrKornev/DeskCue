import assert from "node:assert/strict";
import {
  describe,
  it
} from "node:test";

import type {
  AgentSessionDetail,
  SessionDetail
} from "@deskcue/protocol";
import type { PendingChatPrompt } from "@models/promptDelivery";

import {
  resolvePromptSessionSyncAction,
  shouldResetPromptStateForSelection
} from "./helpers";

const requestedAt = "2026-07-29T18:00:00.000Z";

function createReadOnlyTakenOverSession(): SessionDetail {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    adapterId: "codex",
    sourceSessionId: "source-1",
    command: "codex",
    status: "read_only",
    startedAt: "2026-07-29T17:00:00.000Z",
    finishedAt: null,
    lastActivityAt: "2026-07-29T18:00:10.000Z",
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
      lastUpdatedAt: "2026-07-29T18:00:00.000Z"
    },
    logs: [],
    inputHistory: []
  };
}

function createWaitingPrompt(): PendingChatPrompt {
  return {
    text: "Continue work",
    requestedAt,
    sessionId: "session-1",
    sourceSessionId: "source-1",
    status: "waiting"
  };
}

function createAgentSession(
  transcript: AgentSessionDetail["transcript"],
  patch: Partial<AgentSessionDetail> = {}
): AgentSessionDetail {
  return {
    id: "codex:source-1",
    agentId: "codex",
    agentLabel: "Codex",
    sourceSessionId: "source-1",
    title: "Continue work",
    workspacePath: "D:\\work\\project",
    workspaceName: "project",
    updatedAt: "2026-07-29T18:00:10.000Z",
    model: null,
    originator: null,
    cliVersion: null,
    source: null,
    filePath: "codex.jsonl",
    attachMode: "read_only",
    workState: "idle",
    transcript,
    ...patch
  };
}

describe("resolvePromptSessionSyncAction", () => {
  it("does not reset an empty delivery state", () => {
    assert.equal(shouldResetPromptStateForSelection({
      awaitingChatReplySince: null,
      isWaitingForChatReply: false,
      pendingChatPrompt: null,
      selectedSession: createReadOnlyTakenOverSession(),
      selectedSessionId: "session-1"
    }), false);
  });

  it("clears a cached waiting prompt from a terminal turn state when the compact live view has no raw transcript", () => {
    const prompt = createWaitingPrompt();
    const action = resolvePromptSessionSyncAction({
      activeTakenOverAgentSession: createAgentSession([], {
        turnState: {
          activityAt: null,
          completedAt: "2026-07-29T18:00:02.000Z",
          evidence: "terminal_lifecycle",
          fingerprint: "turn-completed",
          phase: "completed",
          startedAt: null
        }
      }),
      awaitingChatReplySince: prompt.requestedAt,
      isInterruptingPrompt: false,
      isWaitingForChatReply: true,
      pendingChatPrompt: prompt,
      selectedSession: createReadOnlyTakenOverSession()
    });

    assert.deepEqual(action, {
      kind: "clear-completed",
      prompt
    });
  });

  it("shows waiting immediately after the source transcript confirms a sending prompt", () => {
    const prompt = {
      ...createWaitingPrompt(),
      status: "sending" as const
    };
    const selectedSession = createReadOnlyTakenOverSession();
    selectedSession.status = "running";
    selectedSession.replyState = {
      phase: "sending",
      promptText: prompt.text,
      requestedAt: prompt.requestedAt
    };

    const action = resolvePromptSessionSyncAction({
      activeTakenOverAgentSession: createAgentSession([
        {
          id: "entry-1",
          timestamp: "2026-07-29T18:00:01.000Z",
          role: "user",
          text: prompt.text,
          phase: null
        }
      ]),
      awaitingChatReplySince: null,
      isInterruptingPrompt: false,
      isWaitingForChatReply: false,
      pendingChatPrompt: prompt,
      selectedSession
    });

    assert.equal(action.kind, "mark-waiting");
    assert.equal(action.kind === "mark-waiting" && action.prompt.status, "waiting");
  });

  it("keeps a scoped waiting prompt when a takeover shell becomes read-only", () => {
    const prompt = createWaitingPrompt();
    const action = resolvePromptSessionSyncAction({
      activeTakenOverAgentSession: createAgentSession([
        {
          id: "entry-1",
          timestamp: "2026-07-29T18:00:01.000Z",
          role: "user",
          text: prompt.text,
          phase: null
        }
      ]),
      awaitingChatReplySince: prompt.requestedAt,
      isInterruptingPrompt: false,
      isWaitingForChatReply: true,
      pendingChatPrompt: prompt,
      selectedSession: createReadOnlyTakenOverSession()
    });

    assert.equal(action.kind, "none");
  });

  it("clears a read-only takeover waiting prompt after the source transcript has a reply", () => {
    const prompt = createWaitingPrompt();
    const action = resolvePromptSessionSyncAction({
      activeTakenOverAgentSession: createAgentSession([
        {
          id: "entry-1",
          timestamp: "2026-07-29T18:00:01.000Z",
          role: "user",
          text: prompt.text,
          phase: null
        },
        {
          id: "entry-2",
          timestamp: "2026-07-29T18:00:02.000Z",
          role: "assistant",
          text: "Done",
          phase: null
        }
      ]),
      awaitingChatReplySince: prompt.requestedAt,
      isInterruptingPrompt: false,
      isWaitingForChatReply: true,
      pendingChatPrompt: prompt,
      selectedSession: createReadOnlyTakenOverSession()
    });

    assert.equal(action.kind, "clear-completed");
  });
});
