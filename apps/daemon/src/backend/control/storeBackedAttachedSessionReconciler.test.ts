import assert from "node:assert/strict";
import test from "node:test";

import type { AgentSessionDetail, AgentSessionSummary, SessionDetail } from "@deskcue/protocol";
import { emptyPreview, emptyReplyState } from "#sessions/model/sessionDefaults";
import { SessionRepository } from "#sessions/state/sessionRepository";

import { StoreBackedAttachedSessionReconciler } from "./storeBackedAttachedSessionReconciler.ts";

function agentSessionSummary(
  overrides: Partial<AgentSessionSummary> = {}
): AgentSessionSummary {
  return {
    id: "codex:source-1",
    agentId: "codex",
    agentLabel: "Codex",
    sourceSessionId: "source-1",
    title: "Session",
    workspacePath: "D:\\workspace",
    workspaceName: "Workspace",
    updatedAt: "2026-08-05T10:00:00.000Z",
    model: null,
    originator: null,
    cliVersion: null,
    source: null,
    filePath: "session.jsonl",
    approvalPolicy: null,
    sandboxMode: null,
    attachMode: "read_only",
    attachModeReason: "active elsewhere",
    workState: "idle",
    ...overrides
  };
}

function sessionDetail(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    adapterId: "codex",
    sourceSessionId: "source-1",
    command: "codex resume source-1",
    status: "stopped",
    startedAt: "2026-08-05T09:00:00.000Z",
    finishedAt: "2026-08-05T09:30:00.000Z",
    lastActivityAt: "2026-08-05T09:30:00.000Z",
    exitCode: null,
    preview: emptyPreview(),
    replyState: emptyReplyState(),
    git: {
      branch: "main",
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: true,
      lastUpdatedAt: "2026-08-05T09:00:00.000Z"
    },
    logs: [],
    inputHistory: ["Owned prompt"],
    ...overrides
  };
}

test("confirms a stale owned transport before decorating the attached source session", () => {
  const repository = new SessionRepository();

  repository.setSession(sessionDetail());
  const lifecycle: string[] = [];
  const reconciler = new StoreBackedAttachedSessionReconciler({
    getCallbackContext: () => ({} as never),
    markPromptObserved: () => {},
    markPromptCompleted: () => {},
    persistState: async () => {},
    repository,
    sessionRunner: {
      hasChild: () => false
    } as never,
    sourceTurnInterrupts: {
      confirmManagedTransportExit: (session: SessionDetail) => {
        lifecycle.push(`confirm:${session.adapterId}`);
      },
      decorate: <T extends AgentSessionSummary>(agentSession: T) => {
        lifecycle.push("decorate");
        return agentSession;
      }
    } as never,
    startQueuedPrompt: async (session) => session
  });

  const result = reconciler.reconcile(agentSessionSummary());

  assert.equal(result.attachMode, "read_only");
  assert.deepEqual(lifecycle, ["confirm:codex", "decorate"]);
});

test("reconciles stale ownership only for the matching runtime and source session", () => {
  const repository = new SessionRepository();

  repository.setSession(sessionDetail());

  repository.setSession(sessionDetail({
    adapterId: "claude-code",
    id: "session-2"
  }));
  const confirmed: string[] = [];
  const reconciler = new StoreBackedAttachedSessionReconciler({
    getCallbackContext: () => ({} as never),
    markPromptObserved: () => {},
    markPromptCompleted: () => {},
    persistState: async () => {},
    repository,
    sessionRunner: {
      hasChild: () => false
    } as never,
    sourceTurnInterrupts: {
      confirmManagedTransportExit: (session: SessionDetail) => {
        confirmed.push(session.id);
      },
      decorate: <T>(agentSession: T) => agentSession
    } as never,
    startQueuedPrompt: async (session) => session
  });

  reconciler.reconcile(agentSessionSummary({
    agentId: "claude-code",
    agentLabel: "Claude Code"
  }));

  assert.deepEqual(confirmed, ["session-2"]);
});

function agentSessionDetail(): AgentSessionDetail {
  return {
    ...agentSessionSummary({
      attachMode: "resume",
      attachModeReason: null,
      workState: "running"
    }),
    transcript: [{
      id: "recovered-user",
      timestamp: "2026-08-05T10:00:01.000Z",
      role: "user",
      text: "Recovered prompt",
      phase: null
    }]
  };
}

