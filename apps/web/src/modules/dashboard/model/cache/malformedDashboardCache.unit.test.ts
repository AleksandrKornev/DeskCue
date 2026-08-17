import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SessionSummary } from "@deskcue/protocol";
import { DashboardStore, initialOverview } from "@modules/dashboard/model/store";
import {
  initializeDeskCueRuntime,
  resetDeskCueRuntimeForTests
} from "@runtime";
import type { DeskCueRuntime } from "@runtime";

import { buildDashboardCacheKey, readDashboardCache } from "./storage";

const cacheScope = "malformed-cache-test";
const cacheKey = buildDashboardCacheKey(cacheScope);

function sessionSummary(): SessionSummary {
  return {
    id: "managed-1",
    workspaceId: "workspace-1",
    workspaceName: "workspace",
    adapterId: "codex",
    sourceSessionId: "source-1",
    command: "codex resume source-1",
    status: "running",
    startedAt: "2026-08-10T10:00:00.000Z",
    finishedAt: null,
    lastActivityAt: "2026-08-10T10:01:00.000Z",
    exitCode: null,
    preview: {
      port: null,
      active: false,
      targetUrl: null,
      networkMode: "deskcue-host"
    },
    replyState: {
      phase: "idle",
      promptText: null,
      requestedAt: null
    },
    git: {
      isGitRepo: true,
      branch: "main",
      isDirty: false,
      changedFiles: [],
      diff: "",
      lastUpdatedAt: "2026-08-10T10:01:00.000Z"
    }
  };
}

function testRuntime(): DeskCueRuntime {
  return {
    buildAppPath: (path) => path,
    buildHttpUrl: (path) => path,
    buildWebSocketUrl: (path) => path,
    features: {
      accessSettings: true,
      cloudConnection: true,
      daemonLogs: true,
      externalHostProcessControls: true,
      localLlmChats: true,
      localRuntimes: true,
      manualRunner: true,
      notifications: true,
      preview: true,
      previewControl: true,
      realtime: true,
      sessionCommands: true,
      workspaceManagement: true
    },
    getAuthorizationToken: () => null,
    getCacheScope: () => cacheScope,
    getRealtimeScope: () => cacheScope,
    mode: "local",
    readAppPath: (pathname) => pathname,
    routerBasename: "/"
  };
}

describe("persisted dashboard cache validation", () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetDeskCueRuntimeForTests();
    initializeDeskCueRuntime(testRuntime());
  });

  afterEach(() => resetDeskCueRuntimeForTests());

  it.each([
    {
      agentSessions: {},
      runtimes: {},
      overview: { clientContext: null, sessions: {}, workspaces: {} }
    },
    {
      agentSessions: "not-an-array",
      runtimes: null,
      overview: []
    },
    {
      agentSessions: [null, {}],
      runtimes: [null, {}],
      overview: {
        clientContext: { canOpenNativeDialogs: false },
        sessions: [{}],
        workspaces: [null]
      }
    }
  ])("drops malformed persisted collections before store hydration", (persisted) => {
    sessionStorage.setItem(cacheKey, JSON.stringify(persisted));

    const cache = readDashboardCache();
    expect(cache.agentSessions).toEqual([]);
    expect(cache.runtimes).toEqual([]);
    expect(cache.overview).toBeUndefined();

    const store = new DashboardStore(cache);
    store.setSelectedSourceId("codex");
    expect(() => store.filteredAgentSessions).not.toThrow();
    expect(() => store.visibleRuntimes).not.toThrow();
    expect(() => store.managedSessions).not.toThrow();
    expect(store.filteredAgentSessions).toEqual([]);
    expect(store.visibleRuntimes).toEqual([]);
    expect(store.managedSessions).toEqual([]);
  });

  it("preserves well-formed overview, agent session, and runtime collections", () => {
    const agentSession = {
      id: "agent-session-1",
      agentId: "codex",
      agentLabel: "Codex",
      sourceSessionId: "source-session-1",
      title: "Cache validation",
      workspacePath: "D:/workspace",
      workspaceName: "workspace",
      updatedAt: "2026-08-10T10:00:00.000Z",
      model: "gpt-test",
      originator: null,
      cliVersion: null,
      source: null,
      filePath: "D:/workspace/session.jsonl",
      attachMode: "read_only",
      workState: "idle"
    };
    const runtime = {
      id: "codex",
      label: "Codex",
      installed: true,
      running: false,
      endpoint: null,
      modelCount: 0,
      loadedModelCount: 0,
      lastActiveModel: null,
      statusText: "Installed"
    };
    sessionStorage.setItem(cacheKey, JSON.stringify({
      overview: initialOverview,
      agentSessions: [agentSession],
      runtimes: [runtime]
    }));

    const cache = readDashboardCache();
    expect(cache.overview).toEqual(initialOverview);
    expect(cache.agentSessions).toEqual([agentSession]);
    expect(cache.runtimes).toEqual([runtime]);
  });

  it("drops malformed selected details, recovery DTOs, and unknown cache fields", () => {
    const session = sessionSummary();
    sessionStorage.setItem(cacheKey, JSON.stringify({
      credentialMarker: "must-not-survive",
      overview: {
        ...initialOverview,
        sessions: [{
          ...session,
          promptRecovery: {
            phase: "outcome_unknown",
            promptText: "possibly delivered",
            requestedAt: 123,
            retryable: "yes"
          }
        }]
      },
      selectedSession: {
        ...session,
        logs: [{ stream: "invented" }],
        inputHistory: [42]
      },
      selectedSessionId: { malformed: true },
      selectedSourceId: "ollama"
    }));

    const cache = readDashboardCache();

    expect(cache.overview).toBeUndefined();
    expect(cache.selectedSession).toBeNull();
    expect(cache.selectedSessionId).toBeUndefined();
    expect(cache.selectedSourceId).toBeUndefined();
    expect(cache).not.toHaveProperty("credentialMarker");
  });
});
