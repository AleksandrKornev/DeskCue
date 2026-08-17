import { isAction } from "mobx";
import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentSessionSummary,
  OverviewResponse,
  ServerEvent,
  SessionSummary
} from "@deskcue/protocol";
import {
  LIVE_UPDATES_OFFLINE_MESSAGE,
  LIVE_UPDATES_RECONNECT_MESSAGE
} from "@models/liveUpdatesConnection";
import { handleLiveUpdateEvent } from "@modules/dashboard/model/liveUpdates/liveUpdateEventHandlers";

import { DashboardStore } from "./dashboardStore";

function createStore() {
  return new DashboardStore({}, {
    suppressAgentSessionAutoSelect: true,
    suppressManagedSessionAutoSelect: true
  });
}

function transcriptEntry(id: string, text: string) {
  return {
    id,
    isCompact: false,
    phase: null,
    role: "assistant" as const,
    text,
    timestamp: "2026-08-06T10:00:00.000Z"
  };
}

function createAgentSession(
  agentId: "codex" | "claude-code",
  sourceSessionId: string
): AgentSessionSummary {
  return {
    agentId,
    agentLabel: agentId === "codex" ? "Codex" : "Claude Code",
    attachMode: "resume",
    cliVersion: null,
    contextCompactionCount: 0,
    filePath: `C:\\temp\\${sourceSessionId}.jsonl`,
    id: `${agentId}:${sourceSessionId}`,
    model: null,
    originator: null,
    reviewedAt: null,
    source: null,
    sourceSessionId,
    title: "Architecture regression",
    updatedAt: "2026-08-05T10:00:00.000Z",
    workState: "idle",
    workspaceName: "ExampleWorkspace",
    workspacePath: "C:\\projects\\ExampleWorkspace"
  };
}

function createOverview(sessions: SessionSummary[]): OverviewResponse {
  return {
    clientContext: { canOpenNativeDialogs: false },
    sessions,
    workspaces: []
  };
}

function createManagedSession(id: string, lastActivityAt: string): SessionSummary {
  return {
    adapterId: "codex",
    command: "codex",
    exitCode: null,
    finishedAt: null,
    git: {
      branch: null,
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: false,
      lastUpdatedAt: lastActivityAt
    },
    id,
    lastActivityAt,
    preview: {
      active: false,
      networkMode: "device-direct",
      artifacts: [],
      port: null,
      targetUrl: null
    },
    replyState: {
      phase: "idle",
      promptText: null,
      requestedAt: null
    },
    sourceSessionId: id,
    startedAt: lastActivityAt,
    status: "running",
    workspaceId: "workspace-1",
    workspaceName: "Workspace"
  };
}

test("keeps selection methods as MobX actions while composing agent-session state", () => {
  const store = createStore();
  const codex = createAgentSession("codex", "source-1");
  const claude = createAgentSession("claude-code", "source-2");

  assert.equal(isAction(store.setAgentSessions), true);
  assert.equal(isAction(store.setSelectedSourceId), true);

  store.setAgentSessions([codex, claude]);
  store.setSelectedSourceId("claude-code");
  store.setSelectedAgentSessionId(claude.id);
  store.setSelectedAgentSession({ ...claude, transcript: [] });

  assert.deepEqual(store.filteredAgentSessions.map((session) => session.id), [claude.id]);
  assert.equal(store.selectedAgentSessionId, claude.id);
  assert.equal(store.selectedAgentSession?.id, claude.id);
  assert.equal(store.agentSessionsLoadState, "ready");
});

test("does not merge a late selected source detail after selecting another session", () => {
  const store = createStore();
  const first = createAgentSession("codex", "source-1");
  const second = createAgentSession("claude-code", "source-2");
  store.setSelectedAgentSessionId(first.id);
  store.setSelectedAgentSession({ ...first, transcript: [] });
  store.setSelectedAgentSessionId(second.id);
  store.setSelectedAgentSession({ ...second, transcript: [] });

  store.mergeSelectedAgentSessionDetail({
    ...first,
    transcript: [transcriptEntry("stale", "stale")]
  });

  assert.equal(store.selectedAgentSession?.id, second.id);
  assert.deepEqual(store.selectedAgentSession?.transcript, []);
});

test("does not replace the active taken-over detail with a late response for another session", () => {
  const store = createStore();
  const first = createAgentSession("codex", "source-1");
  const second = createAgentSession("claude-code", "source-2");
  store.setActiveTakenOverAgentSession({ ...second, transcript: [] });

  store.mergeActiveTakenOverAgentSessionDetail({
    ...first,
    transcript: [transcriptEntry("stale", "stale")]
  });

  assert.equal(store.activeTakenOverAgentSession?.id, second.id);
  assert.deepEqual(store.activeTakenOverAgentSession?.transcript, []);
});

