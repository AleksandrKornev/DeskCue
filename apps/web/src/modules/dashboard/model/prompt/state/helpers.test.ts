import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentSessionDetail, SessionDetail } from "@deskcue/protocol";

import {
  buildReplyStateDrivenPendingChatPrompt,
  resolveEffectivePromptState,
  shouldClearLocalInterruptForSourceState
} from "./helpers";
import type { LocalInterruptMarker } from "./helpers";

const requestedAt = "2026-07-29T18:00:00.000Z";

function createSession(patch: Partial<SessionDetail>): SessionDetail {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    adapterId: "codex",
    sourceSessionId: "source-1",
    command: "codex",
    status: "running",
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
    inputHistory: [],
    ...patch
  };
}

function createInterruptMarker(): LocalInterruptMarker {
  return {
    managedSessionId: "session-1",
    sourceSessionId: "source-1",
    priorInterruptRequestedAt: "2026-07-31T10:59:00.000Z",
    priorInterruptTurnFingerprint: "older-turn",
    priorTurnCompletedAt: "2026-07-31T10:59:30.000Z",
    priorTurnFingerprint: "older-turn"
  };
}

function createAgentSession(
  patch: Partial<AgentSessionDetail>
): Pick<AgentSessionDetail, "sourceSessionId" | "interruptLifecycle" | "turnState"> {
  return {
    sourceSessionId: "source-1",
    interruptLifecycle: undefined,
    turnState: undefined,
    ...patch
  };
}

describe("dashboard prompt state helpers", () => {
  it("waits for source state that differs from the snapshot before interrupt", () => {
    const marker = createInterruptMarker();

    assert.equal(shouldClearLocalInterruptForSourceState(marker, createAgentSession({
      interruptLifecycle: {
        phase: "confirmed",
        requestedAt: marker.priorInterruptRequestedAt,
        confirmedAt: "2026-07-31T11:00:01.000Z",
        turnFingerprint: marker.priorInterruptTurnFingerprint,
        confirmation: "source_terminal",
        outcome: "interrupted"
      },
      turnState: {
        phase: "interrupted",
        fingerprint: marker.priorTurnFingerprint,
        startedAt: null,
        completedAt: marker.priorTurnCompletedAt,
        activityAt: null,
        evidence: "terminal_lifecycle"
      }
    })), false);
    assert.equal(shouldClearLocalInterruptForSourceState(marker, createAgentSession({
      interruptLifecycle: {
        phase: "requested",
        requestedAt: "2026-07-31T11:00:00.101Z",
        confirmedAt: null,
        turnFingerprint: "current-turn",
        confirmation: null,
        outcome: null
      }
    })), false);
    assert.equal(shouldClearLocalInterruptForSourceState(marker, createAgentSession({
      interruptLifecycle: {
        phase: "confirmed",
        requestedAt: "2026-07-31T11:00:00.101Z",
        confirmedAt: "2026-07-31T11:00:01.000Z",
        turnFingerprint: "current-turn",
        confirmation: "source_terminal",
        outcome: "interrupted"
      }
    })), true);
    assert.equal(shouldClearLocalInterruptForSourceState(marker, createAgentSession({
      interruptLifecycle: {
        phase: "unresolved",
        requestedAt: "2026-07-31T11:00:00.101Z",
        confirmedAt: "2026-07-31T11:00:20.000Z",
        turnFingerprint: "current-turn",
        confirmation: "managed_transport",
        outcome: null
      }
    })), true);
    assert.equal(shouldClearLocalInterruptForSourceState(marker, createAgentSession({
      turnState: {
        phase: "interrupted",
        fingerprint: "current-turn",
        startedAt: null,
        completedAt: "2026-07-31T11:00:01.000Z",
        activityAt: null,
        evidence: "terminal_lifecycle"
      }
    })), true);
    assert.equal(shouldClearLocalInterruptForSourceState(marker, createAgentSession({
      sourceSessionId: "other-source"
    })), false);
  });

  it("keeps reply-state prompts from read-only attached sessions", () => {
    const session = createSession({
      replyState: {
        phase: "waiting",
        promptText: "Continue work",
        requestedAt
      },
      status: "read_only"
    });

    const prompt = buildReplyStateDrivenPendingChatPrompt(session, null);

    assert.deepEqual(prompt, {
      text: "Continue work",
      requestedAt,
      sessionId: "session-1",
      sourceSessionId: "source-1",
      status: "waiting"
    });
  });

  it("treats read-only attached reply-state waiting as active waiting", () => {
    const session = createSession({
      replyState: {
        phase: "waiting",
        promptText: "Continue work",
        requestedAt
      },
      status: "read_only"
    });
    const replyStatePrompt = buildReplyStateDrivenPendingChatPrompt(session, null);

    const result = resolveEffectivePromptState({
      awaitingChatReplySince: null,
      isWaitingForChatReply: false,
      pendingChatPrompt: null,
      replyStateDrivenPendingChatPrompt: replyStatePrompt,
      selectedSession: session
    });

    assert.equal(result.effectiveIsWaitingForChatReply, true);
    assert.equal(result.effectivePendingChatPrompt?.text, "Continue work");
  });
});