test("close drains durable recovery persistence across repeated source syncs", async () => {
  const repository = new SessionRepository();

  repository.setSession(sessionDetail({
    promptRecovery: {
      phase: "checking",
      promptText: "Recovered prompt",
      requestedAt: "2026-08-05T10:00:00.000Z",
      retryable: false
    },
    inputHistory: ["Recovered prompt"]
  }));
  const journalTransitions: string[] = [];
  let releasePersist: (() => void) | undefined;
  const persistBlocked = new Promise<void>((resolve) => {
    releasePersist = resolve;
  });
  const reconciler = new StoreBackedAttachedSessionReconciler({
    getCallbackContext: () => ({
      appendLog: () => {},
      detachAttachedSession: async () => {},
      emitServerEvent: () => {},
      getSession: (sessionId: string) => repository.getSession(sessionId),
      persistState: async () => {},
      repository,
      sessionRunner: {
        getChild: () => undefined,
        hasChild: () => false,
        killChild: async () => {}
      },
      toSummary: (session: SessionDetail) => session,
      updateSession: (sessionId: string, patch: Partial<SessionDetail>) => {
        repository.updateSession(sessionId, patch);
      }
    } as never),
    markPromptCompleted: () => journalTransitions.push("completed"),
    markPromptObserved: () => journalTransitions.push("observed"),
    persistState: () => persistBlocked,
    repository,
    sessionRunner: {
      hasChild: () => false
    } as never,
    sourceTurnInterrupts: {
      decorate: <T>(agentSession: T) => agentSession
    } as never,
    startQueuedPrompt: async (session) => session
  });

  const completedAgentSession = agentSessionDetail();

  completedAgentSession.workState = "idle";

  completedAgentSession.transcript.push({
    id: "recovered-assistant",
    timestamp: "2026-08-05T10:00:02.000Z",
    role: "assistant",
    text: "Completed",
    phase: null
  }, {
    id: "recovered-turn-completed",
    timestamp: "2026-08-05T10:00:03.000Z",
    role: "system",
    text: "Turn completed",
    phase: null
  });
  const result = reconciler.syncReplyState(completedAgentSession);

  reconciler.syncReplyState(completedAgentSession);

  assert.equal(result?.promptRecovery, null);
  assert.equal(result?.replyState.phase, "idle");
  assert.deepEqual(journalTransitions, []);
  let closeCompleted = false;
  const close = reconciler.close().then(() => {
    closeCompleted = true;
  });

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(closeCompleted, false);
  releasePersist?.();
  await close;
  assert.equal(closeCompleted, true);
  assert.deepEqual(journalTransitions, ["completed"]);
});

test("does not resolve the journal when recovery state persistence fails", async () => {
  const repository = new SessionRepository();

  repository.setSession(sessionDetail({
    promptRecovery: {
      phase: "checking",
      promptText: "Recovered prompt",
      requestedAt: "2026-08-05T10:00:00.000Z",
      retryable: false
    },
    inputHistory: ["Recovered prompt"]
  }));
  const journalTransitions: string[] = [];
  let persistAttempts = 0;
  const reconciler = new StoreBackedAttachedSessionReconciler({
    getCallbackContext: () => ({
      appendLog: () => {},
      detachAttachedSession: async () => {},
      emitServerEvent: () => {},
      getSession: (sessionId: string) => repository.getSession(sessionId),
      persistState: async () => {},
      repository,
      sessionRunner: {
        getChild: () => undefined,
        hasChild: () => false,
        killChild: async () => {}
      },
      toSummary: (session: SessionDetail) => session,
      updateSession: (sessionId: string, patch: Partial<SessionDetail>) => {
        repository.updateSession(sessionId, patch);
      }
    } as never),
    markPromptCompleted: () => journalTransitions.push("completed"),
    markPromptObserved: () => journalTransitions.push("observed"),
    persistState: async () => {
      persistAttempts += 1;
      if (persistAttempts === 1) throw new Error("disk unavailable");
    },
    repository,
    sessionRunner: { hasChild: () => false } as never,
    sourceTurnInterrupts: { decorate: <T>(agentSession: T) => agentSession } as never,
    startQueuedPrompt: async (session) => session
  });

  const completedAgentSession = agentSessionDetail();

  completedAgentSession.workState = "idle";

  completedAgentSession.transcript.push({
    id: "recovered-assistant",
    timestamp: "2026-08-05T10:00:02.000Z",
    role: "assistant",
    text: "Completed",
    phase: null
  }, {
    id: "recovered-turn-completed",
    timestamp: "2026-08-05T10:00:03.000Z",
    role: "system",
    text: "Turn completed",
    phase: null
  });

  reconciler.syncReplyState(completedAgentSession);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(journalTransitions, []);
  reconciler.syncReplyState(completedAgentSession);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(journalTransitions, ["completed"]);
});
