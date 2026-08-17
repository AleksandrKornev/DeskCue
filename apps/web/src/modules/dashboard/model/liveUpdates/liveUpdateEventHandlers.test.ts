import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentSessionDetail,
  SessionSummary,
  ServerEvent
} from "@deskcue/protocol";
import {
  AGENT_SESSIONS_INVALIDATED_EVENT,
  AGENT_SESSION_SUMMARY_UPDATED_EVENT
} from "@models/agentSessions/contracts";
import type { DashboardStore } from "@modules/dashboard/model/store";

import { handleLiveUpdateEvent } from "./liveUpdateEventHandlers";

function createAgentSession(workState: "idle" | "running"): AgentSessionDetail {
  return {
    agentId: "codex",
    agentLabel: "Codex",
    attachMode: "read_only",
    attachModeReason: "Active in Codex Desktop",
    cliVersion: null,
    contextCompactionCount: 0,
    filePath: "C:\\temp\\source-1.jsonl",
    id: "codex:source-1",
    model: null,
    originator: "Codex Desktop",
    source: "vscode",
    sourceSessionId: "source-1",
    title: "Check Access tab e2e",
    transcript: [],
    turnState: {
      activityAt: "2026-07-31T10:00:00.000Z",
      evidence: "turn_lifecycle",
      fingerprint: "start-1",
      phase: "active",
      startedAt: "2026-07-31T10:00:00.000Z",
      completedAt: null
    },
    updatedAt: "2026-07-31T10:00:00.000Z",
    workState,
    workspaceName: "ExampleWorkspace",
    workspacePath: "C:\\projects\\ExampleWorkspace"
  };
}

function createManagedSourceSession(status: "running" | "read_only"): SessionSummary {
  return {
    adapterId: "claude-code",
    command: "claude --resume source-1 --print",
    exitCode: status === "running" ? null : 0,
    finishedAt: status === "running" ? null : "2026-07-31T10:00:05.000Z",
    git: {
      changedFiles: [],
      branch: "main",
      diff: "",
      isDirty: false,
      isGitRepo: true,
      lastUpdatedAt: "2026-07-31T10:00:05.000Z"
    },
    id: "managed-1",
    lastActivityAt: "2026-07-31T10:00:05.000Z",
    preview: { active: false, networkMode: "device-direct", port: null, targetUrl: null },
    replyState: {
      phase: "idle",
      promptText: null,
      requestedAt: null
    },
    sourceSessionId: "source-1",
    startedAt: "2026-07-31T10:00:00.000Z",
    status,
    workspaceId: "workspace-1",
    workspaceName: "ExampleWorkspace"
  };
}

test("streams frequent session summaries to the attention rail without HTTP invalidation", () => {
  const testWindow = new EventTarget();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: testWindow
  });
  let summaryUpdates = 0;
  let invalidations = 0;
  const countSummary = () => {
    summaryUpdates += 1;
  };
  const countInvalidation = () => {
    invalidations += 1;
  };
  window.addEventListener(AGENT_SESSION_SUMMARY_UPDATED_EVENT, countSummary);
  window.addEventListener(AGENT_SESSIONS_INVALIDATED_EVENT, countInvalidation);

  const store = {
    agentSessionsTotalCountExact: true,
    clearAgentSessionReadyForReview: () => undefined,
    mergeAgentSessionSummary: () => undefined,
    updateActiveTakenOverAgentSession: () => undefined,
    updateSelectedAgentSession: () => undefined
  } as unknown as DashboardStore;
  const common = {
    activeTabRef: { current: "overview" as const },
    activeTakenOverAgentSessionIdRef: { current: "" },
    loadSessionRef: { current: () => Promise.resolve(null) },
    refreshTakenOverTranscriptNow: () => undefined,
    scheduleSelectedAgentSessionRefresh: () => undefined,
    scheduleTakenOverTranscriptRefresh: () => undefined,
    selectedAgentSessionIdRef: { current: "" },
    selectedSessionIdRef: { current: "" },
    selectedSessionLogQueue: {
      flush: () => undefined,
      push: () => undefined,
      teardown: () => undefined
    },
    selectedSessionRef: { current: null },
    store
  };

  try {
    handleLiveUpdateEvent({
      ...common,
      event: {
        type: "agent.session.updated",
        payload: createAgentSession("running")
      } satisfies ServerEvent
    });
    handleLiveUpdateEvent({
      ...common,
      event: {
        type: "agent.session.updated",
        payload: {
          ...createAgentSession("running"),
          updatedAt: "2026-07-31T10:00:01.000Z"
        }
      } satisfies ServerEvent
    });
    handleLiveUpdateEvent({
      ...common,
      event: {
        type: "agent.session.transcript.updated",
        payload: {
          agentId: "codex",
          agentLabel: "Codex",
          agentSessionId: "codex:source-1",
          latestEntryId: "entry-1",
          sourceSessionId: "source-1",
          transcriptLength: 1,
          turnState: createAgentSession("running").turnState,
          updatedAt: "2026-07-31T10:00:01.000Z",
          workState: "running"
        }
      } satisfies ServerEvent
    });
  } finally {
    window.removeEventListener(AGENT_SESSION_SUMMARY_UPDATED_EVENT, countSummary);
    window.removeEventListener(AGENT_SESSIONS_INVALIDATED_EVENT, countInvalidation);
    Reflect.deleteProperty(globalThis, "window");
  }

  assert.equal(summaryUpdates, 2);
  assert.equal(invalidations, 0);
});

