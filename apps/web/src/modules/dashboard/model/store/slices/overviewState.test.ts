import assert from "node:assert/strict";
import test from "node:test";

import type { OverviewResponse, SessionDetail, SessionSummary } from "@deskcue/protocol";

import {
  appendSelectedSessionLogs,
  mergeSelectedSessionView,
  mergeSelectedSessionSummary,
  setSelectedSession
} from "./dashboardManagedDetailSlice";
import {
  mergeOverviewSnapshot,
  mergeOverviewSessionSummary,
  touchOverviewSessionActivity
} from "./overviewState";

function createOverviewWithSessions(sessions: SessionSummary[]): OverviewResponse {
  return {
    clientContext: { canOpenNativeDialogs: false },
    sessions,
    workspaces: []
  };
}

function createOverview(session: SessionSummary): OverviewResponse {
  return createOverviewWithSessions([session]);
}

function sessionSummary(patch: Partial<SessionSummary> = {}): SessionSummary {
  return {
    adapterId: "codex",
    command: "codex resume source-1",
    exitCode: null,
    finishedAt: null,
    git: {
      branch: null,
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: false,
      lastUpdatedAt: "2026-08-06T10:00:00.000Z"
    },
    id: "managed-1",
    lastActivityAt: "2026-08-06T10:00:00.000Z",
    preview: { active: false, artifacts: [], networkMode: "device-direct", port: null, targetUrl: null },
    replyState: { phase: "idle", promptText: null, requestedAt: null },
    sourceSessionId: "source-1",
    startedAt: "2026-08-06T10:00:00.000Z",
    status: "running",
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    ...patch
  };
}

function sessionDetail(patch: Partial<SessionDetail> = {}): SessionDetail {
  return {
    ...sessionSummary(patch),
    inputHistory: [],
    logs: [],
    ...patch
  };
}

function workspace(id: string): OverviewResponse["workspaces"][number] {
  return {
    branch: null,
    createdAt: "2026-08-06T10:00:00.000Z",
    id,
    isGitRepo: false,
    name: id,
    path: `C:\\${id}`
  };
}

test("does not let an older live summary regress the overview", () => {
  const current = sessionSummary({
    lastActivityAt: "2026-08-06T10:00:10.000Z",
    status: "stopped"
  });
  const overview = createOverview(current);

  assert.equal(mergeOverviewSessionSummary(overview, sessionSummary({
    lastActivityAt: "2026-08-06T10:00:05.000Z",
    status: "running"
  })), overview);
  assert.equal(touchOverviewSessionActivity(
    overview,
    current.id,
    "2026-08-06T10:00:05.000Z"
  ), overview);
});

test("preserves live additions and newer state when a slower overview snapshot lands", () => {
  const liveUpdated = sessionSummary({
    id: "managed-1",
    lastActivityAt: "2026-08-06T10:00:10.000Z",
    status: "stopped"
  });
  const liveAdded = sessionSummary({
    id: "managed-2",
    lastActivityAt: "2026-08-06T10:00:08.000Z"
  });
  const merged = mergeOverviewSnapshot(
    createOverviewWithSessions([liveUpdated, liveAdded]),
    createOverviewWithSessions([sessionSummary({
      id: "managed-1",
      lastActivityAt: "2026-08-06T10:00:05.000Z",
      status: "running"
    })]),
    {
      shouldPreserveSession: (session) => session.id === liveAdded.id
    }
  );

  assert.deepEqual(merged.sessions.map((session) => session.id), ["managed-1", "managed-2"]);
  assert.equal(merged.sessions[0].status, "stopped");
});

test("treats absent sessions and workspaces as removed without a concurrent live revision", () => {
  const current = createOverviewWithSessions([
    sessionSummary({ id: "managed-current" }),
    sessionSummary({ id: "managed-removed" })
  ]);
  current.workspaces = [workspace("workspace-current"), workspace("workspace-removed")];
  const incoming = createOverviewWithSessions([
    sessionSummary({ id: "managed-current" })
  ]);
  incoming.workspaces = [workspace("workspace-current")];

  const merged = mergeOverviewSnapshot(current, incoming);

  assert.deepEqual(merged.sessions.map((session) => session.id), ["managed-current"]);
  assert.deepEqual(merged.workspaces.map((item) => item.id), ["workspace-current"]);
});

