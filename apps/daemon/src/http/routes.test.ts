import express from "express";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  AgentTranscriptActivityGroupResponse,
  AgentTranscriptChangesResponse,
  AgentTranscriptEntry,
  AgentTranscriptViewResponse,
  AgentSessionDetail,
  AgentSessionSourceVersion,
  AgentSessionsResponse,
  AgentSessionSummary,
  RuntimeSummary,
  SessionDetail,
  SessionSummary,
  WorkspaceSummary
} from "@deskcue/protocol";
import { setRequestAccessDevice } from "#access/accessDevices";
import type { DaemonApplication } from "#application/daemonApplication";
import { AppError } from "#application/errors";
import type { ManagedSessionService } from "#application/managedSessionService";
import type { ManagedSessionGitRefreshOptions } from "#application/ports";
import type { SourceAgentSessionService } from "#application/sourceAgentSessionService";
import { createPushNotificationService } from "#infrastructure/notifications/pushNotificationService";
import { emptyPreview, emptyReplyState } from "#sessions/model/sessionDefaults";

import { errorHandler } from "./middleware/errorHandler.ts";
import { installAgentSessionRoutes } from "./routes/agents/agentSessionRoutes.ts";
import { installSessionRoutes } from "./routes/agents/sessionRoutes.ts";
import { installHealthRoutes } from "./routes/system/diagnostics/healthRoutes.ts";
import { installOverviewRoutes } from "./routes/system/diagnostics/overviewRoutes.ts";
import { installRuntimeRoutes } from "./routes/system/diagnostics/runtimeRoutes.ts";
import { installPushNotificationRoutes } from "./routes/system/notifications/pushNotificationRoutes.ts";
import { summarizeAgentSessionTranscript } from "./transcript/agentTranscriptSummary.ts";
import { buildAgentTranscriptView } from "./transcript/agentTranscriptView.ts";

async function requestJson<T>(
  url: string,
  options: { body?: unknown; method?: string } = {}
) {
  const response = await fetch(url, {
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers: options.body
      ? {
          "content-type": "application/json"
        }
      : undefined,
    method: options.method ?? "GET"
  });

  assert.equal(response.ok, true);
  return (await response.json()) as T;
}

function createTestApp(installRoutes: (app: express.Express) => void) {
  const app = express();

  app.use(express.json());

  installRoutes(app);
  app.use(errorHandler);
  return app;
}

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function withServer(app: express.Express, callback: (baseUrl: string) => Promise<void>) {
  const server = createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();

    assert(address && typeof address === "object");

    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await closeServer(server);
  }
}

function testPushSubscription(endpoint: string) {
  return {
    endpoint,
    keys: {
      auth: "test-auth",
      p256dh: "test-p256dh"
    }
  };
}

test("push subscription routes expose safe browser records and remove only the addressed subscription", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-routes-"));
  const pushNotifications = await createPushNotificationService({
    events: {
      on() {
        return undefined;
      },
      publishServerEvent() {
        return undefined;
      }
    },
    storagePath: join(directory, "push-state.json")
  });

  try {
    const current = await pushNotifications.registerSubscription({
      accessDeviceId: "device-current",
      pushClientId: "push-current",
      subscription: testPushSubscription("https://push.example/current"),
      userAgent: "Chrome"
    });
    const other = await pushNotifications.registerSubscription({
      accessDeviceId: "device-other",
      pushClientId: "push-other",
      subscription: testPushSubscription("https://push.example/other"),
      userAgent: "Firefox"
    });
    const app = createTestApp((target) => {
      target.use((request, _response, next) => {
        setRequestAccessDevice(request, {
          id: "device-current",
          label: "Current device"
        });

        next();
      });
      installPushNotificationRoutes(target, {
        pushNotifications
      });
    });

    await withServer(app, async (baseUrl) => {
      const listed = await requestJson<{
        subscriptionCount: number;
        subscriptions: Array<{ current: boolean; id: string }>;
      }>(`${baseUrl}/api/push/subscriptions?pushClientId=push-current`);

      assert.equal(listed.subscriptionCount, 2);
      assert.equal(listed.subscriptions.find((item) => item.id === current.id)?.current, true);
      assert.equal(listed.subscriptions.find((item) => item.id === other.id)?.current, false);
      assert.equal(JSON.stringify(listed).includes("push.example"), false);

      const removed = await requestJson<{ removedCount: number; subscriptionCount: number }>(
        `${baseUrl}/api/push/subscriptions/${current.id}`,
        { method: "DELETE" }
      );

      assert.deepEqual(removed, {
        removedCount: 1,
        subscriptionCount: 1
      });

      assert.equal(pushNotifications.getStatus().subscriptionCount, 1);

      const missing = await fetch(`${baseUrl}/api/push/subscriptions/${current.id}`, {
        method: "DELETE"
      });

      assert.equal(missing.status, 404);
    });
  } finally {
    pushNotifications.close();
    await rm(directory, {
      force: true,
      recursive: true
    });
  }
});

function decorateSession<T extends SessionSummary | SessionDetail>(session: T): T {
  return {
    ...session,
    canSendInput: session.status === "running",
    inputBlockedReason: null,
    viewerCount: 2
  };
}

function workspaceSummary(): WorkspaceSummary {
  return {
    id: "workspace-1",
    name: "Workspace",
    path: "C:/workspace",
    isGitRepo: true,
    branch: "main",
    createdAt: "2026-06-22T10:00:00.000Z"
  };
}

function sessionDetail(): SessionDetail {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    adapterId: "generic-cli",
    sourceSessionId: null,
    command: "npm test",
    status: "running",
    startedAt: "2026-06-22T10:00:00.000Z",
    finishedAt: null,
    lastActivityAt: "2026-06-22T10:01:00.000Z",
    exitCode: null,
    preview: emptyPreview(),
    replyState: emptyReplyState(),
    git: {
      branch: "main",
      changedFiles: ["src/index.ts"],
      diff: "diff --git a/src/index.ts b/src/index.ts",
      isDirty: true,
      isGitRepo: true,
      lastUpdatedAt: "2026-06-22T10:01:00.000Z"
    },
    logs: [
      {
        id: "log-1",
        stream: "stdout",
        text: "ready",
        timestamp: "2026-06-22T10:01:00.000Z"
      }
    ],
    inputHistory: []
  };
}

function assertDecoratedSession(session: SessionSummary) {
  assert.equal(session.viewerCount, 2);
  assert.equal(session.canSendInput, true);
  assert.equal(session.inputBlockedReason, null);
}

function agentSessionSummary(): AgentSessionSummary {
  return {
    id: "codex:source-1",
    agentId: "codex",
    agentLabel: "Codex",
    sourceSessionId: "source-1",
    title: "Refactor daemon",
    workspacePath: "C:/workspace",
    workspaceName: "Workspace",
    updatedAt: "2026-06-22T10:00:00.000Z",
    model: "gpt-5",
    originator: "codex",
    cliVersion: "1.0.0",
    source: "codex",
    filePath: "C:/codex/session.jsonl",
    attachMode: "resume",
    workState: "idle"
  };
}

function agentSessionDetail(): AgentSessionDetail {
  return {
    ...agentSessionSummary(),
    transcript: [
      {
        id: "entry-0",
        timestamp: "2026-06-22T09:58:00.000Z",
        role: "system",
        text: "Compacted",
        phase: "context_compacted"
      },
      {
        id: "entry-1",
        timestamp: "2026-06-22T09:58:30.000Z",
        role: "system",
        text: "Model changed",
        phase: "model_changed"
      },
      {
        id: "entry-2",
        timestamp: "2026-06-22T09:59:00.000Z",
        role: "user",
        text: "Earlier prompt",
        phase: null
      },
      {
        id: "entry-3",
        timestamp: "2026-06-22T10:00:00.000Z",
        role: "assistant",
        text: "Earlier response",
        phase: null
      },
      {
        id: "entry-4",
        timestamp: "2026-06-22T10:01:00.000Z",
        role: "user",
        text: "Latest prompt",
        phase: null
      },
      {
        id: "entry-5",
        timestamp: "2026-06-22T10:02:00.000Z",
        role: "assistant",
        text: "Latest response",
        phase: null
      }
    ]
  };
}

function requireSession(sessionMap: Map<string, SessionDetail>, sessionId: string) {
  const session = sessionMap.get(sessionId);

  if (!session) throw new Error("Session not found.");

  return session;
}