test("does not invalidate counts for repeated unseen live summaries", () => {
  const testWindow = new EventTarget();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: testWindow
  });
  let invalidations = 0;
  const countInvalidation = () => {
    invalidations += 1;
  };
  window.addEventListener(AGENT_SESSIONS_INVALIDATED_EVENT, countInvalidation);

  const mutableStore = {
    agentSessionsTotalCountExact: true,
    clearAgentSessionReadyForReview: () => undefined,
    mergeAgentSessionSummary: () => {
      mutableStore.agentSessionsTotalCountExact = false;
    }
  };
  const store = mutableStore as unknown as DashboardStore;

  try {
    handleLiveUpdateEvent({
      activeTabRef: { current: "overview" },
      activeTakenOverAgentSessionIdRef: { current: "" },
      event: {
        type: "agent.session.updated",
        payload: createAgentSession("running")
      } satisfies ServerEvent,
      loadSessionRef: { current: () => Promise.resolve(null) },
      refreshTakenOverTranscriptNow: () => undefined,
      scheduleSelectedAgentSessionRefresh: () => undefined,
      scheduleTakenOverTranscriptRefresh: () => undefined,
      selectedAgentSessionIdRef: { current: "" },
      selectedSessionIdRef: { current: "" },
      selectedSessionLogQueue: {
        flush: () => undefined,
        push: () => undefined,
        teardown: () => undefined
      },
      selectedSessionRef: { current: null },
      store
    });
    handleLiveUpdateEvent({
      activeTabRef: { current: "overview" },
      activeTakenOverAgentSessionIdRef: { current: "" },
      event: {
        type: "agent.session.updated",
        payload: {
          ...createAgentSession("running"),
          id: "claude-code:source-2",
          agentId: "claude-code",
          agentLabel: "Claude Code",
          sourceSessionId: "source-2"
        }
      } satisfies ServerEvent,
      loadSessionRef: { current: () => Promise.resolve(null) },
      refreshTakenOverTranscriptNow: () => undefined,
      scheduleSelectedAgentSessionRefresh: () => undefined,
      scheduleTakenOverTranscriptRefresh: () => undefined,
      selectedAgentSessionIdRef: { current: "" },
      selectedSessionIdRef: { current: "" },
      selectedSessionLogQueue: {
        flush: () => undefined,
        push: () => undefined,
        teardown: () => undefined
      },
      selectedSessionRef: { current: null },
      store
    });
  } finally {
    window.removeEventListener(AGENT_SESSIONS_INVALIDATED_EVENT, countInvalidation);
    Reflect.deleteProperty(globalThis, "window");
  }

  assert.equal(invalidations, 0);
});