test("does not let an older summary regress the selected managed detail", () => {
  const selectedSession = sessionDetail({
    lastActivityAt: "2026-08-06T10:00:10.000Z",
    status: "stopped"
  });
  const state = {
    previewPort: "",
    selectedSession,
    selectedSessionId: selectedSession.id,
    selectedWorkspaceId: selectedSession.workspaceId
  };

  mergeSelectedSessionSummary(state, sessionSummary({
    lastActivityAt: "2026-08-06T10:00:05.000Z",
    status: "running"
  }));

  assert.equal(state.selectedSession.status, "stopped");
  assert.equal(state.selectedSession.lastActivityAt, "2026-08-06T10:00:10.000Z");
});

test("does not let a lifecycle summary overwrite authoritative preview config", () => {
  const selectedSession = sessionDetail({
    lastActivityAt: "2026-08-06T10:00:05.000Z",
    preview: { active: false, artifacts: [], networkMode: "device-direct", port: null, targetUrl: null }
  });
  const state = {
    previewPort: "",
    selectedSession,
    selectedSessionId: selectedSession.id,
    selectedWorkspaceId: selectedSession.workspaceId
  };

  mergeSelectedSessionSummary(state, sessionSummary({
    lastActivityAt: "2026-08-06T10:00:10.000Z",
    preview: { active: true, artifacts: [], networkMode: "device-direct", port: 3000, targetUrl: "http://127.0.0.1:3000" }
  }));

  assert.deepEqual(state.selectedSession.preview, {
    active: false,
    artifacts: [],
    networkMode: "device-direct",
    port: null,
    targetUrl: null
  });
  assert.equal(state.selectedSession.lastActivityAt, "2026-08-06T10:00:10.000Z");
});

test("applies preview config from its dedicated live event", () => {
  const selectedSession = sessionDetail({
    lastActivityAt: "2026-08-06T10:00:05.000Z",
    preview: { active: false, artifacts: [], networkMode: "device-direct", port: null, targetUrl: null }
  });
  const state = {
    previewPort: "",
    selectedSession,
    selectedSessionId: selectedSession.id,
    selectedWorkspaceId: selectedSession.workspaceId
  };

  mergeSelectedSessionSummary(state, sessionSummary({
    lastActivityAt: "2026-08-06T10:00:10.000Z",
    preview: { active: true, artifacts: [], networkMode: "device-direct", port: 5173, targetUrl: "http://127.0.0.1:5173" }
  }), { includePreview: true });

  assert.equal(state.selectedSession.preview.port, 5173);
  assert.equal(state.previewPort, "5173");
});

test("keeps an inactive backend preview port empty when selecting a session", () => {
  const state = {
    previewPort: "5173",
    selectedSession: null as SessionDetail | null,
    selectedSessionId: "managed-1",
    selectedWorkspaceId: "workspace-1"
  };

  setSelectedSession(state, sessionDetail({
    preview: { active: false, artifacts: [], networkMode: "device-direct", port: null, targetUrl: null }
  }));

  assert.equal(state.previewPort, "");
});

test("accepts authoritative preview config without regressing newer live activity", () => {
  const selectedSession = sessionDetail({
    lastActivityAt: "2026-08-06T10:00:10.000Z",
    preview: { active: true, artifacts: [], networkMode: "device-direct", port: 3000, targetUrl: "http://127.0.0.1:3000" }
  });
  const state = {
    previewPort: "3000",
    selectedSession,
    selectedSessionId: selectedSession.id,
    selectedWorkspaceId: selectedSession.workspaceId
  };

  setSelectedSession(state, sessionDetail({
    lastActivityAt: "2026-08-06T10:00:05.000Z",
    preview: { active: false, artifacts: [], networkMode: "device-direct", port: null, targetUrl: null }
  }));

  assert.equal(state.selectedSession?.lastActivityAt, "2026-08-06T10:00:10.000Z");
  assert.deepEqual(state.selectedSession?.preview, {
    active: false,
    artifacts: [],
    networkMode: "device-direct",
    port: null,
    targetUrl: null
  });
  assert.equal(state.previewPort, "");
});

test("does not overwrite an unsaved preview port draft during authoritative hydration", () => {
  const selectedSession = sessionDetail({
    lastActivityAt: "2026-08-06T10:00:10.000Z",
    preview: { active: true, artifacts: [], networkMode: "device-direct", port: 3000, targetUrl: "http://127.0.0.1:3000" }
  });
  const state = {
    previewPort: "5173",
    selectedSession,
    selectedSessionId: selectedSession.id,
    selectedWorkspaceId: selectedSession.workspaceId
  };

  setSelectedSession(state, sessionDetail({
    lastActivityAt: "2026-08-06T10:00:05.000Z",
    preview: { active: false, artifacts: [], networkMode: "device-direct", port: null, targetUrl: null }
  }));

  assert.equal(state.previewPort, "5173");
});

