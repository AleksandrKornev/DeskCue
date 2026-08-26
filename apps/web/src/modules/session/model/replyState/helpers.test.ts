import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentSessionDetail, AgentSessionSummary, SessionSummary } from "@deskcue/protocol";

import {
  isConfirmedDeskCuePendingPrompt,
  isManagedSourceReplyWaiting,
  isManagedSourceSessionWorking,
  isSourceTurnOutsideDeskCue,
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
  it("ignores stale active source metadata after the managed transport is done", () => {
    const activeSource = {
      turnState: { phase: "active" },
      workState: "running"
    } as AgentSessionDetail;

    assert.equal(isManagedSourceSessionWorking(
      createSessionShell({ status: "done" }),
      activeSource
    ), false);
    assert.equal(isManagedSourceSessionWorking(
      createSessionShell({ status: "stopped" }),
      activeSource
    ), false);
    assert.equal(isManagedSourceSessionWorking(
      createSessionShell({ status: "running" }),
      activeSource
    ), true);
    assert.equal(isManagedSourceSessionWorking(
      createSessionShell({ status: "read_only" }),
      activeSource
    ), true);
  });

  it("uses a newer terminal source summary instead of stale active detail", () => {
    const activeSource = {
      attachMode: "resume",
      turnState: {
        activityAt: "2026-07-29T18:00:00.000Z",
        completedAt: null,
        evidence: "recent_non_final_activity",
        fingerprint: "start-1",
        phase: "active",
        startedAt: "2026-07-29T18:00:00.000Z"
      },
      workState: "running"
    } as AgentSessionDetail;
    const terminalSummary = {
      ...activeSource,
      turnState: {
        activityAt: null,
        completedAt: "2026-07-29T18:00:05.000Z",
        evidence: "terminal_lifecycle",
        fingerprint: "terminal-1",
        phase: "completed",
        startedAt: null
      },
      workState: "idle"
    } as AgentSessionSummary;

    assert.equal(isManagedSourceSessionWorking(
      createSessionShell({ status: "read_only" }),
      activeSource,
      terminalSummary
    ), false);
  });

  it("does not treat an outcome-unknown prompt as DeskCue-owned control", () => {
    assert.equal(isConfirmedDeskCuePendingPrompt({
      sessionId: "session-1",
      status: "not_confirmed",
      text: "Ambiguous prompt",
      requestedAt
    }), false);
    assert.equal(isConfirmedDeskCuePendingPrompt({
      sessionId: "session-1",
      status: "waiting",
      text: "Confirmed prompt",
      requestedAt
    }), true);
  });

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

  it("restores waiting for passive clients from the managed source lifecycle", () => {
    assert.equal(isManagedSourceReplyWaiting(
      createSessionShell({ status: "running" })
    ), true);
    assert.equal(isManagedSourceReplyWaiting(
      createSessionShell({ status: "read_only" })
    ), false);
    assert.equal(isManagedSourceReplyWaiting({
      ...createSessionShell({ status: "running" }),
      sourceSessionId: null
    }), false);
  });

  it("recognizes an externally controlled source turn without depending on the agent adapter", () => {
    const sourceSession = { attachMode: "read_only" as const };
    const options = {
      hasDeskCuePrompt: false,
      hasPromptRecovery: false,
      hasWaitingPrompt: false,
      isSourceSessionWorking: true
    };

    assert.equal(isSourceTurnOutsideDeskCue(
      createSessionShell({ adapterId: "codex", status: "read_only" }),
      sourceSession,
      options
    ), true);
    assert.equal(isSourceTurnOutsideDeskCue(
      createSessionShell({ adapterId: "claude-code", status: "read_only" }),
      sourceSession,
      options
    ), true);
  });

  it("does not call a DeskCue-owned or recovering source turn external", () => {
    const sessionShell = createSessionShell({ status: "read_only" });

    assert.equal(isSourceTurnOutsideDeskCue(
      sessionShell,
      { attachMode: "resume" },
      {
        hasDeskCuePrompt: false,
        hasPromptRecovery: false,
        hasWaitingPrompt: false,
        isSourceSessionWorking: true
      }
    ), false);
    assert.equal(isSourceTurnOutsideDeskCue(
      sessionShell,
      { attachMode: "read_only" },
      {
        hasDeskCuePrompt: true,
        hasPromptRecovery: false,
        hasWaitingPrompt: false,
        isSourceSessionWorking: true
      }
    ), false);
    assert.equal(isSourceTurnOutsideDeskCue(
      sessionShell,
      { attachMode: "read_only" },
      {
        hasDeskCuePrompt: false,
        hasPromptRecovery: true,
        hasWaitingPrompt: false,
        isSourceSessionWorking: true
      }
    ), false);
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
    assert.equal(resolveInputAvailability(localChatShell, {
      blockExternalSourceInput: true,
      canSendInputWhenReadOnly: true
    }).canSendInput, false);
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