test("applies a stale terminal update for the active turn without moving updatedAt backward", () => {
  let activeSession: AgentSessionDetail | null = {
    ...createAgentSession("running"),
    updatedAt: "2026-07-31T10:00:10.000Z"
  };
  const scheduledRefreshes: Array<[string | null | undefined, unknown]> = [];
  const immediateRefreshes: Array<[string | null | undefined, unknown]> = [];
  const store = {
    clearAgentSessionReadyForReview: () => undefined,
    updateActiveTakenOverAgentSession: (
      updater: (current: AgentSessionDetail | null) => AgentSessionDetail | null
    ) => {
      activeSession = updater(activeSession);
    },
    updateSelectedAgentSession: () => undefined
  } as unknown as DashboardStore;

  handleLiveUpdateEvent({
    activeTabRef: { current: "overview" },
    activeTakenOverAgentSessionIdRef: { current: "codex:source-1" },
    event: {
        type: "agent.session.transcript.updated",
        payload: {
          agentId: "codex",
          agentLabel: "Codex",
          agentSessionId: "codex:source-1",
          latestEntryId: "terminal-1",
          sourceSessionId: "source-1",
          transcriptLength: 3,
          turnState: {
            activityAt: "2026-07-31T10:00:05.000Z",
            completedAt: "2026-07-31T10:00:05.000Z",
            evidence: "terminal_lifecycle",
            fingerprint: "start-1",
            phase: "interrupted",
            startedAt: "2026-07-31T10:00:00.000Z"
          },
          updatedAt: "2026-07-31T10:00:05.000Z",
          workState: "idle"
        }
    } satisfies ServerEvent,
    loadSessionRef: { current: () => Promise.resolve(null) },
    refreshTakenOverTranscriptNow: (updatedAt, options) => {
      immediateRefreshes.push([updatedAt, options]);
    },
    scheduleSelectedAgentSessionRefresh: () => undefined,
    scheduleTakenOverTranscriptRefresh: (updatedAt, options) => {
      scheduledRefreshes.push([updatedAt, options]);
    },
    selectedAgentSessionIdRef: { current: "" },
    selectedSessionIdRef: { current: "managed-1" },
    selectedSessionLogQueue: {
      flush: () => undefined,
      push: () => undefined,
      teardown: () => undefined
    },
    selectedSessionRef: { current: null },
    store
  });

  assert.equal(activeSession?.workState, "idle");
  assert.equal(activeSession?.turnState?.phase, "interrupted");
  assert.equal(activeSession?.updatedAt, "2026-07-31T10:00:10.000Z");
  assert.deepEqual(scheduledRefreshes, []);
  assert.deepEqual(immediateRefreshes, [
    ["2026-07-31T10:00:05.000Z", {
      allowDuringPromptPolling: true,
      fullTranscript: true
    }]
  ]);
});

test("does not apply a stale terminal update from a previous turn", () => {
  let activeSession: AgentSessionDetail | null = {
    ...createAgentSession("running"),
    updatedAt: "2026-07-31T10:00:10.000Z",
    turnState: {
      activityAt: "2026-07-31T10:00:10.000Z",
      completedAt: null,
      evidence: "turn_lifecycle",
      fingerprint: "new-turn",
      phase: "active",
      startedAt: "2026-07-31T10:00:09.000Z"
    }
  };
  const store = {
    clearAgentSessionReadyForReview: () => undefined,
    updateActiveTakenOverAgentSession: (
      updater: (current: AgentSessionDetail | null) => AgentSessionDetail | null
    ) => {
      activeSession = updater(activeSession);
    },
    updateSelectedAgentSession: () => undefined
  } as unknown as DashboardStore;

  handleLiveUpdateEvent({
    activeTabRef: { current: "overview" },
    activeTakenOverAgentSessionIdRef: { current: "codex:source-1" },
    event: {
      type: "agent.session.transcript.updated",
      payload: {
        agentId: "codex",
        agentLabel: "Codex",
        agentSessionId: "codex:source-1",
        latestEntryId: "old-terminal",
        sourceSessionId: "source-1",
        transcriptLength: 3,
        turnState: {
          activityAt: "2026-07-31T10:00:05.000Z",
          completedAt: "2026-07-31T10:00:05.000Z",
          evidence: "terminal_lifecycle",
          fingerprint: "old-turn",
          phase: "completed",
          startedAt: "2026-07-31T10:00:00.000Z"
        },
        updatedAt: "2026-07-31T10:00:05.000Z",
        workState: "idle"
      }
    } satisfies ServerEvent,
    loadSessionRef: { current: () => Promise.resolve(null) },
    refreshTakenOverTranscriptNow: () => undefined,
    scheduleSelectedAgentSessionRefresh: () => undefined,
    scheduleTakenOverTranscriptRefresh: () => undefined,
    selectedAgentSessionIdRef: { current: "" },
    selectedSessionIdRef: { current: "managed-1" },
    selectedSessionLogQueue: {
      flush: () => undefined,
      push: () => undefined,
      teardown: () => undefined
    },
    selectedSessionRef: { current: null },
    store
  });

  assert.equal(activeSession?.workState, "running");
  assert.equal(activeSession?.turnState?.fingerprint, "new-turn");
});

