import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionSummary } from "@deskcue/protocol";

import {
  resolveInputAvailability,
  resolvePendingChatPrompt,
  resolvePromptInFlight,
  resolveShellWaitingPrompt,
  shouldShowManagedSessionChatLoading
} from "./helpers";

const requestedAt = "2026-07-29T18:00:00.000Z";

function createSessionShell(patch: Partial<SessionSummary>): SessionSummary {
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
    ...patch
  };
}

function transcriptUser(id: string, text: string) {
  return {
    id,
    phase: null,
    role: "user" as const,
    text,
    timestamp: requestedAt
  };
}

describe("managed session reply state helpers", () => {
  it("restores the pending prompt bubble from a read-only waiting source shell", () => {
    const sessionShell = createSessionShell({
      replyState: {
        phase: "waiting",
        promptText: "Continue work",
        requestedAt
      },
      status: "read_only"
    });

    const result = resolvePendingChatPrompt({
      chatTranscriptEntries: [],
      isPromptTrackableSessionShell: true,
      pendingChatPrompt: null,
      selectedSessionDetail: null,
      selectedSessionId: "session-1",
      sessionShell
    });

    assert.deepEqual(result.displayedPendingChatPrompt, {
      text: "Continue work",
      requestedAt,
      status: "waiting"
    });
  });

  it("keeps a just-sent client prompt without comparing browser and daemon clocks", () => {
    const sessionShell = createSessionShell({
      replyState: {
        phase: "waiting",
        promptText: "Previous prompt",
        requestedAt
      },
      status: "read_only"
    });

    const result = resolvePendingChatPrompt({
      chatTranscriptEntries: [],
      isPromptTrackableSessionShell: true,
      pendingChatPrompt: {
        sessionId: "session-1",
        status: "sending",
        text: "New prompt",
        requestedAt: "2026-07-29T17:59:00.000Z"
      },
      selectedSessionDetail: null,
      selectedSessionId: "session-1",
      sessionShell
    });

    assert.deepEqual(result.rawPendingChatPrompt, {
      sessionId: "session-1",
      status: "sending",
      text: "New prompt",
      requestedAt: "2026-07-29T17:59:00.000Z"
    });
    assert.equal(result.displayedPendingChatPrompt?.text, "New prompt");
  });

  it("prefers the shell over a stale waiting prompt even when the browser clock is ahead", () => {
    const sessionShell = createSessionShell({
      replyState: {
        phase: "waiting",
        promptText: "Current shell prompt",
        requestedAt
      },
      status: "read_only"
    });

    const result = resolvePendingChatPrompt({
      chatTranscriptEntries: [],
      isPromptTrackableSessionShell: true,
      pendingChatPrompt: {
        sessionId: "session-1",
        status: "waiting",
        text: "Stale browser prompt",
        requestedAt: "2026-07-29T19:00:00.000Z"
      },
      selectedSessionDetail: null,
      selectedSessionId: "session-1",
      sessionShell
    });

    assert.equal(result.rawPendingChatPrompt?.text, "Current shell prompt");
  });

  it("uses transcript order when a confirmed client wait is newer than the shell", () => {
    const sessionShell = createSessionShell({
      replyState: {
        phase: "waiting",
        promptText: "Previous shell prompt",
        requestedAt
      },
      status: "read_only"
    });

    const result = resolvePendingChatPrompt({
      chatTranscriptEntries: [
        transcriptUser("previous", "Previous shell prompt"),
        transcriptUser("current", "Confirmed client prompt")
      ],
      isPromptTrackableSessionShell: true,
      pendingChatPrompt: {
        sessionId: "session-1",
        status: "waiting",
        text: "Confirmed client prompt",
        requestedAt: "2026-07-29T17:59:00.000Z"
      },
      selectedSessionDetail: null,
      selectedSessionId: "session-1",
      sessionShell
    });

    assert.equal(result.rawPendingChatPrompt?.text, "Confirmed client prompt");
  });

  it("keeps waiting active for a read-only waiting source shell", () => {
    const sessionShell = createSessionShell({
      replyState: {
        phase: "waiting",
        promptText: "Continue work",
        requestedAt
      },
      status: "read_only"
    });

    const prompt = resolveShellWaitingPrompt({
      isPromptTrackableSessionShell: true,
      sessionShell
    });

    assert.deepEqual(prompt, {
      text: "Continue work",
      requestedAt,
      status: "waiting"
    });
  });

  it("marks an externally started source turn as interruptible without inventing a waiting prompt", () => {
    assert.equal(resolvePromptInFlight({
      hasActivePendingPrompt: false,
      isInterruptingPrompt: false,
      isSourceSessionWorking: true,
      isWaitingForChatReply: false,
      suppressWaitingForInterruptLifecycle: false
    }), true);
  });

  it("permits a DeskCue-owned read-only shell only when the explicit capability is set", () => {
    const localChatShell = createSessionShell({
      canSendInput: false,
      sourceSessionId: null,
      status: "read_only"
    });

    assert.equal(resolveInputAvailability(localChatShell).canSendInput, false);
    assert.equal(resolveInputAvailability(localChatShell, {
      canSendInputWhenReadOnly: true
    }).canSendInput, true);
  });

  it("keeps the transcript skeleton during reload even when a pending prompt is restored", () => {
    assert.equal(shouldShowManagedSessionChatLoading({
      hasConversationContent: false,
      hasPendingPrompt: true,
      isInterruptingPrompt: false,
      isSessionShellLoading: false,
      isTranscriptLoading: true,
      isTranscriptSyncing: false,
      isWaitingForChatReply: true,
      suppressWaitingForInterruptLifecycle: false
    }), true);
  });

  it("renders the pending prompt after the transcript load finishes", () => {
    assert.equal(shouldShowManagedSessionChatLoading({
      hasConversationContent: false,
      hasPendingPrompt: true,
      isInterruptingPrompt: false,
      isSessionShellLoading: false,
      isTranscriptLoading: false,
      isTranscriptSyncing: false,
      isWaitingForChatReply: true,
      suppressWaitingForInterruptLifecycle: false
    }), false);
  });
});