function fakeApplication({
  agentSessionPatch = {},
  agentSessionDetailResponse = agentSessionDetail(),
  agentTranscriptPreviousWindowResponse,
  agentTranscriptTailWindowResponse,
  agentTranscriptWindowResponse,
  agentSessionVersionResponse,
  sessions = [],
  workspaces = []
}: {
  agentSessionPatch?: Partial<AgentSessionSummary>;
  agentSessionDetailResponse?: AgentSessionDetail;
  agentTranscriptPreviousWindowResponse?: {
    entries: AgentTranscriptEntry[];
    hasMore: boolean;
  } | null;
  agentTranscriptTailWindowResponse?: AgentTranscriptEntry[] | null;
  agentTranscriptWindowResponse?: AgentTranscriptEntry[] | null;
  agentSessionVersionResponse?: AgentSessionSourceVersion | null;
  sessions?: SessionDetail[];
  workspaces?: WorkspaceSummary[];
}) {
  const sessionMap = new Map(sessions.map((session) => [session.id, session]));
  const agentSessionDetailRequests: Array<{
    chatMessageTail: number | undefined;
    lightweight?: boolean | "exact-ids" | "bounded-exact-ids";
    transcriptTail: number | undefined;
  }> = [];
  const agentSessionPageRequests: Array<{
    includeLiveMetadata: boolean;
    limit: number;
    options: Record<string, unknown>;
  }> = [];
  const agentTranscriptEntriesRequests: Array<{
    entryIds: string[];
  }> = [];
  const agentTranscriptWindowRequests: Array<{
    baseSourceEntryId: string;
    maxLineCount?: number;
    overlapLineCount?: number;
  }> = [];
  const agentTranscriptTailWindowRequests: Array<{
    chatMessageTail?: number;
  }> = [];
  const agentTranscriptPreviousWindowRequests: Array<{
    beforeEntryId: string;
  }> = [];
  const managedSessionGitRefreshRequests: Array<{
    includeDiff?: boolean;
    sessionId: string;
  }> = [];
  const externalForceStopRequests: Array<{
    processCreatedAt: string;
    processId: number;
    sessionId: string;
  }> = [];
  const externalClaudeBackgroundStopRequests: string[] = [];
  const externalDesktopInterruptRequests: string[] = [];
  const externalCodexDesktopOpenRequests: string[] = [];

  const managedSessions = {
    getSession(sessionId: string) {
      return sessionMap.get(sessionId) ?? null;
    },
    listSessions() {
      return Array.from(sessionMap.values());
    },
    async syncReplyStateForSession(sessionId: string) {
      return sessionMap.get(sessionId) ?? null;
    },
    async syncReplyStatesForRunningAttachedSessions() {},
    sendInput(sessionId: string, input: string) {
      const session = requireSession(sessionMap, sessionId);
      const updated: SessionDetail = {
        ...session,
        inputHistory: [...session.inputHistory, input]
      };

      sessionMap.set(sessionId, updated);
      return updated;
    },
    setPreviewPort(
      sessionId: string,
      port: number | null,
      networkMode?: SessionDetail["preview"]["networkMode"]
    ) {
      const session = requireSession(sessionMap, sessionId);
      const updated: SessionDetail = {
        ...session,
        preview: {
          active: port !== null,
          networkMode: networkMode ?? session.preview.networkMode,
          port,
          targetUrl: port === null ? null : `http://127.0.0.1:${port}`,
          artifacts: session.preview.artifacts ?? []
        }
      };

      sessionMap.set(sessionId, updated);
      return updated;
    },
    capturePreviewArtifact(sessionId: string) {
      const session = requireSession(sessionMap, sessionId);
      const updated: SessionDetail = {
        ...session,
        preview: {
          ...session.preview,
          artifacts: [
            {
              id: "preview-artifact-1",
              capturedAt: "2026-06-22T10:02:00.000Z",
              targetUrl: session.preview.targetUrl ?? "",
              viewport: "mobile",
              source: "metadata",
              title: "Mobile preview",
              notes: ["Target captured"]
            }
          ]
        }
      };

      sessionMap.set(sessionId, updated);
      return updated;
    },
    stopSession(sessionId: string) {
      const session = requireSession(sessionMap, sessionId);
      const updated: SessionDetail = {
        ...session,
        finishedAt: "2026-06-22T10:05:00.000Z",
        status: "stopped"
      };

      sessionMap.set(sessionId, updated);
      return updated;
    },
    async refreshSessionGit(
      sessionId: string,
      options: ManagedSessionGitRefreshOptions = {}
    ) {
      managedSessionGitRefreshRequests.push({
        includeDiff: options.includeDiff,
        sessionId
      });
      const session = requireSession(sessionMap, sessionId);
      const updated: SessionDetail = {
        ...session,
        git: {
          ...session.git,
          lastUpdatedAt: "2026-06-22T10:02:00.000Z"
        }
      };

      sessionMap.set(sessionId, updated);
      return updated;
    },
    getExternalForceStopCapability() {
      return {
        kind: "available" as const,
        processCreatedAt: "2026-07-30T13:23:00.000Z",
        processId: 310
      };
    },
    getExternalDesktopInterruptCapability() {
      return { kind: "available" as const };
    },
    getExternalClaudeBackgroundStopCapability() {
      return {
        jobId: "claude-background-1",
        kind: "available" as const,
        state: "working" as const
      };
    },
    stopExternalClaudeBackground(sessionId: string) {
      externalClaudeBackgroundStopRequests.push(sessionId);
      return requireSession(sessionMap, sessionId);
    },
    interruptExternalDesktopSession(sessionId: string) {
      externalDesktopInterruptRequests.push(sessionId);
      return requireSession(sessionMap, sessionId);
    },
    openExternalCodexDesktopChat(sessionId: string) {
      externalCodexDesktopOpenRequests.push(sessionId);
    },
    forceStopExternalProcess(
      sessionId: string,
      target: {
        processCreatedAt: string;
        processId: number;
      }
    ) {
      externalForceStopRequests.push({
        ...target,
        sessionId
      });
      return requireSession(sessionMap, sessionId);
    },
    syncReplyStateFromAgentSession() {
      return null;
    }
  } as unknown as ManagedSessionService;

  const sourceAgentSessions = {
    async listRecentSessions() {
      return [agentSessionSummary()];
    },
    async listRecentSessionPage(
      limit: number,
      includeLiveMetadata: boolean,
      options: Record<string, unknown>
    ) {
      agentSessionPageRequests.push({ includeLiveMetadata, limit, options });

      return {
        sessions: [agentSessionSummary()],
        limit: 100,
        offset: 0,
        hasMore: false,
        query: null,
        totalCount: 1,
        totalCountExact: true,
        sourceCounts: [
          {
            agentId: "codex",
            count: 1,
            exact: true
          }
        ]
      };
    },
    async getSessionDetail(
      agentSessionId: string,
      _force?: boolean,
      transcriptTail?: number,
      chatMessageTail?: number,
      options: {
        lightweight?: boolean | "exact-ids" | "bounded-exact-ids";
      } = {}
    ) {
      const detailRequest: {
        chatMessageTail: number | undefined;
        lightweight?: boolean | "exact-ids" | "bounded-exact-ids";
        transcriptTail: number | undefined;
      } = {
        chatMessageTail,
        transcriptTail
      };

      if (options.lightweight !== undefined && options.lightweight !== false) {
        detailRequest.lightweight = options.lightweight;
      }

      agentSessionDetailRequests.push(detailRequest);
      return agentSessionId === "codex:source-1" ? agentSessionDetailResponse : null;
    },
    async getSessionVersion(agentSessionId: string) {
      if (agentSessionId !== "codex:source-1") return null;

      return agentSessionVersionResponse ?? {
        localStateVersion: "none",
        sourceFileMtimeMs: 1000,
        sourceFileSizeBytes: 2048,
        sourceVersion: "test-source-version",
        summary: {
          ...agentSessionSummary(),
          ...agentSessionPatch
        }
      };
    },
    async getTranscriptEntries(agentSessionId: string, entryIds: string[]) {
      agentTranscriptEntriesRequests.push({
        entryIds
      });
      if (agentSessionId !== "codex:source-1") return [];

      const requestedEntryIds = new Set(entryIds);

      return agentSessionDetailResponse.transcript.filter((entry) => requestedEntryIds.has(entry.id));
    },
    async getTranscriptWindow(
      agentSessionId: string,
      options: {
        baseSourceEntryId: string;
        maxLineCount?: number;
        overlapLineCount?: number;
      }
    ) {
      agentTranscriptWindowRequests.push(options);
      if (agentSessionId !== "codex:source-1") return null;

      return agentTranscriptWindowResponse ?? null;
    },
    async getTranscriptTailWindow(
      agentSessionId: string,
      options: {
        chatMessageTail?: number;
      } = {}
    ) {
      agentTranscriptTailWindowRequests.push(options);
      if (agentSessionId !== "codex:source-1") return null;

      return agentTranscriptTailWindowResponse ?? null;
    },
    async getTranscriptPreviousWindow(
      agentSessionId: string,
      options: {
        beforeEntryId: string;
      }
    ) {
      agentTranscriptPreviousWindowRequests.push(options);
      if (agentSessionId !== "codex:source-1") return null;

      return agentTranscriptPreviousWindowResponse ?? null;
    },
    reconcileAttachedSession<T extends AgentSessionSummary | AgentSessionDetail>(session: T) {
      return {
        ...session,
        ...agentSessionPatch
      };
    },
    resumeAgentSession() {
      throw new Error("Unexpected attach in route shape test.");
    },
    syncReplyStateFromAgentSession() {
      return null;
    }
  } as unknown as SourceAgentSessionService;

  return {
    agentSessionDetailRequests,
    agentSessionPageRequests,
    agentTranscriptEntriesRequests,
    agentTranscriptPreviousWindowRequests,
    agentTranscriptTailWindowRequests,
    agentTranscriptWindowRequests,
    externalClaudeBackgroundStopRequests,
    externalCodexDesktopOpenRequests,
    externalDesktopInterruptRequests,
    externalForceStopRequests,
    managedSessionGitRefreshRequests,
    managedSessions,
    manualCommands: {
      close() {},
      run: async () => ({
        durationMs: 0,
        exitCode: 0,
        ok: true,
        pid: null,
        signal: null,
        status: "finished" as const,
        stderr: "",
        stdout: "",
        truncated: false
      })
    },
    sourceAgentSessions,
    workspaces: {
      listWorkspaces() {
        return workspaces;
      }
    }
  } as unknown as DaemonApplication & {
    agentSessionDetailRequests: typeof agentSessionDetailRequests;
    agentSessionPageRequests: typeof agentSessionPageRequests;
    agentTranscriptEntriesRequests: typeof agentTranscriptEntriesRequests;
    agentTranscriptPreviousWindowRequests: typeof agentTranscriptPreviousWindowRequests;
    agentTranscriptTailWindowRequests: typeof agentTranscriptTailWindowRequests;
    agentTranscriptWindowRequests: typeof agentTranscriptWindowRequests;
    externalClaudeBackgroundStopRequests: typeof externalClaudeBackgroundStopRequests;
    externalCodexDesktopOpenRequests: typeof externalCodexDesktopOpenRequests;
    externalDesktopInterruptRequests: typeof externalDesktopInterruptRequests;
    externalForceStopRequests: typeof externalForceStopRequests;
    managedSessionGitRefreshRequests: typeof managedSessionGitRefreshRequests;
  };
}

test("overview route returns web dashboard response shape", async () => {
  const workspace = workspaceSummary();
  const session = sessionDetail();
  const application = fakeApplication({
    sessions: [session],
    workspaces: [workspace]
  });
  const app = createTestApp((target) => {
    installHealthRoutes(target);
    installOverviewRoutes(target, {
      application,
      decorateSession
    });
  });

  await withServer(app, async (baseUrl) => {
    const health = await requestJson<{ ok: boolean }>(`${baseUrl}/api/health`);
    const overviewResponse = await fetch(`${baseUrl}/api/overview`, {
      headers: {
        origin: baseUrl
      }
    });
    const overview = (await overviewResponse.json()) as {
      clientContext: { canOpenNativeDialogs: boolean };
      sessions: SessionSummary[];
      workspaces: WorkspaceSummary[];
    };

    assert.deepEqual(health, { ok: true });
    assert.equal(overviewResponse.status, 200);
    assert.equal(overview.clientContext.canOpenNativeDialogs, true);
    assert.deepEqual(overview.workspaces, [workspace]);
    assert.equal(overview.sessions.length, 1);
    assertDecoratedSession(overview.sessions[0]);
  });
});

test("overview route does not expose native dialogs through a loopback reverse proxy", async () => {
  const application = fakeApplication({});
  const app = createTestApp((target) => {
    installOverviewRoutes(target, {
      application,
      decorateSession
    });
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/overview`, {
      headers: {
        host: "deskcue.example.com",
        origin: "https://deskcue.example.com",
        "x-forwarded-for": "192.168.1.50"
      }
    });
    const overview = (await response.json()) as {
      clientContext: { canOpenNativeDialogs: boolean };
    };

    assert.equal(response.status, 200);
    assert.equal(overview.clientContext.canOpenNativeDialogs, false);
  });
});

test("agent transcript view ETag tracks attached state without a session summary", async () => {
  const detail = agentSessionDetail();
  let localStateVersion = "attached-state-1";
  const application = fakeApplication({
    agentSessionDetailResponse: detail,
    agentSessionVersionResponse: null
  });

  application.sourceAgentSessions.getSessionVersion = async () => ({
    localStateVersion,
    sourceFileMtimeMs: 1000,
    sourceFileSizeBytes: 2048,
    sourceVersion: "stable-source-version",
    summary: agentSessionSummary()
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const transcriptViewUrl =
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-view?chatMessageTail=40&transcriptDetail=summary`;
    const firstResponse = await fetch(transcriptViewUrl);
    const firstEtag = firstResponse.headers.get("etag");

    assert.equal(firstResponse.status, 200);

    assert.equal(Boolean(firstEtag), true);

    localStateVersion = "attached-state-2";
    const changedResponse = await fetch(transcriptViewUrl, {
      headers: {
        "if-none-match": firstEtag ?? ""
      }
    });

    assert.equal(changedResponse.status, 200);

    const summaryUrl = `${transcriptViewUrl}&includeSessionSummary=1`;
    const summaryResponse = await fetch(summaryUrl);
    const summaryEtag = summaryResponse.headers.get("etag");

    assert.equal(summaryResponse.status, 200);

    assert.equal(Boolean(summaryEtag), true);

    localStateVersion = "attached-state-3";
    const changedSummaryResponse = await fetch(summaryUrl, {
      headers: {
        "if-none-match": summaryEtag ?? ""
      }
    });

    assert.equal(changedSummaryResponse.status, 200);
  });
});

test("agent transcript view uses source tail window before bounded detail", async () => {
  const detail = agentSessionDetail();
  const application = fakeApplication({
    agentSessionDetailResponse: detail,
    agentTranscriptTailWindowResponse: [
      {
        id: "source-1@4096-0",
        timestamp: "2026-06-22T10:00:00.000Z",
        role: "user",
        text: "Tail prompt",
        phase: null
      },
      {
        id: "source-1@4096-1",
        timestamp: "2026-06-22T10:00:01.000Z",
        role: "assistant",
        text: "Tail answer",
        phase: null
      }
    ]
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const view = await requestJson<AgentTranscriptViewResponse>(
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-view?chatMessageTail=40&transcriptDetail=summary`
    );

    assert.equal(view.items.some((item) =>
      item.type === "message" && item.entry.text === "Tail answer"
    ), true);
    assert.deepEqual(application.agentTranscriptTailWindowRequests, [
      {
        chatMessageTail: 40
      }
    ]);
    assert.equal(application.agentSessionDetailRequests.length, 0);
  });
});

test("agent transcript view summary recomputes running state from source tail window", async () => {
  const startedAt = new Date(Date.now() - 30_000).toISOString();
  const activityAt = new Date(Date.now() - 1_000).toISOString();
  const detail = {
    ...agentSessionDetail(),
    workState: "idle" as const,
    turnState: {
      activityAt: null,
      completedAt: null,
      evidence: "none" as const,
      fingerprint: null,
      phase: "idle" as const,
      startedAt: null
    }
  };

  const application = fakeApplication({
    agentSessionDetailResponse: detail,
    agentTranscriptTailWindowResponse: [
      {
        id: "source-1@4096-0",
        timestamp: startedAt,
        role: "user",
        text: "Tail prompt",
        phase: null
      },
      {
        id: "source-1@4096-1",
        timestamp: startedAt,
        role: "system",
        text: "Turn started",
        phase: null,
        parts: [
          {
            type: "status",
            label: "Turn started",
            detail: null
          }
        ]
      },
      {
        id: "source-1@4096-2",
        timestamp: activityAt,
        role: "tool",
        text: "Still working",
        phase: null
      }
    ]
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const view = await requestJson<AgentTranscriptViewResponse>(
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-view?chatMessageTail=40&transcriptDetail=summary&includeSessionSummary=1`
    );

    assert.equal(view.session?.workState, "running");
    assert.equal(view.session?.turnState?.phase, "active");
    assert.equal(view.session?.turnState?.evidence, "turn_lifecycle");
    assert.equal(application.agentSessionDetailRequests.length, 0);
  });
});