test("reconciles a stale terminal live event for the active turn and requests a full refresh", () => {
  const store = createStore();
  store.setActiveTakenOverAgentSession({
    ...createAgentSession("codex", "source-1"),
    transcript: [],
    updatedAt: "2026-08-05T10:00:10.000Z",
    workState: "running",
    turnState: {
      activityAt: "2026-08-05T10:00:10.000Z",
      completedAt: null,
      evidence: "turn_lifecycle",
      fingerprint: "turn-1",
      phase: "active",
      startedAt: "2026-08-05T10:00:00.000Z"
    }
  });
  const immediateRefreshes: Array<[string | null | undefined, unknown]> = [];

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
        transcriptLength: 2,
        turnState: {
          activityAt: "2026-08-05T10:00:05.000Z",
          completedAt: "2026-08-05T10:00:05.000Z",
          evidence: "terminal_lifecycle",
          fingerprint: "turn-1",
          phase: "interrupted",
          startedAt: "2026-08-05T10:00:00.000Z"
        },
        updatedAt: "2026-08-05T10:00:05.000Z",
        workState: "idle"
      }
    } satisfies ServerEvent,
    loadSessionRef: { current: () => Promise.resolve(null) },
    refreshTakenOverTranscriptNow: (updatedAt, options) => {
      immediateRefreshes.push([updatedAt, options]);
    },
    scheduleSelectedAgentSessionRefresh: () => {},
    scheduleTakenOverTranscriptRefresh: () => {
      assert.fail("terminal update must not use the throttled partial refresh");
    },
    selectedAgentSessionIdRef: { current: "" },
    selectedSessionIdRef: { current: "" },
    selectedSessionLogQueue: {
      flush: () => {},
      push: () => {},
      teardown: () => {}
    },
    selectedSessionRef: { current: null },
    store
  });

  assert.equal(store.activeTakenOverAgentSession?.workState, "idle");
  assert.equal(store.activeTakenOverAgentSession?.turnState?.phase, "interrupted");
  assert.equal(store.activeTakenOverAgentSession?.updatedAt, "2026-08-05T10:00:10.000Z");
  assert.deepEqual(immediateRefreshes, [[
    "2026-08-05T10:00:05.000Z",
    { allowDuringPromptPolling: true, fullTranscript: true }
  ]]);
});

test("preserves live refresh timestamp across reconnecting and offline transitions", () => {
  const store = createStore();
  const syncedAt = "2026-08-05T10:00:00.000Z";

  store.markLiveUpdatesSynced(syncedAt);
  store.setLiveUpdatesReconnecting();
  assert.deepEqual(store.liveUpdatesConnection, {
    status: "reconnecting",
    lastSyncedAt: syncedAt
  });

  store.setLiveUpdatesOffline();
  assert.deepEqual(store.liveUpdatesConnection, {
    status: "offline",
    lastSyncedAt: syncedAt
  });
});

test("clears transient reconnect and offline messages after live updates resume", () => {
  const store = createStore();

  for (const message of [LIVE_UPDATES_RECONNECT_MESSAGE, LIVE_UPDATES_OFFLINE_MESSAGE]) {
    store.setError(message);
    store.clearLiveUpdatesReconnectError();
    assert.equal(store.error, "");
  }
});

test("clears every connection-scoped projection before another daemon can hydrate", () => {
  const store = createStore();
  const session = createAgentSession("codex", "source-1");
  store.setAgentSessions([session]);
  store.setSelectedSourceId("codex");
  store.setSelectedAgentSessionId(session.id);
  store.setSelectedAgentSession({ ...session, transcript: [] });
  store.setSelectedSessionId("managed-1");
  store.setError("old daemon failed");
  store.markLiveUpdatesSynced("2026-08-06T10:00:00.000Z");
  const previousAttempt = store.eventStreamAttempt;

  store.resetConnectionScopedState();

  assert.deepEqual(store.agentSessions, []);
  assert.equal(store.selectedSourceId, "all");
  assert.equal(store.selectedAgentSessionId, "");
  assert.equal(store.selectedAgentSession, null);
  assert.equal(store.selectedSessionId, "");
  assert.equal(store.error, "");
  assert.equal(store.hasHydrated, false);
  assert.equal(store.isBootstrapping, true);
  assert.equal(store.eventStreamAttempt, previousAttempt + 1);
  assert.deepEqual(store.liveUpdatesConnection, {
    status: "connecting",
    lastSyncedAt: null
  });
});

test("hydrates the route-selected session tab before the first dashboard render", () => {
  const store = new DashboardStore({}, {
    initialActiveTab: "preview",
    suppressAgentSessionAutoSelect: true,
    suppressManagedSessionAutoSelect: true
  });

  assert.equal(store.activeTab, "preview");
});

test("preserves explicitly loaded source history across a fresh tail snapshot", () => {
  const store = createStore();
  const summary = createAgentSession("codex", "source-1");
  const recentEntry = transcriptEntry("recent", "recent answer");
  const historyEntry = transcriptEntry("history", "older answer");
  store.setSelectedAgentSession({ ...summary, transcript: [recentEntry] });

  store.mergeFetchedAgentSessionTranscriptPage(summary.id, {
    entries: [historyEntry]
  });
  store.setSelectedAgentSession({
    ...summary,
    transcript: [{ ...recentEntry, text: "refreshed answer" }],
    updatedAt: "2026-08-06T10:00:01.000Z"
  });

  assert.deepEqual(
    store.selectedAgentSession?.transcript.map((entry) => entry.id),
    ["history", "recent"]
  );
  assert.equal(store.selectedAgentSession?.transcript[1]?.text, "refreshed answer");
});

test("preserves only overview entries changed after the request watermark", () => {
  const store = createStore();
  const baseline = createManagedSession("managed-baseline", "2026-08-06T10:00:00.000Z");
  store.setOverview(createOverview([baseline]));
  const requestRevision = store.captureOverviewRevision();
  const concurrent = createManagedSession("managed-concurrent", "2026-08-06T10:00:01.000Z");

  store.mergeOverviewSession(concurrent);
  store.setOverview(createOverview([baseline]), requestRevision);
  assert.deepEqual(
    store.overview.sessions.map((session) => session.id),
    [concurrent.id, baseline.id]
  );

  const nextRequestRevision = store.captureOverviewRevision();
  store.setOverview(createOverview([baseline]), nextRequestRevision);
  assert.deepEqual(store.overview.sessions.map((session) => session.id), [baseline.id]);
});