test("accepts authoritative preview config from an older bounded view", () => {
  const selectedSession = sessionDetail({
    lastActivityAt: "2026-08-06T10:00:10.000Z",
    preview: { active: true, artifacts: [], networkMode: "device-direct", port: 3000, targetUrl: "http://127.0.0.1:3000" }
  });
  const state = {
    previewPort: "3000",
    selectedSession,
    selectedSessionId: selectedSession.id,
    selectedWorkspaceId: selectedSession.workspaceId
  };

  mergeSelectedSessionView(state, sessionDetail({
    lastActivityAt: "2026-08-06T10:00:05.000Z",
    preview: { active: false, artifacts: [], networkMode: "device-direct", port: null, targetUrl: null }
  }), "chat");

  assert.equal(state.selectedSession.lastActivityAt, "2026-08-06T10:00:10.000Z");
  assert.equal(state.selectedSession.preview.active, false);
  assert.equal(state.previewPort, "");
});

test("deduplicates replayed logs and keeps managed activity monotonic", () => {
  const selectedSession = sessionDetail({
    lastActivityAt: "2026-08-06T10:00:10.000Z"
  });
  selectedSession.logs = [{
    id: "log-1",
    stream: "stdout",
    text: "known",
    timestamp: "2026-08-06T10:00:09.000Z"
  }];
  const state = {
    previewPort: "",
    selectedSession,
    selectedSessionId: selectedSession.id,
    selectedWorkspaceId: selectedSession.workspaceId
  };

  appendSelectedSessionLogs(state, selectedSession.id, [
    selectedSession.logs[0],
    {
      id: "log-2",
      stream: "stdout",
      text: "late replay",
      timestamp: "2026-08-06T10:00:08.000Z"
    }
  ]);

  assert.deepEqual(state.selectedSession.logs.map((log) => log.id), ["log-1", "log-2"]);
  assert.equal(state.selectedSession.lastActivityAt, "2026-08-06T10:00:10.000Z");
});

test("keeps Debug data isolated from later Chat and Diff projections", () => {
  const selectedSession = sessionDetail({
    lastActivityAt: "2026-08-06T10:00:00.000Z"
  });
  const state = {
    previewPort: "",
    selectedSession,
    selectedSessionId: selectedSession.id,
    selectedWorkspaceId: selectedSession.workspaceId
  };
  const debugSession = sessionDetail({
    inputHistory: ["first prompt"],
    lastActivityAt: "2026-08-06T10:00:01.000Z",
    logs: [{
      id: "debug-1",
      stream: "stdout",
      text: "debug output",
      timestamp: "2026-08-06T10:00:01.000Z"
    }]
  });

  mergeSelectedSessionView(state, debugSession, "debug");
  mergeSelectedSessionView(state, sessionDetail({
    inputHistory: [],
    lastActivityAt: "2026-08-06T10:00:02.000Z",
    logs: [],
    status: "read_only"
  }), "chat");
  mergeSelectedSessionView(state, sessionDetail({
    git: {
      ...selectedSession.git,
      diff: "+debug-safe diff",
      lastUpdatedAt: "2026-08-06T10:00:03.000Z"
    },
    inputHistory: [],
    lastActivityAt: "2026-08-06T10:00:03.000Z",
    logs: []
  }), "diff");

  assert.deepEqual(state.selectedSession.logs.map((log) => log.id), ["debug-1"]);
  assert.deepEqual(state.selectedSession.inputHistory, ["first prompt"]);
  assert.equal(state.selectedSession.git.diff, "+debug-safe diff");
  assert.equal(state.selectedSession.status, "running");
});

test("merges late Debug logs without regressing newer managed state", () => {
  const selectedSession = sessionDetail({
    lastActivityAt: "2026-08-06T10:00:10.000Z",
    status: "read_only"
  });
  const state = {
    previewPort: "",
    selectedSession,
    selectedSessionId: selectedSession.id,
    selectedWorkspaceId: selectedSession.workspaceId
  };

  mergeSelectedSessionView(state, sessionDetail({
    lastActivityAt: "2026-08-06T10:00:05.000Z",
    logs: [{
      id: "debug-late",
      stream: "stdout",
      text: "late debug response",
      timestamp: "2026-08-06T10:00:05.000Z"
    }],
    status: "running"
  }), "debug");

  assert.equal(state.selectedSession.status, "read_only");
  assert.equal(state.selectedSession.lastActivityAt, "2026-08-06T10:00:10.000Z");
  assert.deepEqual(state.selectedSession.logs.map((log) => log.id), ["debug-late"]);
});