test("agent transcript view summary clears stale running state after a source terminal lifecycle", async () => {
  const detail = {
    ...agentSessionDetail(),
    workState: "running" as const,
    turnState: {
      activityAt: "2026-06-22T10:00:01.000Z",
      completedAt: null,
      evidence: "turn_lifecycle" as const,
      fingerprint: "stale-turn",
      phase: "active" as const,
      startedAt: "2026-06-22T10:00:00.000Z"
    }
  };

  const application = fakeApplication({
    agentSessionDetailResponse: detail,
    agentSessionPatch: {
      workState: "running"
    },
    agentTranscriptTailWindowResponse: [
      {
        id: "source-1@4096-0",
        timestamp: "2026-06-22T10:00:00.000Z",
        role: "user",
        text: "Tail prompt",
        phase: null
      },
      {
        id: "source-1@4096-1",
        timestamp: "2026-06-22T10:00:01.000Z",
        role: "system",
        text: "Turn started",
        phase: null,
        parts: [{ type: "status", label: "Turn started", detail: null }]
      },
      {
        id: "source-1@4096-2",
        timestamp: "2026-06-22T10:00:02.000Z",
        role: "assistant",
        text: "Tail answer",
        phase: "final_answer"
      },
      {
        id: "source-1@4096-3",
        timestamp: "2026-06-22T10:00:03.000Z",
        role: "system",
        text: "Turn completed",
        phase: null,
        parts: [{ type: "status", label: "Turn completed", detail: null }]
      }
    ]
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const view = await requestJson<AgentTranscriptViewResponse>(
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-view?chatMessageTail=40&transcriptDetail=summary&includeSessionSummary=1`
    );

    assert.equal(view.session?.workState, "idle");
    assert.equal(view.session?.turnState?.phase, "completed");
    assert.equal(view.session?.turnState?.evidence, "terminal_lifecycle");
  });
});

test("agent transcript updates returns a bounded suffix with overlap and ETag", async () => {
  const detail: AgentSessionDetail = {
    ...agentSessionDetail(),
    updatedAt: "2026-06-22T10:08:00.000Z",
    transcript: [
      ...agentSessionDetail().transcript,
      {
        id: "entry-6",
        timestamp: "2026-06-22T10:03:00.000Z",
        role: "tool",
        text: "Tool call",
        phase: null
      },
      {
        id: "entry-7",
        timestamp: "2026-06-22T10:04:00.000Z",
        role: "assistant",
        text: "Newer response",
        phase: null
      },
      {
        id: "entry-8",
        timestamp: "2026-06-22T10:05:00.000Z",
        role: "user",
        text: "Final prompt",
        phase: null
      },
      {
        id: "entry-9",
        timestamp: "2026-06-22T10:06:00.000Z",
        role: "assistant",
        text: "Final response",
        phase: null
      }
    ]
  };

  const application = fakeApplication({
    agentSessionDetailResponse: detail,
    agentSessionVersionResponse: null
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const updatesUrl =
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-updates` +
      "?chatMessageTail=40&transcriptDetail=summary&baseItemKey=entry-7&overlapItemCount=1";
    const response = await fetch(updatesUrl);
    const etag = response.headers.get("etag");
    const updates = await response.json() as {
      items: Array<{ key: string }>;
      replaceFromItemKey: string | null;
      sessionId: string;
    };

    assert.equal(response.status, 200);
    assert.equal(Boolean(etag), true);
    assert.equal(updates.sessionId, detail.id);
    assert.equal(updates.replaceFromItemKey, "entry-5");
    assert.deepEqual(
      updates.items.map((item) => item.key),
      ["entry-5", "entry-7", "entry-8", "entry-9"]
    );

    const unchangedResponse = await fetch(updatesUrl, {
      headers: {
        "if-none-match": etag ?? ""
      }
    });

    assert.equal(unchangedResponse.status, 304);
    assert.equal(unchangedResponse.headers.get("cache-control"), "no-cache");
    assert.equal(await unchangedResponse.text(), "");
  });
});

test("agent transcript updates gzips large JSON responses when accepted", async () => {
  const detail: AgentSessionDetail = {
    ...agentSessionDetail(),
    transcript: Array.from({ length: 80 }, (_, index) => ({
      id: `entry-${index + 1}`,
      timestamp: new Date(Date.UTC(2026, 5, 22, 10, 0, index)).toISOString(),
      role: index % 2 === 0 ? "user" : "assistant",
      text: `Transcript entry ${index + 1} ${"x".repeat(160)}`,
      phase: null
    }))
  };

  const application = fakeApplication({
    agentSessionDetailResponse: detail,
    agentSessionVersionResponse: null
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-updates?chatMessageTail=80&transcriptDetail=summary`,
      {
        headers: {
          "accept-encoding": "gzip"
        }
      }
    );
    const transcriptUpdates = await response.json() as AgentTranscriptViewResponse & {
      replaceFromItemKey: string | null;
    };

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-encoding"), "gzip");
    assert.match(response.headers.get("vary") ?? "", /\bAccept-Encoding\b/i);
    assert.equal(transcriptUpdates.sessionId, detail.id);
    assert.equal(transcriptUpdates.replaceFromItemKey, transcriptUpdates.items[0]?.key ?? null);
    assert.equal(transcriptUpdates.items.length > 0, true);
  });
});

test("agent transcript view gzips large JSON responses when accepted", async () => {
  const detail: AgentSessionDetail = {
    ...agentSessionDetail(),
    transcript: Array.from({ length: 80 }, (_, index) => ({
      id: `entry-${index + 1}`,
      timestamp: new Date(Date.UTC(2026, 5, 22, 10, 0, index)).toISOString(),
      role: index % 2 === 0 ? "user" : "assistant",
      text: `Transcript entry ${index + 1} ${"x".repeat(160)}`,
      phase: null
    }))
  };

  const application = fakeApplication({
    agentSessionDetailResponse: detail,
    agentSessionVersionResponse: null
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-view?chatMessageTail=80&transcriptDetail=summary`,
      {
        headers: {
          "accept-encoding": "gzip"
        }
      }
    );
    const transcriptView = await response.json() as AgentTranscriptViewResponse;

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-encoding"), "gzip");
    assert.match(response.headers.get("vary") ?? "", /\bAccept-Encoding\b/i);
    assert.equal(transcriptView.sessionId, detail.id);
    assert.equal(transcriptView.items.length > 0, true);
  });
});