test("fully refreshes the active source transcript after a terminal session update", () => {
  const immediateRefreshes: Array<[string | null | undefined, unknown]> = [];
  const scheduledRefreshes: Array<[string | null | undefined, unknown]> = [];
  const store = {
    mergeOverviewSession: () => undefined,
    mergeSelectedSessionSummary: () => undefined
  } as unknown as DashboardStore;

  handleLiveUpdateEvent({
    activeTabRef: { current: "overview" },
    activeTakenOverAgentSessionIdRef: { current: "claude-code:source-1" },
    event: {
      type: "session.updated",
      payload: createManagedSourceSession("read_only")
    } satisfies ServerEvent,
    loadSessionRef: { current: () => Promise.resolve(null) },
    refreshTakenOverTranscriptNow: (updatedAt, options) => {
      immediateRefreshes.push([updatedAt, options]);
    },
    scheduleSelectedAgentSessionRefresh: () => undefined,
    scheduleTakenOverTranscriptRefresh: (updatedAt, options) => {
      scheduledRefreshes.push([updatedAt, options]);
    },
    selectedAgentSessionIdRef: { current: "claude-code:source-1" },
    selectedSessionIdRef: { current: "managed-1" },
    selectedSessionLogQueue: {
      flush: () => undefined,
      push: () => undefined,
      teardown: () => undefined
    },
    selectedSessionRef: { current: createManagedSourceSession("running") as never },
    store
  });

  assert.deepEqual(scheduledRefreshes, []);
  assert.deepEqual(immediateRefreshes, [
    [undefined, {
      allowDuringPromptPolling: true,
      fullTranscript: true
    }]
  ]);
});

test("fully refreshes the matching active source transcript once after its turn finishes", () => {
  const immediateRefreshes: Array<[string | null | undefined, unknown]> = [];
  const scheduledRefreshes: Array<[string | null | undefined, unknown]> = [];
  const store = {
    markAgentSessionReviewedAt: () => undefined
  } as unknown as DashboardStore;

  handleLiveUpdateEvent({
    activeTabRef: { current: "overview" },
    activeTakenOverAgentSessionIdRef: { current: "codex:source-1" },
    event: {
      type: "agent.session.turn.finished",
      payload: {
        agentId: "codex",
        agentLabel: "Codex",
        agentSessionId: "codex:source-1",
        completedAt: "2026-07-31T10:00:05.000Z",
        sourceSessionId: "source-1",
        status: "completed",
        title: "Check Access tab e2e",
        workspaceName: "ExampleWorkspace",
        workspacePath: "C:\\projects\\ExampleWorkspace"
      }
    } satisfies ServerEvent,
    loadSessionRef: { current: () => Promise.resolve(null) },
    refreshTakenOverTranscriptNow: (updatedAt, options) => {
      immediateRefreshes.push([updatedAt, options]);
    },
    scheduleSelectedAgentSessionRefresh: () => undefined,
    scheduleTakenOverTranscriptRefresh: (updatedAt, options) => {
      scheduledRefreshes.push([updatedAt, options]);
    },
    selectedAgentSessionIdRef: { current: "codex:source-1" },
    selectedSessionIdRef: { current: "managed-1" },
    selectedSessionLogQueue: {
      flush: () => undefined,
      push: () => undefined,
      teardown: () => undefined
    },
    selectedSessionRef: { current: createManagedSourceSession("running") as never },
    store
  });

  const expectedOptions = {
    allowDuringPromptPolling: true,
    force: true,
    fullTranscript: true
  };
  assert.deepEqual(immediateRefreshes, [[undefined, expectedOptions]]);
  assert.deepEqual(scheduledRefreshes, []);
});

test("does not refresh the active transcript when a background source turn finishes", () => {
  const immediateRefreshes: Array<[string | null | undefined, unknown]> = [];
  const scheduledRefreshes: Array<[string | null | undefined, unknown]> = [];
  const store = {
    markAgentSessionReadyForReview: () => undefined
  } as unknown as DashboardStore;

  handleLiveUpdateEvent({
    activeTabRef: { current: "overview" },
    activeTakenOverAgentSessionIdRef: { current: "codex:active-source" },
    event: {
      type: "agent.session.turn.finished",
      payload: {
        agentId: "claude-code",
        agentLabel: "Claude Code",
        agentSessionId: "claude-code:background-source",
        completedAt: "2026-07-31T10:00:05.000Z",
        sourceSessionId: "background-source",
        status: "completed",
        title: "Background chat",
        workspaceName: "ExampleWorkspace",
        workspacePath: "C:\\projects\\ExampleWorkspace"
      }
    } satisfies ServerEvent,
    loadSessionRef: { current: () => Promise.resolve(null) },
    refreshTakenOverTranscriptNow: (updatedAt, options) => {
      immediateRefreshes.push([updatedAt, options]);
    },
    scheduleSelectedAgentSessionRefresh: () => undefined,
    scheduleTakenOverTranscriptRefresh: (updatedAt, options) => {
      scheduledRefreshes.push([updatedAt, options]);
    },
    selectedAgentSessionIdRef: { current: "codex:active-source" },
    selectedSessionIdRef: { current: "managed-1" },
    selectedSessionLogQueue: {
      flush: () => undefined,
      push: () => undefined,
      teardown: () => undefined
    },
    selectedSessionRef: { current: createManagedSourceSession("running") as never },
    store
  });

  assert.deepEqual(immediateRefreshes, []);
  assert.deepEqual(scheduledRefreshes, []);
});