test("agent transcript view skips gzip when route compression is disabled", async () => {
  const detail: AgentSessionDetail = {
    ...agentSessionDetail(),
    transcript: Array.from({ length: 80 }, (_, index) => ({
      id: `entry-${index + 1}`,
      timestamp: new Date(Date.UTC(2026, 5, 22, 10, 0, index)).toISOString(),
      role: index % 2 === 0 ? "user" : "assistant",
      text: `Transcript entry ${index + 1} ${"x".repeat(160)}`,
      phase: null
    }))
  };

  const application = fakeApplication({
    agentSessionDetailResponse: detail,
    agentSessionVersionResponse: null
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      httpCompression: "off",
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-view?chatMessageTail=80&transcriptDetail=summary`,
      {
        headers: {
          "accept-encoding": "gzip"
        }
      }
    );
    const transcriptView = await response.json() as AgentTranscriptViewResponse;

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-encoding"), null);
    assert.equal(response.headers.get("vary"), null);
    assert.equal(transcriptView.sessionId, detail.id);
    assert.equal(transcriptView.items.length > 0, true);
  });
});

test("session routes keep response shape for detail and commands", async () => {
  const session = sessionDetail();

  session.logs = [
    ...session.logs,
    {
      id: "log-2",
      stream: "stderr",
      text: "late warning",
      timestamp: "2026-06-22T10:01:30.000Z"
    }
  ];
  const application = fakeApplication({
    sessions: [session]
  });
  const app = createTestApp((target) => {
    installSessionRoutes(target, {
      decorateSession,
      manualCommands: application.manualCommands,
      managedSessions: application.managedSessions,
    });
  });

  await withServer(app, async (baseUrl) => {
    const detail = await requestJson<SessionDetail>(`${baseUrl}/api/sessions/session-1`);
    const chatDetailResponse = await fetch(`${baseUrl}/api/sessions/session-1?view=chat`);
    const chatDetailEtag = chatDetailResponse.headers.get("etag");

    assert.equal(chatDetailResponse.ok, true);

    assert.equal(Boolean(chatDetailEtag), true);
    const chatDetail = (await chatDetailResponse.json()) as SessionDetail;
    const unchangedChatDetailResponse = await fetch(`${baseUrl}/api/sessions/session-1?view=chat`, {
      headers: {
        "if-none-match": chatDetailEtag ?? ""
      }
    });
    const debugDetailResponse = await fetch(`${baseUrl}/api/sessions/session-1?view=debug`);
    const debugDetailEtag = debugDetailResponse.headers.get("etag");

    assert.equal(debugDetailResponse.ok, true);

    assert.equal(Boolean(debugDetailEtag), true);
    const debugDetail = (await debugDetailResponse.json()) as SessionDetail;
    const unchangedDebugDetailResponse = await fetch(`${baseUrl}/api/sessions/session-1?view=debug`, {
      headers: {
        "if-none-match": debugDetailEtag ?? ""
      }
    });
    const debugTailResponse = await fetch(`${baseUrl}/api/sessions/session-1?view=debug&logTail=1`);

    assert.equal(debugTailResponse.ok, true);
    const debugTail = (await debugTailResponse.json()) as SessionDetail;
    const chatRefreshResponse = await fetch(`${baseUrl}/api/sessions/session-1/refresh-git?view=chat`, {
      method: "POST"
    });

    assert.equal(chatRefreshResponse.ok, true);
    const chatRefresh = (await chatRefreshResponse.json()) as SessionDetail;
    const diffRefreshResponse = await fetch(`${baseUrl}/api/sessions/session-1/refresh-git?view=diff`, {
      method: "POST"
    });
    const diffRefreshEtag = diffRefreshResponse.headers.get("etag");

    assert.equal(diffRefreshResponse.ok, true);

    assert.equal(Boolean(diffRefreshEtag), true);
    const diffRefresh = (await diffRefreshResponse.json()) as SessionDetail;
    const unchangedDiffRefreshResponse = await fetch(
      `${baseUrl}/api/sessions/session-1/refresh-git?view=diff`,
      {
        headers: {
          "if-none-match": diffRefreshEtag ?? ""
        },
        method: "POST"
      }
    );
    const input = await requestJson<SessionDetail>(`${baseUrl}/api/sessions/session-1/input`, {
      body: {
        input: "continue"
      },
      method: "POST"
    });
    const preview = await requestJson<SessionDetail>(`${baseUrl}/api/sessions/session-1/preview`, {
      body: {
        port: 4173,
        networkMode: "deskcue-host"
      },
      method: "POST"
    });
    const previewArtifact = await requestJson<SessionDetail>(
      `${baseUrl}/api/sessions/session-1/preview/artifacts`,
      {
        body: {
          viewport: "mobile"
        },
        method: "POST"
      }
    );
    const stopped = await requestJson<SessionDetail>(`${baseUrl}/api/sessions/session-1/stop`, {
      method: "POST"
    });
    const compactStopped = await requestJson<SessionSummary>(
      `${baseUrl}/api/sessions/session-1/stop?compact=1`,
      {
        method: "POST"
      }
    );
    const externalClaudeBackgroundStopCapability = await requestJson(
      `${baseUrl}/api/sessions/session-1/external-claude-background-stop-capability`
    );
    const externalClaudeBackgroundStopped = await requestJson<SessionDetail>(
      `${baseUrl}/api/sessions/session-1/external-claude-background-stop?compact=1`,
      {
        method: "POST"
      }
    );
    const externalForceStopCapability = await requestJson(
      `${baseUrl}/api/sessions/session-1/external-force-stop-capability`
    );
    const externalForceStopped = await requestJson<SessionDetail>(
      `${baseUrl}/api/sessions/session-1/external-force-stop?compact=1`,
      {
        body: {
          processCreatedAt: "2026-07-30T13:23:00.000Z",
          processId: 310
        },
        method: "POST"
      }
    );
    const externalDesktopInterruptCapability = await requestJson(
      `${baseUrl}/api/sessions/session-1/external-desktop-interrupt-capability`
    );
    const externalDesktopInterrupted = await requestJson<SessionDetail>(
      `${baseUrl}/api/sessions/session-1/external-desktop-interrupt?compact=1`,
      {
        method: "POST"
      }
    );
    const externalDesktopOpen = await requestJson(
      `${baseUrl}/api/sessions/session-1/external-desktop-open`,
      {
        method: "POST"
      }
    );
    const invalidExternalForceStop = await fetch(
      `${baseUrl}/api/sessions/session-1/external-force-stop`,
      {
        body: JSON.stringify({
          processId: 310
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      }
    );
    const invalidPreview = await fetch(`${baseUrl}/api/sessions/session-1/preview`, {
      body: JSON.stringify({
        port: 0
      }),
      headers: {
        "content-type": "application/json"
      },
      method: "POST"
    });
    const missing = await fetch(`${baseUrl}/api/sessions/missing`);

    assertDecoratedSession(detail);
    assert.deepEqual(chatDetail.logs, []);
    assert.deepEqual(chatDetail.inputHistory, []);
    assert.deepEqual(chatDetail.git.changedFiles, detail.git.changedFiles);
    assert.equal(chatDetail.git.diff, "");
    assert.equal(unchangedChatDetailResponse.status, 304);
    assert.equal(await unchangedChatDetailResponse.text(), "");
    assert.deepEqual(debugDetail.logs, detail.logs);
    assert.deepEqual(debugDetail.inputHistory, detail.inputHistory);
    assert.deepEqual(debugDetail.git.changedFiles, detail.git.changedFiles);
    assert.equal(debugDetail.git.diff, "");
    assert.deepEqual(debugTail.logs.map((log) => log.id), ["log-2"]);
    assert.equal(debugTail.git.diff, "");
    assert.equal(unchangedDebugDetailResponse.status, 304);
    assert.equal(await unchangedDebugDetailResponse.text(), "");
    assert.deepEqual(chatRefresh.logs, []);
    assert.deepEqual(chatRefresh.inputHistory, []);
    assert.deepEqual(chatRefresh.git.changedFiles, detail.git.changedFiles);
    assert.equal(chatRefresh.git.diff, "");
    assert.deepEqual(diffRefresh.logs, []);
    assert.deepEqual(diffRefresh.inputHistory, []);
    assert.deepEqual(diffRefresh.git.changedFiles, detail.git.changedFiles);
    assert.equal(diffRefresh.git.diff, detail.git.diff);
    assert.deepEqual(application.managedSessionGitRefreshRequests, [
      {
        includeDiff: false,
        sessionId: "session-1"
      },
      {
        includeDiff: true,
        sessionId: "session-1"
      },
      {
        includeDiff: true,
        sessionId: "session-1"
      }
    ]);
    assert.equal(unchangedDiffRefreshResponse.status, 304);
    assert.equal(await unchangedDiffRefreshResponse.text(), "");
    assert.deepEqual(input.inputHistory, ["continue"]);
    assert.equal(preview.preview.port, 4173);
    assert.equal(preview.preview.active, true);
    assert.equal(preview.preview.networkMode, "deskcue-host");
    assert.equal(preview.preview.targetUrl, "http://127.0.0.1:4173");
    assert.equal(previewArtifact.preview.artifacts?.length, 1);
    assert.equal(previewArtifact.preview.artifacts?.[0]?.viewport, "mobile");
    assert.equal(stopped.status, "stopped");
    assert.equal(stopped.finishedAt, "2026-06-22T10:05:00.000Z");
    assert.equal(compactStopped.status, "stopped");
    assert.equal("logs" in compactStopped, false);
    assert.equal(compactStopped.git.diff, "");
    assert.deepEqual(externalClaudeBackgroundStopCapability, {
      jobId: "claude-background-1",
      kind: "available",
      state: "working"
    });

    assert.equal(externalClaudeBackgroundStopped.id, "session-1");
    assert.deepEqual(application.externalClaudeBackgroundStopRequests, ["session-1"]);
    assert.deepEqual(externalForceStopCapability, {
      kind: "available",
      processCreatedAt: "2026-07-30T13:23:00.000Z",
      processId: 310
    });

    assert.equal(externalForceStopped.id, "session-1");
    assert.deepEqual(application.externalForceStopRequests, [
      {
        processCreatedAt: "2026-07-30T13:23:00.000Z",
        processId: 310,
        sessionId: "session-1"
      }
    ]);
    assert.deepEqual(externalDesktopInterruptCapability, { kind: "available" });
    assert.equal(externalDesktopInterrupted.id, "session-1");
    assert.deepEqual(application.externalDesktopInterruptRequests, ["session-1"]);
    assert.deepEqual(externalDesktopOpen, { requested: true });
    assert.deepEqual(application.externalCodexDesktopOpenRequests, ["session-1"]);
    assert.equal(invalidExternalForceStop.status, 400);
    assert.deepEqual(await invalidExternalForceStop.json(), {
      error: "Field processCreatedAt must be a non-empty string."
    });

    assert.equal(invalidPreview.status, 400);
    assert.deepEqual(await invalidPreview.json(), {
      error: "Field port must be an integer between 1 and 65535, or null."
    });

    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), {
      error: "Session not found."
    });
  });
});

test("agent session routes trim transcript and preserve attached metadata", async () => {
  const detail = agentSessionDetail();
  const application = fakeApplication({
    agentSessionPatch: {
      attachMode: "read_only",
      attachModeReason: "Active in another client."
    } as Partial<AgentSessionSummary>,
    sessions: [],
    workspaces: [workspaceSummary()]
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const sessionPage = await requestJson<AgentSessionsResponse>(`${baseUrl}/api/agents/sessions`);
    const defaultDetail = await requestJson<AgentSessionDetail>(
      `${baseUrl}/api/agents/sessions/${detail.id}`
    );
    const trimmed = await requestJson<AgentSessionDetail>(
      `${baseUrl}/api/agents/sessions/${detail.id}?transcriptTail=1`
    );
    const transcriptPage = await requestJson<{
      entries: AgentSessionDetail["transcript"];
      hasMore: boolean;
      transcriptView: NonNullable<AgentSessionDetail["transcriptView"]>;
    }>(
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-page?beforeEntryId=entry-5&limit=2`
    );
    const missing = await fetch(`${baseUrl}/api/agents/sessions/missing`);

    assert.equal(sessionPage.sessions.length, 1);
    assert.equal(sessionPage.hasMore, false);
    assert.equal(sessionPage.sessions[0].attachMode, "read_only");
    assert.equal(sessionPage.sessions[0].attachModeReason, "Active in another client.");
    assert.equal(defaultDetail.transcript.length, 6);
    assert.deepEqual(application.agentSessionDetailRequests[0], {
      chatMessageTail: 24,
      transcriptTail: undefined
    });

    assert.deepEqual(transcriptPage.entries.map((entry) => entry.id), ["entry-3", "entry-4"]);
    assert.equal(transcriptPage.hasMore, true);
    assert.deepEqual(
      transcriptPage.transcriptView.items
        .filter((item) => item.type === "message")
        .map((item) => item.entry.id),
      ["entry-3", "entry-4"]
    );

    assert.deepEqual(application.agentSessionDetailRequests[2], {
      chatMessageTail: 1,
      transcriptTail: undefined
    });

    assert.equal(trimmed.transcript.length, 1);
    assert.equal(trimmed.transcript[0].id, "entry-5");
    assert.equal(trimmed.attachMode, "read_only");
    assert.equal(trimmed.attachModeReason, "Active in another client.");
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), {
      error: "Agent session not found."
    });
  });
});

test("agent session list routes keep roots by default and support direct-child queries", async () => {
  const application = fakeApplication({});
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    await requestJson<AgentSessionsResponse>(`${baseUrl}/api/agents/sessions`);
    await requestJson<AgentSessionsResponse>(
      `${baseUrl}/api/agents/sessions?includeSubagents=1&parentSessionId=${
        encodeURIComponent("codex:parent")
      }&includeLiveMetadata=1`
    );

    assert.deepEqual(application.agentSessionPageRequests, [
      {
        includeLiveMetadata: false,
        limit: 100,
        options: {
          includeSubagents: false,
          offset: 0,
          parentSessionId: null,
          query: null,
          sourceId: null
        }
      },
      {
        includeLiveMetadata: true,
        limit: 100,
        options: {
          includeSubagents: true,
          offset: 0,
          parentSessionId: "codex:parent",
          query: null,
          sourceId: null
        }
      }
    ]);
  });
});

test("agent transcript page bridges from a bounded source window to its predecessor", async () => {
  const previousWindowEntries: AgentTranscriptEntry[] = [
    {
      id: "source-1@0~100-0",
      timestamp: "2026-06-22T09:56:00.000Z",
      role: "user",
      text: "Older prompt",
      phase: null
    },
    {
      id: "source-1@0~100-1",
      timestamp: "2026-06-22T09:57:00.000Z",
      role: "assistant",
      text: "Older response",
      phase: null
    }
  ];
  const application = fakeApplication({
    agentTranscriptPreviousWindowResponse: {
      entries: previousWindowEntries,
      hasMore: false
    },
    sessions: [],
    workspaces: [workspaceSummary()]
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const page = await requestJson<{
      entries: AgentTranscriptEntry[];
      hasMore: boolean;
    }>(
      `${baseUrl}/api/agents/sessions/codex:source-1/transcript-page?beforeEntryId=source-1%40100-0&limit=20`
    );

    assert.deepEqual(page.entries.map((entry) => entry.id), previousWindowEntries.map((entry) => entry.id));
    assert.equal(page.hasMore, false);
    assert.deepEqual(application.agentTranscriptPreviousWindowRequests, [{
      beforeEntryId: "source-1@100-0"
    }]);
  });
});

test("agent session route keeps chat-tail detail responses without entry trimming", async () => {
  const detail: AgentSessionDetail = {
    ...agentSessionDetail(),
    transcript: [
      {
        id: "entry-0",
        timestamp: "2026-06-22T10:00:00.000Z",
        role: "user",
        text: "Latest prompt",
        phase: null
      },
      {
        id: "entry-1",
        timestamp: "2026-06-22T10:00:01.000Z",
        role: "assistant",
        text: "Latest response",
        phase: null
      },
      ...Array.from({ length: 50 }, (_, index) => ({
        id: `entry-${index + 2}`,
        timestamp: `2026-06-22T10:01:${String(index).padStart(2, "0")}.000Z`,
        role: "tool" as const,
        text: `Tool completed ${index}`,
        phase: null
      }))
    ]
  };

  const application = fakeApplication({
    agentSessionDetailResponse: detail
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const defaultDetail = await requestJson<AgentSessionDetail>(
      `${baseUrl}/api/agents/sessions/${detail.id}`
    );

    assert.deepEqual(application.agentSessionDetailRequests[0], {
      chatMessageTail: 24,
      transcriptTail: undefined
    });

    assert.equal(defaultDetail.transcript.length, detail.transcript.length);
    assert.equal(defaultDetail.transcript[0]?.role, "user");
    assert.equal(defaultDetail.transcript[1]?.role, "assistant");
  });
});

test("agent session route can summarize and hydrate transcript entries", async () => {
  const longToolOutput = "tool output ".repeat(120);
  const detail: AgentSessionDetail = {
    ...agentSessionDetail(),
    transcript: [
      {
        id: "entry-0",
        timestamp: "2026-06-22T10:00:00.000Z",
        role: "user",
        text: "Prompt",
        phase: null
      },
      {
        id: "entry-1",
        timestamp: "2026-06-22T10:00:01.000Z",
        role: "tool",
        text: longToolOutput,
        phase: null,
        parts: [
          {
            type: "tool_result",
            toolName: "shell_command",
            status: "completed",
            text: longToolOutput
          }
        ]
      },
      {
        id: "entry-2",
        timestamp: "2026-06-22T10:00:02.000Z",
        role: "tool",
        text: longToolOutput,
        phase: null,
        parts: [
          {
            type: "tool_result",
            toolName: "evaluate_script",
            status: "completed",
            text: longToolOutput
          }
        ]
      },
      {
        id: "entry-3",
        timestamp: "2026-06-22T10:00:03.000Z",
        role: "assistant",
        text: "Done",
        phase: null
      }
    ]
  };

  const application = fakeApplication({
    agentSessionDetailResponse: detail
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const summarized = await requestJson<AgentSessionDetail>(
      `${baseUrl}/api/agents/sessions/${detail.id}?chatMessageTail=40&transcriptDetail=summary`
    );
    const metadataOnly = await requestJson<AgentSessionDetail>(
      `${baseUrl}/api/agents/sessions/${detail.id}?chatMessageTail=40&transcriptDetail=summary&omitTranscript=1`
    );
    const hydrated = await requestJson<{
      entries: AgentSessionDetail["transcript"];
    }>(
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-entries?entryIds=entry-1,entry-2`
    );
    const hydratedResponse = await fetch(
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-entries?entryIds=entry-1,entry-2`
    );
    const hydratedEtag = hydratedResponse.headers.get("etag");

    assert.equal(hydratedResponse.ok, true);

    assert.equal(Boolean(hydratedEtag), true);
    const unchangedHydratedResponse = await fetch(
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-entries?entryIds=entry-1,entry-2`,
      {
        headers: {
          "if-none-match": hydratedEtag ?? ""
        }
      }
    );

    assert.equal(unchangedHydratedResponse.status, 304);
    assert.equal(await unchangedHydratedResponse.text(), "");
    const postHydrated = await requestJson<{
      entries: AgentSessionDetail["transcript"];
    }>(
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-entries`,
      {
        body: {
          entryIds: ["entry-1", "entry-2"]
        },
        method: "POST"
      }
    );

    const summarizedToolEntry = summarized.transcript.find((entry) =>
      entry.sourceEntryIds?.includes("entry-1")
    );

    assert.equal(summarizedToolEntry?.isCompact, true);
    assert.deepEqual(summarizedToolEntry?.sourceEntryIds, ["entry-1", "entry-2"]);
    assert.ok((summarizedToolEntry?.text.length ?? 0) < longToolOutput.length);
    assert.equal(
      summarizedToolEntry?.parts?.[0]?.type === "status"
        ? summarizedToolEntry.parts[0].label
        : false,
      "Tool events"
    );

    assert.equal(hydrated.entries.length, 2);
    assert.equal(hydrated.entries[0]?.id, "entry-1");
    assert.equal(hydrated.entries[0]?.isCompact, undefined);
    assert.equal(hydrated.entries[0]?.text, longToolOutput);
    assert.deepEqual(postHydrated.entries.map((entry) => entry.id), ["entry-1", "entry-2"]);
    assert.deepEqual(metadataOnly.transcript, []);
    assert.equal(metadataOnly.id, detail.id);
    assert.deepEqual(application.agentSessionDetailRequests.slice(0, 2), [
      {
        chatMessageTail: 40,
        lightweight: "bounded-exact-ids",
        transcriptTail: undefined
      },
      {
        chatMessageTail: 40,
        lightweight: "bounded-exact-ids",
        transcriptTail: undefined
      }
    ]);
  });
});

test("agent transcript entries exact miss does not read bounded session detail", async () => {
  const detail = agentSessionDetail();
  const application = fakeApplication({
    agentSessionDetailResponse: detail
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const hydrated = await requestJson<{
      entries: AgentSessionDetail["transcript"];
    }>(
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-entries?entryIds=missing-entry`
    );

    assert.deepEqual(hydrated.entries, []);
    assert.equal(application.agentSessionDetailRequests.length, 0);
  });
});

test("agent transcript entries exact miss is cached for the same source version", async () => {
  const detail = agentSessionDetail();
  const application = fakeApplication({
    agentSessionDetailResponse: detail
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const url =
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-entries?entryIds=missing-entry`;
    const firstHydration = await requestJson<{
      entries: AgentSessionDetail["transcript"];
    }>(url);
    const secondHydration = await requestJson<{
      entries: AgentSessionDetail["transcript"];
    }>(url);

    assert.deepEqual(firstHydration.entries, []);
    assert.deepEqual(secondHydration.entries, []);
    assert.deepEqual(application.agentTranscriptEntriesRequests, [
      {
        entryIds: ["missing-entry"]
      }
    ]);
  });
});

test("agent session summary compacts diff activity for live chat hydration", async () => {
  const longDiff = [
    "diff --git a/src/app.ts b/src/app.ts",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,3 +1,4 @@",
    "-old line",
    "+new line",
    "+another line",
    " context"
  ].join("\n");
  const detail: AgentSessionDetail = {
    ...agentSessionDetail(),
    transcript: [
      {
        id: "entry-0",
        timestamp: "2026-06-22T10:00:00.000Z",
        role: "user",
        text: "Prompt",
        phase: null
      },
      {
        id: "entry-1",
        timestamp: "2026-06-22T10:00:01.000Z",
        role: "tool",
        text: "Changed src/app.ts",
        phase: null,
        parts: [
          {
            type: "diff",
            title: "src/app.ts",
            text: longDiff,
            filePath: "src/app.ts",
            changeType: "update"
          }
        ]
      },
      {
        id: "entry-2",
        timestamp: "2026-06-22T10:00:02.000Z",
        role: "tool",
        text: "Changed src/other.ts",
        phase: null,
        parts: [
          {
            type: "diff",
            title: "src/other.ts",
            text: longDiff.replace(/src\/app/g, "src/other"),
            filePath: "src/other.ts",
            changeType: "update"
          }
        ]
      },
      {
        id: "entry-3",
        timestamp: "2026-06-22T10:00:03.000Z",
        role: "assistant",
        text: "Done",
        phase: null
      }
    ]
  };

  const application = fakeApplication({
    agentSessionDetailResponse: detail
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const summarized = await requestJson<AgentSessionDetail>(
      `${baseUrl}/api/agents/sessions/${detail.id}?chatMessageTail=40&transcriptDetail=summary`
    );
    const compactChangeEntry = summarized.transcript.find((entry) =>
      entry.sourceEntryIds?.includes("entry-1")
    );
    const compactDiffParts =
      compactChangeEntry?.parts?.filter((part) => part.type === "diff") ?? [];
    const compactStatusParts =
      compactChangeEntry?.parts?.filter((part) => part.type === "status") ?? [];
    const hydrated = await requestJson<{
      entries: AgentSessionDetail["transcript"];
    }>(
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-entries?entryIds=entry-1,entry-2`
    );

    assert.equal(compactChangeEntry?.isCompact, true);
    assert.deepEqual(compactChangeEntry?.sourceEntryIds, ["entry-1", "entry-2"]);
    assert.equal(compactDiffParts.length, 2);
    assert.equal(compactStatusParts.length, 0);
    assert.equal(compactDiffParts[0]?.type === "diff" ? compactDiffParts[0].text : "", "[diff hidden in live view]");
    assert.equal(compactDiffParts[0]?.type === "diff" ? compactDiffParts[0].additions : 0, 2);
    assert.equal(compactDiffParts[0]?.type === "diff" ? compactDiffParts[0].deletions : 0, 1);
    assert.equal(hydrated.entries[0]?.parts?.[0]?.type === "diff"
      ? hydrated.entries[0].parts[0].text
      : "", longDiff);
  });
});

test("agent transcript view keeps a growing activity group's identity stable", () => {
  const baseTranscript: AgentTranscriptEntry[] = [
    {
      id: "entry-user",
      timestamp: "2026-06-22T10:00:00.000Z",
      role: "user",
      text: "Inspect the project",
      phase: null
    },
    {
      id: "entry-tool-1",
      timestamp: "2026-06-22T10:00:01.000Z",
      role: "tool",
      text: "First tool result",
      phase: null,
      parts: [{
        type: "tool_result",
        toolName: "shell_command",
        status: "completed",
        text: "First tool result"
      }]
    }
  ];
  const growingTranscript: AgentTranscriptEntry[] = [
    ...baseTranscript,
    {
      id: "entry-tool-2",
      timestamp: "2026-06-22T10:00:02.000Z",
      role: "tool",
      text: "Second tool result",
      phase: null,
      parts: [{
        type: "tool_result",
        toolName: "shell_command",
        status: "completed",
        text: "Second tool result"
      }]
    }
  ];

  const readTools = (transcript: AgentTranscriptEntry[]) => buildAgentTranscriptView({
    ...agentSessionDetail(),
    transcript
  }).items
    .filter((item) => item.type === "activity")
    .map((item) => item.type === "activity" ? item.activity : null)
    .find((activity) => activity?.kind === "tools");

  const initialTools = readTools(baseTranscript);
  const grownTools = readTools(growingTranscript);

  assert.ok(initialTools);
  assert.ok(grownTools);
  assert.equal(initialTools.id, grownTools.id);
  assert.equal(initialTools.label, "Tools (1)");
  assert.equal(grownTools.label, "Tools (2)");
});

test("agent transcript summary keeps standalone system records out of assistant Details", () => {
  const view = buildAgentTranscriptView(summarizeAgentSessionTranscript({
    ...agentSessionDetail(),
    transcript: [
      {
        id: "entry-user-1",
        timestamp: "2026-06-22T10:00:00.000Z",
        role: "user",
        text: "Fix the issue",
        phase: null
      },
      {
        id: "entry-detail-1",
        timestamp: "2026-06-22T10:00:01.000Z",
        role: "commentary",
        text: "Investigating the issue",
        phase: "commentary"
      },
      {
        id: "entry-tool-1",
        timestamp: "2026-06-22T10:00:02.000Z",
        role: "tool",
        text: "Tests passed",
        phase: null,
        parts: [{
          type: "tool_result",
          toolName: "shell_command",
          status: "completed",
          text: "Tests passed"
        }]
      },
      {
        id: "entry-context-1",
        timestamp: "2026-06-22T10:00:02.500Z",
        role: "system",
        text: "Context compressed",
        phase: "context_compacted",
        parts: [{
          type: "status",
          label: "Context compressed",
          detail: "Codex summarized earlier messages"
        }]
      },
      {
        id: "entry-assistant-1",
        timestamp: "2026-06-22T10:00:03.000Z",
        role: "assistant",
        text: "Fixed.",
        phase: null
      },
      {
        id: "entry-completed-1",
        timestamp: "2026-06-22T10:00:04.000Z",
        role: "system",
        text: "Turn completed",
        phase: null,
        parts: [{ type: "status", label: "Turn completed", detail: "Completed in 4s" }]
      },
      {
        id: "entry-user-2",
        timestamp: "2026-06-22T10:00:05.000Z",
        role: "user",
        text: "One more thing",
        phase: null
      },
      {
        id: "entry-started-2",
        timestamp: "2026-06-22T10:00:06.000Z",
        role: "system",
        text: "Turn started",
        phase: null,
        parts: [{ type: "status", label: "Turn started", detail: null }]
      }
    ]
  }));

  const finalMessage = view.items.find(
    (item) => item.type === "message" && item.key === "entry-assistant-1"
  );

  assert.ok(finalMessage && finalMessage.type === "message");
  assert.deepEqual(
    finalMessage.activities.map((activity) => [activity.kind, activity.sourceEntryIds]),
    [
      ["details", ["entry-detail-1"]],
      ["tools", ["entry-tool-1"]]
    ]
  );

  assert.equal(
    view.items.some((item) => item.type === "activity" && item.activity.kind === "details"),
    false
  );

  assert.equal(
    view.items.some((item) => item.type === "activity" && item.activity.kind === "context"),
    true
  );
});

test("agent transcript view groups timeline activity and hydrates activity groups", async () => {
  const longToolOutput = "tool output ".repeat(80);
  const diffText = [
    "diff --git a/apps/web/src/app.ts b/apps/web/src/app.ts",
    "--- a/apps/web/src/app.ts",
    "+++ b/apps/web/src/app.ts",
    "@@ -1,2 +1,3 @@",
    "-old",
    "+new",
    "+extra"
  ].join("\n");
  const detail: AgentSessionDetail = {
    ...agentSessionDetail(),
    transcript: [
      {
        id: "entry-0",
        timestamp: "2026-06-22T10:00:00.000Z",
        role: "user",
        text: "Run tests",
        phase: null
      },
      {
        id: "entry-1",
        timestamp: "2026-06-22T10:00:01.000Z",
        role: "commentary",
        text: "Checking current status",
        phase: null,
        parts: [
          {
            type: "markdown",
            text: "Checking current status"
          }
        ]
      },
      {
        id: "entry-2",
        timestamp: "2026-06-22T10:00:02.000Z",
        role: "tool",
        text: longToolOutput,
        phase: null,
        parts: [
          {
            type: "tool_result",
            toolName: "shell_command",
            status: "completed",
            text: longToolOutput
          }
        ]
      },
      {
        id: "entry-3",
        timestamp: "2026-06-22T10:00:03.000Z",
        role: "tool",
        text: "Changed app.ts",
        phase: null,
        parts: [
          {
            type: "diff",
            title: "apps/web/src/app.ts",
            text: diffText,
            filePath: "apps/web/src/app.ts",
            changeType: "update"
          }
        ]
      }
    ]
  };

  const application = fakeApplication({
    agentSessionDetailResponse: detail
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const view = await requestJson<AgentTranscriptViewResponse>(
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-view?chatMessageTail=40&transcriptDetail=summary`
    );
    const transcriptViewUrl =
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-view?chatMessageTail=40&transcriptDetail=summary`;
    const transcriptViewResponse = await fetch(transcriptViewUrl);
    const transcriptViewEtag = transcriptViewResponse.headers.get("etag");

    assert.equal(transcriptViewResponse.ok, true);

    assert.equal(Boolean(transcriptViewEtag), true);

    const detailRequestCountBeforeUnchangedTranscriptView = application.agentSessionDetailRequests.length;
    const unchangedTranscriptViewResponse = await fetch(transcriptViewUrl, {
      headers: {
        "if-none-match": transcriptViewEtag ?? ""
      }
    });

    assert.equal(unchangedTranscriptViewResponse.status, 304);
    assert.equal(await unchangedTranscriptViewResponse.text(), "");
    assert.equal(
      application.agentSessionDetailRequests.length,
      detailRequestCountBeforeUnchangedTranscriptView
    );

    const viewWithSummary = await requestJson<AgentTranscriptViewResponse>(
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-view?chatMessageTail=40&transcriptDetail=summary&includeSessionSummary=1`
    );
    const activities = view.items
      .filter((item) => item.type === "activity")
      .map((item) => item.type === "activity" ? item.activity : null)
      .filter((activity): activity is NonNullable<typeof activity> => Boolean(activity));
    const details = activities.find((activity) => activity.kind === "details");
    const tools = activities.find((activity) => activity.kind === "tools");
    const changes = activities.find((activity) => activity.kind === "changes");

    assert.deepEqual(activities.map((activity) => activity.kind), ["details", "tools", "changes"]);
    assert.equal(details?.label, "Details (1)");
    assert.equal(tools?.label, "Tools (1)");
    assert.equal(changes?.label, "Changes (1)");
    assert.equal(view.latestWaitingDetailEntry?.id, "entry-1");
    assert.equal(view.session, undefined);
    assert.equal(viewWithSummary.session?.id, detail.id);
    assert.equal("transcript" in (viewWithSummary.session ?? {}), false);
    assert.equal(tools?.entries[0]?.isCompact, true);
    assert.equal(
      tools?.entries[0]?.parts?.[0]?.type === "tool_result"
        ? tools.entries[0].parts[0].text
        : "",
      "[tool result hidden in live view]"
    );

    const hydratedTools = await requestJson<AgentTranscriptActivityGroupResponse>(
      `${baseUrl}/api/agents/sessions/${detail.id}/activity-groups/${encodeURIComponent(tools?.id ?? "")}`
    );
    const hydratedChanges = await requestJson<AgentTranscriptChangesResponse>(
      `${baseUrl}/api/agents/sessions/${detail.id}/changes/${encodeURIComponent(changes?.id ?? "")}`
    );
    const hydratedChangesResponse = await fetch(
      `${baseUrl}/api/agents/sessions/${detail.id}/changes/${encodeURIComponent(changes?.id ?? "")}`
    );
    const hydratedChangesEtag = hydratedChangesResponse.headers.get("etag");

    assert.equal(hydratedChangesResponse.ok, true);

    assert.equal(Boolean(hydratedChangesEtag), true);
    const unchangedHydratedChangesResponse = await fetch(
      `${baseUrl}/api/agents/sessions/${detail.id}/changes/${encodeURIComponent(changes?.id ?? "")}`,
      {
        headers: {
          "if-none-match": hydratedChangesEtag ?? ""
        }
      }
    );

    assert.equal(unchangedHydratedChangesResponse.status, 304);
    assert.equal(await unchangedHydratedChangesResponse.text(), "");
    const detailRequestCountBeforeFallbackChanges = application.agentSessionDetailRequests.length;
    const fallbackHydratedChanges = await requestJson<AgentTranscriptChangesResponse>(
      `${baseUrl}/api/agents/sessions/${detail.id}/changes/${encodeURIComponent("changes-tail-only")}?entryIds=${
        encodeURIComponent(changes?.sourceEntryIds?.join(",") ?? "")
      }`
    );
    const neighborHydratedChanges = await requestJson<AgentTranscriptChangesResponse>(
      `${baseUrl}/api/agents/sessions/${detail.id}/changes/${encodeURIComponent("changes-neighbor-only")}?entryIds=${
        encodeURIComponent("entry-4")
      }`
    );
    const detailRequestCountBeforeMissedEntryChanges = application.agentSessionDetailRequests.length;
    const fallbackFromMissedEntryChanges = await requestJson<AgentTranscriptChangesResponse>(
      `${baseUrl}/api/agents/sessions/${detail.id}/changes/${encodeURIComponent(changes?.id ?? "")}?entryIds=${
        encodeURIComponent("entry-99")
      }`
    );

    assert.equal(hydratedTools.group.kind, "tools");
    assert.equal(hydratedTools.group.entries[0]?.isCompact, undefined);
    assert.equal(hydratedTools.group.entries[0]?.text, longToolOutput);
    assert.equal(hydratedChanges.files.length, 1);
    assert.equal(hydratedChanges.files[0]?.displayPath, "apps/web/src/app.ts");
    assert.equal(hydratedChanges.files[0]?.additions, 2);
    assert.equal(hydratedChanges.files[0]?.deletions, 1);
    assert.equal(fallbackHydratedChanges.files.length, 1);
    assert.equal(fallbackHydratedChanges.files[0]?.displayPath, "apps/web/src/app.ts");
    assert.equal(neighborHydratedChanges.files.length, 1);
    assert.equal(neighborHydratedChanges.files[0]?.displayPath, "apps/web/src/app.ts");
    assert.equal(fallbackFromMissedEntryChanges.files.length, 1);
    assert.equal(fallbackFromMissedEntryChanges.files[0]?.displayPath, "apps/web/src/app.ts");
    assert.equal(
      application.agentSessionDetailRequests.length,
      detailRequestCountBeforeMissedEntryChanges + 1
    );

    assert.equal(
      detailRequestCountBeforeMissedEntryChanges,
      detailRequestCountBeforeFallbackChanges
    );
  });
});

test("agent transcript updates reuses cached transcript view for the same source version", async () => {
  const detail: AgentSessionDetail = {
    ...agentSessionDetail(),
    transcript: [
      ...agentSessionDetail().transcript,
      {
        id: "entry-6",
        timestamp: "2026-06-22T10:03:00.000Z",
        role: "assistant",
        text: "Latest answer",
        phase: null
      }
    ]
  };

  const application = fakeApplication({
    agentSessionDetailResponse: detail
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const view = await requestJson<AgentTranscriptViewResponse>(
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-view?chatMessageTail=40&transcriptDetail=summary`
    );
    const detailRequestCountBeforeUpdates = application.agentSessionDetailRequests.length;
    const baseItemKey = view.items.at(-1)?.key ?? "";
    const updates = await requestJson<AgentTranscriptViewResponse>(
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-updates?chatMessageTail=40&transcriptDetail=summary&baseItemKey=${
        encodeURIComponent(baseItemKey)
      }`
    );

    assert.equal(updates.sessionId, detail.id);
    assert.equal(application.agentSessionDetailRequests.length, detailRequestCountBeforeUpdates);
  });
});

test("agent transcript updates skips cached transcript view for running source versions", async () => {
  const detail: AgentSessionDetail = {
    ...agentSessionDetail(),
    transcript: [
      ...agentSessionDetail().transcript,
      {
        id: "entry-6",
        timestamp: "2026-06-22T10:03:00.000Z",
        role: "assistant",
        text: "Latest answer",
        phase: null
      }
    ]
  };

  const application = fakeApplication({
    agentSessionDetailResponse: detail,
    agentSessionPatch: {
      workState: "running"
    }
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const view = await requestJson<AgentTranscriptViewResponse>(
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-view?chatMessageTail=40&transcriptDetail=summary`
    );
    const detailRequestCountBeforeUpdates = application.agentSessionDetailRequests.length;
    const baseItemKey = view.items.at(-1)?.key ?? "";
    const updates = await requestJson<AgentTranscriptViewResponse>(
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-updates?chatMessageTail=40&transcriptDetail=summary&baseItemKey=${
        encodeURIComponent(baseItemKey)
      }`
    );

    assert.equal(updates.sessionId, detail.id);
    assert.equal(application.agentSessionDetailRequests.length, detailRequestCountBeforeUpdates + 1);
  });
});

test("agent transcript updates uses lightweight source window for running source deltas", async () => {
  const detail: AgentSessionDetail = {
    ...agentSessionDetail(),
    transcript: [
      {
        id: "entry-1",
        timestamp: "2026-06-22T10:00:00.000Z",
        role: "user",
        text: "Work on it",
        phase: null
      },
      {
        id: "entry-2",
        timestamp: "2026-06-22T10:00:01.000Z",
        role: "tool",
        text: "Tool call",
        phase: null
      },
      {
        id: "entry-3",
        timestamp: "2026-06-22T10:00:02.000Z",
        role: "tool",
        text: "Tool result",
        phase: null
      }
    ]
  };

  const application = fakeApplication({
    agentSessionDetailResponse: detail,
    agentSessionPatch: {
      workState: "running"
    },
    agentTranscriptWindowResponse: detail.transcript
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const updates = await requestJson<AgentTranscriptViewResponse & { replaceFromItemKey: string | null }>(
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-updates` +
        "?chatMessageTail=40&transcriptDetail=summary&baseItemKey=entry-1&baseSourceEntryId=entry-1"
    );

    assert.equal(updates.sessionId, detail.id);
    assert.equal(updates.replaceFromItemKey, "entry-1");
    assert.equal(application.agentTranscriptWindowRequests.length, 1);
    assert.deepEqual(application.agentTranscriptWindowRequests[0], {
      baseSourceEntryId: "entry-1",
      maxLineCount: 16_384,
      overlapLineCount: 96
    });

    assert.equal(application.agentSessionDetailRequests.length, 0);
  });
});

test("agent transcript updates falls back when lightweight source window misses the cursor", async () => {
  const detail: AgentSessionDetail = {
    ...agentSessionDetail(),
    transcript: [
      {
        id: "entry-1",
        timestamp: "2026-06-22T10:00:00.000Z",
        role: "user",
        text: "Work on it",
        phase: null
      },
      {
        id: "entry-2",
        timestamp: "2026-06-22T10:00:01.000Z",
        role: "assistant",
        text: "Done",
        phase: null
      }
    ]
  };

  const application = fakeApplication({
    agentSessionDetailResponse: detail,
    agentSessionPatch: {
      workState: "running"
    },
    agentTranscriptWindowResponse: [
      {
        id: "entry-2",
        timestamp: "2026-06-22T10:00:01.000Z",
        role: "assistant",
        text: "Done",
        phase: null
      }
    ]
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const updates = await requestJson<AgentTranscriptViewResponse & { replaceFromItemKey: string | null }>(
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-updates` +
        "?chatMessageTail=40&transcriptDetail=summary&baseItemKey=entry-1&baseSourceEntryId=entry-1"
    );

    assert.equal(updates.sessionId, detail.id);
    assert.equal(application.agentTranscriptWindowRequests.length, 1);
    assert.equal(application.agentSessionDetailRequests.length, 1);
    assert.equal(application.agentSessionDetailRequests[0]?.lightweight, "bounded-exact-ids");
  });
});

test("agent transcript updates falls back when a standalone activity is reparented to a reply", async () => {
  const detail: AgentSessionDetail = {
    ...agentSessionDetail(),
    transcript: [
      {
        id: "entry-1",
        timestamp: "2026-06-22T10:00:00.000Z",
        role: "user",
        text: "Work on it",
        phase: null
      },
      {
        id: "entry-2",
        timestamp: "2026-06-22T10:00:01.000Z",
        role: "tool",
        text: "Tool result",
        phase: null
      },
      {
        id: "entry-3",
        timestamp: "2026-06-22T10:00:02.000Z",
        role: "assistant",
        text: "Done",
        phase: null
      }
    ]
  };

  const application = fakeApplication({
    agentSessionDetailResponse: detail,
    agentSessionPatch: { workState: "idle" },
    agentTranscriptWindowResponse: detail.transcript.slice(1)
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const updates = await requestJson<AgentTranscriptViewResponse & { replaceFromItemKey: string | null }>(
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-updates` +
        "?chatMessageTail=40&transcriptDetail=summary&baseItemKey=stale-tools&baseSourceEntryId=entry-2"
    );
    const assistant = updates.items.find(
      (item) => item.type === "message" && item.entry.id === "entry-3"
    );

    assert.equal(application.agentTranscriptWindowRequests.length, 1);
    assert.equal(application.agentSessionDetailRequests.length, 1);
    assert.equal(updates.replaceFromItemKey, "entry-1");
    assert.equal(assistant?.type, "message");
    assert.deepEqual(assistant?.activities.map((activity) => activity.kind), ["tools"]);
    assert.equal(updates.items.some((item) => item.type === "activity"), false);
  });
});

test("agent transcript updates uses source tail window when the source cursor is stale", async () => {
  const detail: AgentSessionDetail = {
    ...agentSessionDetail(),
    transcript: [
      {
        id: "entry-1",
        timestamp: "2026-06-22T10:00:00.000Z",
        role: "user",
        text: "Old prompt",
        phase: null
      }
    ]
  };

  const application = fakeApplication({
    agentSessionDetailResponse: detail,
    agentTranscriptWindowResponse: [
      {
        id: "source-1@4096-1",
        timestamp: "2026-06-22T10:00:01.000Z",
        role: "assistant",
        text: "Recent answer",
        phase: null
      }
    ],
    agentTranscriptTailWindowResponse: [
      {
        id: "source-1@4096-0",
        timestamp: "2026-06-22T10:00:00.000Z",
        role: "user",
        text: "Tail prompt",
        phase: null
      },
      {
        id: "source-1@4096-1",
        timestamp: "2026-06-22T10:00:01.000Z",
        role: "assistant",
        text: "Tail answer",
        phase: null
      }
    ]
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const updates = await requestJson<AgentTranscriptViewResponse & { replaceFromItemKey: string | null }>(
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-updates` +
        "?chatMessageTail=40&transcriptDetail=summary&baseItemKey=old-item&baseSourceEntryId=entry-1"
    );

    assert.equal(updates.sessionId, detail.id);
    assert.equal(updates.replaceFromItemKey, null);
    assert.equal(updates.items.some((item) =>
      item.type === "message" && item.entry.text === "Tail answer"
    ), true);
    assert.deepEqual(application.agentTranscriptTailWindowRequests, [
      {
        chatMessageTail: 40
      }
    ]);
    assert.equal(application.agentTranscriptWindowRequests.length, 1);
    assert.equal(application.agentSessionDetailRequests.length, 0);
  });
});

test("agent transcript view compacts sparse changes source refs into spans", async () => {
  const diffText = [
    "diff --git a/src/file.ts b/src/file.ts",
    "--- a/src/file.ts",
    "+++ b/src/file.ts",
    "@@ -1,1 +1,1 @@",
    "-old",
    "+new"
  ].join("\n");
  const diffEntries = Array.from({ length: 12 }, (_, index) => ({
    id: `entry-${(index + 1) * 3}`,
    timestamp: `2026-06-22T10:00:${String(index + 1).padStart(2, "0")}.000Z`,
    role: "tool" as const,
    text: `Changed file ${index + 1}`,
    phase: null,
    parts: [
      {
        type: "diff" as const,
        title: `src/file-${index + 1}.ts`,
        text: diffText.replace(/file/g, `file-${index + 1}`),
        filePath: `src/file-${index + 1}.ts`,
        changeType: "update" as const
      }
    ]
  }));
  const detail: AgentSessionDetail = {
    ...agentSessionDetail(),
    transcript: [
      {
        id: "entry-0",
        timestamp: "2026-06-22T10:00:00.000Z",
        role: "user",
        text: "Update files",
        phase: null
      },
      ...diffEntries,
      {
        id: "entry-40",
        timestamp: "2026-06-22T10:00:13.000Z",
        role: "assistant",
        text: "Done",
        phase: null
      }
    ]
  };

  const application = fakeApplication({
    agentSessionDetailResponse: detail
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const view = await requestJson<AgentTranscriptViewResponse>(
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-view?chatMessageTail=40&transcriptDetail=summary`
    );
    const changes = view.items
      .filter((item) => item.type === "message")
      .flatMap((item) => item.type === "message" ? item.changeActivities : [])
      .find((activity) => activity.kind === "changes");
    assert.equal(changes?.sourceEntryIds, undefined);

    assert.equal(changes?.sourceEntryRanges, undefined);
    assert.deepEqual(changes?.sourceEntrySpans, [
      {
        prefix: "entry-",
        start: 3,
        end: 36
      }
    ]);
    assert.equal(changes?.sourceEntryCount, 12);

    const detailRequestCountBeforeHydration = application.agentSessionDetailRequests.length;
    const query = new URLSearchParams({
      entrySpans: JSON.stringify(changes?.sourceEntrySpans ?? [])
    });
    const hydratedChanges = await requestJson<AgentTranscriptChangesResponse>(
      `${baseUrl}/api/agents/sessions/${detail.id}/changes/${encodeURIComponent(changes?.id ?? "")}?${query.toString()}`
    );
    const postHydratedChanges = await requestJson<AgentTranscriptChangesResponse>(
      `${baseUrl}/api/agents/sessions/${detail.id}/changes/${encodeURIComponent(changes?.id ?? "")}`,
      {
        body: {
          entrySpans: changes?.sourceEntrySpans ?? []
        },
        method: "POST"
      }
    );

    assert.equal(hydratedChanges.files.length, 12);
    assert.equal(hydratedChanges.files[0]?.displayPath, "src/file-1.ts");
    assert.equal(hydratedChanges.files[11]?.displayPath, "src/file-12.ts");
    assert.equal(postHydratedChanges.files.length, 12);
    assert.equal(postHydratedChanges.files[11]?.displayPath, "src/file-12.ts");
    assert.equal(application.agentSessionDetailRequests.length, detailRequestCountBeforeHydration);
  });
});

test("agent transcript view avoids fake file counts for compact hidden changes", async () => {
  const detail: AgentSessionDetail = {
    ...agentSessionDetail(),
    transcript: [
      {
        id: "entry-0",
        timestamp: "2026-06-22T10:00:00.000Z",
        role: "user",
        text: "Update files",
        phase: null
      },
      {
        id: "entry-compact-10-18",
        timestamp: "2026-06-22T10:00:01.000Z",
        role: "tool",
        text: "9 changes hidden in live view",
        phase: null,
        isCompact: true,
        sourceEntryCount: 9,
        sourceEntryRanges: [
          {
            prefix: "entry-",
            start: 10,
            end: 18
          }
        ],
        parts: [
          {
            type: "diff",
            title: "Changes",
            text: "[diff hidden in live view]",
            filePath: null,
            changeType: "unknown",
            additions: 0,
            deletions: 0
          }
        ]
      },
      {
        id: "entry-20",
        timestamp: "2026-06-22T10:00:02.000Z",
        role: "assistant",
        text: "Done",
        phase: null
      }
    ]
  };

  const application = fakeApplication({
    agentSessionDetailResponse: detail
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const view = await requestJson<AgentTranscriptViewResponse>(
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-view?chatMessageTail=40&transcriptDetail=summary`
    );
    const changes = view.items
      .filter((item) => item.type === "message")
      .flatMap((item) => item.type === "message" ? item.changeActivities : [])
      .find((activity) => activity.kind === "changes");

    assert.equal(changes?.label, "Changes");
    assert.equal(changes?.sourceEntryCount, 9);
  });
});

test("agent transcript view keeps waiting pending when compact detail cannot be hydrated", async () => {
  const detail: AgentSessionDetail = {
    ...agentSessionDetail(),
    transcript: [
      {
        id: "entry-0",
        timestamp: "2026-06-22T10:00:00.000Z",
        role: "user",
        text: "Continue the task",
        phase: null
      },
      {
        id: "entry-compact-10-12",
        timestamp: "2026-06-22T10:00:30.000Z",
        role: "system",
        text: "3 detail entries hidden in live view",
        phase: null,
        isCompact: true,
        sourceEntryCount: 3,
        sourceEntryRanges: [
          {
            prefix: "entry-",
            start: 10,
            end: 12
          }
        ],
        parts: [
          {
            type: "status",
            label: "Details",
            detail: "3 detail entries load when this activity is opened"
          }
        ]
      }
    ]
  };

  const application = fakeApplication({
    agentSessionDetailResponse: detail
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const view = await requestJson<AgentTranscriptViewResponse>(
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-view?chatMessageTail=40&transcriptDetail=summary&waitingSince=2026-06-22T10%3A00%3A00.000Z`
    );

    assert.equal(view.latestWaitingDetailEntry, null);
  });
});

test("agent transcript view keeps waiting pending until a detail follows turn start", async () => {
  const detail: AgentSessionDetail = {
    ...agentSessionDetail(),
    transcript: [
      {
        id: "entry-0",
        timestamp: "2026-06-22T10:00:00.000Z",
        role: "user",
        text: "Continue the task",
        phase: null
      },
      {
        id: "entry-1",
        timestamp: "2026-06-22T10:00:10.000Z",
        role: "system",
        text: "Turn started",
        phase: null,
        parts: [
          {
            type: "status",
            label: "Turn started",
            detail: null
          }
        ]
      }
    ]
  };

  const application = fakeApplication({
    agentSessionDetailResponse: detail
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const view = await requestJson<AgentTranscriptViewResponse>(
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-view?chatMessageTail=40&transcriptDetail=summary&waitingSince=2026-06-22T10%3A00%3A00.000Z`
    );

    assert.equal(view.latestWaitingDetailEntry, null);
  });
});

test("agent transcript view hydrates compact waiting detail from exact source refs", async () => {
  const detail: AgentSessionDetail = {
    ...agentSessionDetail(),
    transcript: [
      {
        id: "entry-10",
        timestamp: "2026-06-22T10:00:10.000Z",
        role: "tool",
        text: "Called shell_command",
        phase: null,
        parts: [
          {
            type: "tool_call",
            toolName: "shell_command",
            namespace: null,
            argumentsText: "{\"command\":\"npm test\"}"
          }
        ]
      },
      {
        id: "entry-11",
        timestamp: "2026-06-22T10:00:20.000Z",
        role: "tool",
        text: "Tool completed",
        phase: null,
        parts: [
          {
            type: "tool_result",
            toolName: null,
            status: "completed",
            text: "Tests passed"
          }
        ]
      },
      {
        id: "entry-12",
        timestamp: "2026-06-22T10:00:30.000Z",
        role: "system",
        text: "Drafting final answer",
        phase: null,
        parts: [
          {
            type: "status",
            label: "Drafting final answer",
            detail: null
          }
        ]
      }
    ]
  };

  const application = fakeApplication({
    agentSessionDetailResponse: detail,
    agentTranscriptTailWindowResponse: [
      {
        id: "entry-0",
        timestamp: "2026-06-22T10:00:00.000Z",
        role: "user",
        text: "Continue the task",
        phase: null
      },
      {
        id: "entry-compact-10-12",
        timestamp: "2026-06-22T10:00:30.000Z",
        role: "system",
        text: "3 detail entries hidden in live view",
        phase: null,
        isCompact: true,
        sourceEntryRanges: [
          {
            prefix: "entry-",
            start: 10,
            end: 12
          }
        ],
        parts: [
          {
            type: "status",
            label: "Details",
            detail: "3 detail entries load when this activity is opened"
          }
        ]
      }
    ]
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const view = await requestJson<AgentTranscriptViewResponse>(
      `${baseUrl}/api/agents/sessions/codex%3Asource-1/transcript-view?chatMessageTail=40&transcriptDetail=summary&waitingSince=2026-06-22T10%3A00%3A00.000Z`
    );

    assert.equal(view.latestWaitingDetailEntry?.id, "entry-12");
    assert.equal(view.latestWaitingDetailEntry?.isCompact, undefined);
    assert.equal(view.latestWaitingDetailEntry?.text, "Drafting final answer");
    assert.deepEqual(application.agentTranscriptEntriesRequests.at(-1)?.entryIds, [
      "entry-10",
      "entry-11",
      "entry-12"
    ]);
  });
});

test("agent transcript view keeps waiting pending when compact details contain only tools", async () => {
  const detail: AgentSessionDetail = {
    ...agentSessionDetail(),
    transcript: [
      {
        id: "entry-10",
        timestamp: "2026-06-22T10:00:10.000Z",
        role: "tool",
        text: "Called shell_command",
        phase: null,
        parts: [
          {
            type: "tool_call",
            toolName: "shell_command",
            namespace: null,
            argumentsText: "{\"command\":\"npm test\"}"
          }
        ]
      },
      {
        id: "entry-11",
        timestamp: "2026-06-22T10:00:20.000Z",
        role: "system",
        text: "Turn started",
        phase: null,
        parts: [
          {
            type: "status",
            label: "Turn started",
            detail: null
          }
        ]
      }
    ]
  };

  const application = fakeApplication({
    agentSessionDetailResponse: detail,
    agentTranscriptTailWindowResponse: [
      {
        id: "entry-0",
        timestamp: "2026-06-22T10:00:00.000Z",
        role: "user",
        text: "Continue the task",
        phase: null
      },
      {
        id: "entry-compact-10-11",
        timestamp: "2026-06-22T10:00:20.000Z",
        role: "system",
        text: "2 detail entries hidden in live view",
        phase: null,
        isCompact: true,
        sourceEntryRanges: [
          {
            prefix: "entry-",
            start: 10,
            end: 11
          }
        ],
        parts: [
          {
            type: "status",
            label: "Details",
            detail: "2 detail entries load when this activity is opened"
          }
        ]
      }
    ]
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const view = await requestJson<AgentTranscriptViewResponse>(
      `${baseUrl}/api/agents/sessions/codex%3Asource-1/transcript-view?chatMessageTail=40&transcriptDetail=summary&waitingSince=2026-06-22T10%3A00%3A00.000Z`
    );

    assert.equal(view.latestWaitingDetailEntry, null);
    assert.deepEqual(application.agentTranscriptEntriesRequests.at(-1)?.entryIds, [
      "entry-10",
      "entry-11"
    ]);
  });
});

test("agent transcript view labels compact details by addressable source references", async () => {
  const detail: AgentSessionDetail = {
    ...agentSessionDetail(),
    transcript: [
      {
        id: "entry-0",
        timestamp: "2026-06-22T10:00:00.000Z",
        role: "user",
        text: "Continue the task",
        phase: null
      },
      {
        id: "entry-compact-details",
        timestamp: "2026-06-22T10:00:30.000Z",
        role: "system",
        text: "94 detail entries hidden in live view",
        phase: null,
        isCompact: true,
        sourceEntryCount: 1,
        parts: [
          {
            type: "status",
            label: "Details",
            detail: "1 entries load when this activity is opened"
          }
        ]
      }
    ]
  };

  const application = fakeApplication({
    agentSessionDetailResponse: detail
  });
  const app = createTestApp((target) => {
    installAgentSessionRoutes(target, {
      decorateSession,
      sourceAgentSessions: application.sourceAgentSessions
    });
  });

  await withServer(app, async (baseUrl) => {
    const view = await requestJson<AgentTranscriptViewResponse>(
      `${baseUrl}/api/agents/sessions/${detail.id}/transcript-view?chatMessageTail=40&transcriptDetail=summary`
    );
    const details = view.items
      .filter((item) => item.type === "activity")
      .map((item) => item.type === "activity" ? item.activity : null)
      .find((activity) => activity?.kind === "details");

    assert.equal(details?.label, "Details (1)");
  });
});

test("interrupt route exposes the explicit Desktop fallback code", async () => {
  const app = createTestApp((target) => {
    installSessionRoutes(target, {
      decorateSession,
      manualCommands: {
        run: async () => {
          throw new Error("Unexpected manual command.");
        }
      } as never,
      managedSessions: {
        async interruptSession() {
          throw new AppError(
            "external_desktop_interrupt_unavailable",
            "DeskCue cannot interrupt this Codex Desktop chat directly."
          );
        }
      } as unknown as ManagedSessionService
    });
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/sessions/session-1/interrupt`, {
      method: "POST"
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      kind: "external_desktop_fallback",
      code: "external_desktop_interrupt_unavailable",
      action: "open_on_host",
      message: "DeskCue cannot interrupt this Codex Desktop chat directly."
    });
  });
});

test("runtime route returns runtime summary shape without probing local tools", async () => {
  const runtime: RuntimeSummary = {
    id: "ollama",
    label: "Ollama",
    installed: true,
    running: true,
    endpoint: "http://127.0.0.1:11434",
    modelCount: 2,
    loadedModelCount: 1,
    lastActiveModel: "llama3",
    statusText: "Running"
  };

  const app = createTestApp((target) => {
    installRuntimeRoutes(target, {
      listRuntimes: async () => [runtime]
    });
  });

  await withServer(app, async (baseUrl) => {
    const runtimes = await requestJson<RuntimeSummary[]>(`${baseUrl}/api/runtimes`);

    assert.deepEqual(runtimes, [runtime]);
  });
});

test("runtime route starts the LM Studio Local Server without loading a model", async () => {
  const runtime: RuntimeSummary = {
    id: "lm-studio",
    label: "LM Studio",
    installed: true,
    running: false,
    endpoint: "http://127.0.0.1:1234",
    modelCount: 3,
    loadedModelCount: 0,
    lastActiveModel: "local-model",
    statusText: "installed, local server is off"
  };

  const app = createTestApp((target) => {
    installRuntimeRoutes(target, {
      startLmStudioServer: async () => ({
        alreadyRunning: false,
        runtime,
        startRequested: true
      })
    });
  });

  await withServer(app, async (baseUrl) => {
    const result = await requestJson<{
      alreadyRunning: boolean;
      runtime: RuntimeSummary;
      startRequested: boolean;
    }>(`${baseUrl}/api/runtimes/lm-studio/server/start`, { method: "POST" });

    assert.deepEqual(result, {
      alreadyRunning: false,
      runtime,
      startRequested: true
    });
  });
});

test("runtime route starts Ollama once for concurrent wake-up requests", async () => {
  const runtime: RuntimeSummary = {
    id: "ollama",
    label: "Ollama",
    installed: true,
    running: true,
    endpoint: "http://127.0.0.1:11434",
    modelCount: 2,
    loadedModelCount: 0,
    lastActiveModel: null,
    statusText: "2 local models available"
  };

  let markBothRequestsEntered!: () => void;
  let releaseStart!: () => void;
  const bothRequestsEntered = new Promise<void>((resolve) => {
    markBothRequestsEntered = resolve;
  });
  let requestCount = 0;
  let startCalls = 0;
  const app = createTestApp((target) => {
    target.use((request, _response, next) => {
      if (request.method === "POST" && request.path === "/api/runtimes/ollama/server/start") {
        requestCount += 1;
        if (requestCount === 2) markBothRequestsEntered();
      }

      next();
    });
    installRuntimeRoutes(target, {
      startOllamaServer: async () => {
        startCalls += 1;
        await new Promise<void>((resolve) => { releaseStart = resolve; });
        return {
          alreadyRunning: false,
          runtime,
          startRequested: true
        };
      }
    });
  });

  await withServer(app, async (baseUrl) => {
    const first = fetch(`${baseUrl}/api/runtimes/ollama/server/start`, { method: "POST" });
    const second = fetch(`${baseUrl}/api/runtimes/ollama/server/start`, { method: "POST" });

    await bothRequestsEntered;

    releaseStart();
    const responses = await Promise.all([first, second]);
    const results = await Promise.all(responses.map((response) => response.json()));

    assert.equal(startCalls, 1);
    assert.deepEqual(results, [
      { alreadyRunning: false, runtime, startRequested: true },
      { alreadyRunning: false, runtime, startRequested: true }
    ]);
  });
});

test("runtime route exposes exact local LM Studio model choices", async () => {
  const models = [{
    displayName: "Qwen3 4B",
    modelKey: "qwen/qwen3-4b",
    path: "qwen/qwen3-4b"
  }];
  const app = createTestApp((target) => {
    installRuntimeRoutes(target, {
      listLmStudioModels: async () => models
    });
  });

  await withServer(app, async (baseUrl) => {
    const result = await requestJson<{ models: typeof models }>(`${baseUrl}/api/runtimes/lm-studio/models`);

    assert.deepEqual(result, { models });
  });
});

test("runtime route exposes exact local Ollama model choices", async () => {
  const models = [{
    displayName: "qwen3:8b",
    modelKey: "qwen3:8b"
  }];
  const app = createTestApp((target) => {
    installRuntimeRoutes(target, {
      listOllamaModels: async () => models
    });
  });

  await withServer(app, async (baseUrl) => {
    const result = await requestJson<{ models: typeof models }>(`${baseUrl}/api/runtimes/ollama/models`);

    assert.deepEqual(result, { models });
  });
});

test("runtime route validates and normalizes LM Studio model preparation through protocol", async () => {
  const preparedModels: string[] = [];
  const runtime: RuntimeSummary = {
    id: "lm-studio",
    label: "LM Studio",
    installed: true,
    running: true,
    endpoint: "http://127.0.0.1:1234",
    modelCount: 1,
    loadedModelCount: 1,
    lastActiveModel: "qwen/qwen3-4b",
    statusText: "ready"
  };

  const model = {
    displayName: "Qwen3 4B",
    modelKey: "qwen/qwen3-4b",
    path: "qwen/qwen3-4b"
  };

  const app = createTestApp((target) => {
    installRuntimeRoutes(target, {
      prepareLmStudioModel: async (modelKey) => {
        preparedModels.push(modelKey);
        return {
          alreadyRunning: true,
          model,
          modelLoadRequested: false,
          runtime,
          startRequested: false
        };
      }
    });
  });

  await withServer(app, async (baseUrl) => {
    const accepted = await fetch(`${baseUrl}/api/runtimes/lm-studio/prepare`, {
      body: JSON.stringify({ model: "  qwen/qwen3-4b  " }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    const rejected = await fetch(`${baseUrl}/api/runtimes/lm-studio/prepare`, {
      body: JSON.stringify({ model: " " }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });

    assert.equal(accepted.status, 200);
    assert.equal(rejected.status, 400);
    assert.deepEqual(preparedModels, ["qwen/qwen3-4b"]);
  });
});
