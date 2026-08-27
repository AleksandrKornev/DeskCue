import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentSessionSummary,
  ServerEvent,
  SessionDetail,
  SessionSummary,
  WorkspaceSummary
} from "@deskcue/protocol";
import { emptyPreview, emptyReplyState } from "#sessions/model/sessionDefaults";

import { createReadOnlyClaudeSession } from "./claudeReadOnlySessionService.ts";

function failedClaudeSession(command: string): SessionDetail {
  return {
    id: "managed-claude",
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    adapterId: "claude-code",
    sourceSessionId: "source-claude",
    command,
    status: "failed",
    startedAt: "2026-08-27T10:00:00.000Z",
    finishedAt: "2026-08-27T10:01:00.000Z",
    lastActivityAt: "2026-08-27T10:01:00.000Z",
    exitCode: 1,
    preview: emptyPreview(),
    replyState: emptyReplyState(),
    actionRequest: null,
    git: {
      branch: null,
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: false,
      lastUpdatedAt: "2026-08-27T10:01:00.000Z"
    },
    logs: [],
    inputHistory: ["previous prompt"]
  };
}

function claudeSourceSession(): AgentSessionSummary {
  return {
    id: "claude-code:source-claude",
    agentId: "claude-code",
    agentLabel: "Claude Code",
    attachMode: "resume",
    attachModeReason: null,
    cliVersion: null,
    contextCompactionCount: 0,
    filePath: "C:/claude/projects/workspace/source-claude.jsonl",
    model: "claude-sonnet",
    originator: null,
    source: null,
    sourceSessionId: "source-claude",
    title: "Claude chat",
    updatedAt: "2026-08-27T10:02:00.000Z",
    workState: "idle",
    workspaceName: "Workspace",
    workspacePath: "D:/workspace"
  };
}

function fixture(
  initial: SessionDetail,
  options: {
    concurrentSession?: SessionDetail;
    persistError?: Error;
  } = {}
) {
  let current = initial;
  let persistCount = 0;
  const events: ServerEvent[] = [];

  return {
    callbacks: {
      appendLog: () => {},
      claimAttachedSession: () => current,
      createWorkspace: async () => {
        throw new Error("must reuse existing session");
      },
      emitServerEvent: (event: ServerEvent) => events.push(event),
      findAttachedSession: () => current,
      getPublicSession: () => current,
      isSessionCurrent: (_sessionId: string, expected: SessionDetail) =>
        current === expected,
      persistState: async () => {
        persistCount += 1;
        if (options.concurrentSession) current = options.concurrentSession;
        if (options.persistError) throw options.persistError;
      },
      restoreSessionIfCurrent: (
        _sessionId: string,
        expected: SessionDetail,
        replacement: SessionDetail
      ) => {
        if (current !== expected) return false;

        current = replacement;
        return true;
      },
      removeSessionIfCurrent: () => false,
      runAttachedSessionCreation: (
        _sourceSessionId: string,
        operation: () => Promise<SessionDetail>
      ) => operation(),
      setSession: (session: SessionDetail) => {
        current = session;
      },
      syncWorkspaceFromGit: () => {},
      toSummary: (session: SessionDetail) => session as SessionSummary
    },
    events,
    get current() {
      return current;
    },
    get persistCount() {
      return persistCount;
    }
  };
}

test("reconciles a reused failed Claude shell to current observe-only ownership", async () => {
  const harness = fixture(failedClaudeSession(
    "claude --resume source-claude --print previous prompt"
  ));

  const session = await createReadOnlyClaudeSession(
    harness.callbacks,
    claudeSourceSession(),
    {
      observeOnly: true,
      reason: "Claude Code reports this chat as active outside DeskCue."
    }
  );

  assert.equal(session.status, "failed");
  assert.match(session.command, /\(observe-only\)$/);
  assert.equal(
    session.inputBlockedReason,
    "Claude Code reports this chat as active outside DeskCue."
  );

  assert.equal(harness.persistCount, 1);
  assert.equal(harness.events[0]?.type, "session.updated");
});

test("restores a reused failed Claude shell after external ownership clears", async () => {
  const harness = fixture({
    ...failedClaudeSession(
      "claude --resume source-claude --print previous prompt (observe-only)"
    ),
    inputBlockedReason: "Claude Code reports this chat as active outside DeskCue."
  });

  const session = await createReadOnlyClaudeSession(
    harness.callbacks,
    claudeSourceSession(),
    {
      observeOnly: false,
      reason: "DeskCue can continue this chat."
    }
  );

  assert.equal(session.status, "failed");
  assert.equal(
    session.command,
    "claude --resume source-claude --print previous prompt (read-only)"
  );

  assert.equal(session.inputBlockedReason, null);
  assert.equal(harness.persistCount, 1);
  assert.equal(harness.events[0]?.type, "session.updated");
});

test("rolls back observe-only ownership when persistence fails", async () => {
  const initial = failedClaudeSession(
    "claude --resume source-claude --print previous prompt"
  );
  const harness = fixture(initial, { persistError: new Error("disk unavailable") });

  await assert.rejects(
    createReadOnlyClaudeSession(
      harness.callbacks,
      claudeSourceSession(),
      {
        observeOnly: true,
        reason: "Claude Code reports this chat as active outside DeskCue."
      }
    ),
    /disk unavailable/
  );

  assert.equal(harness.current, initial);
  assert.equal(harness.events.length, 0);
});

test("rolls back writable ownership when persistence fails", async () => {
  const initial = {
    ...failedClaudeSession(
      "claude --resume source-claude --print previous prompt (observe-only)"
    ),
    inputBlockedReason: "Claude Code reports this chat as active outside DeskCue."
  };

  const harness = fixture(initial, { persistError: new Error("disk unavailable") });

  await assert.rejects(
    createReadOnlyClaudeSession(
      harness.callbacks,
      claudeSourceSession(),
      {
        observeOnly: false,
        reason: "DeskCue can continue this chat."
      }
    ),
    /disk unavailable/
  );

  assert.equal(harness.current, initial);
  assert.equal(harness.events.length, 0);
});

test("does not roll back a concurrent session transition after persistence fails", async () => {
  const initial = failedClaudeSession(
    "claude --resume source-claude --print previous prompt"
  );
  const concurrentSession: SessionDetail = {
    ...initial,
    exitCode: null,
    finishedAt: null,
    status: "running",
    replyState: {
      phase: "sending",
      promptText: "new prompt",
      requestedAt: "2026-08-27T10:02:00.000Z"
    }
  };

  const harness = fixture(initial, {
    concurrentSession,
    persistError: new Error("disk unavailable")
  });

  await assert.rejects(
    createReadOnlyClaudeSession(
      harness.callbacks,
      claudeSourceSession(),
      {
        observeOnly: true,
        reason: "Claude Code reports this chat as active outside DeskCue."
      }
    ),
    /disk unavailable/
  );

  assert.equal(harness.current, concurrentSession);
  assert.equal(harness.events.length, 0);
});

test("does not publish a stale ownership event after a concurrent persisted transition", async () => {
  const initial = failedClaudeSession(
    "claude --resume source-claude --print previous prompt"
  );
  const concurrentSession: SessionDetail = {
    ...initial,
    exitCode: null,
    finishedAt: null,
    status: "running",
    replyState: {
      phase: "sending",
      promptText: "new prompt",
      requestedAt: "2026-08-27T10:02:00.000Z"
    }
  };

  const harness = fixture(initial, { concurrentSession });

  const result = await createReadOnlyClaudeSession(
    harness.callbacks,
    claudeSourceSession(),
    {
      observeOnly: true,
      reason: "Claude Code reports this chat as active outside DeskCue."
    }
  );

  assert.equal(result, concurrentSession);
  assert.equal(harness.current, concurrentSession);
  assert.equal(harness.events.length, 0);
});

test("coalesces a delayed first open after the winner starts running", async () => {
  let current: SessionDetail | null = null;
  let pendingCreation: Promise<SessionDetail> | null = null;
  let workspaceCalls = 0;
  let releaseSecondWorkspace!: () => void;
  const secondWorkspaceGate = new Promise<void>((resolve) => {
    releaseSecondWorkspace = resolve;
  });
  const events: ServerEvent[] = [];
  const workspace: WorkspaceSummary = {
    branch: null,
    createdAt: "2026-08-27T10:00:00.000Z",
    id: "workspace-1",
    isGitRepo: true,
    name: "DeskCue",
    path: process.cwd()
  };

  const callbacks = {
    appendLog: () => {},
    claimAttachedSession: (candidate: SessionDetail) => {
      if (current) return current;

      current = candidate;
      return null;
    },
    createWorkspace: async () => {
      workspaceCalls += 1;
      if (workspaceCalls === 2) await secondWorkspaceGate;

      return workspace;
    },
    emitServerEvent: (event: ServerEvent) => events.push(event),
    findAttachedSession: () => current ?? undefined,
    getPublicSession: () => current,
    isSessionCurrent: (_sessionId: string, expected: SessionDetail) =>
      current === expected,
    persistState: async () => {},
    restoreSessionIfCurrent: (
      _sessionId: string,
      expected: SessionDetail,
      replacement: SessionDetail
    ) => {
      if (current !== expected) return false;

      current = replacement;
      return true;
    },
    removeSessionIfCurrent: (
      _sessionId: string,
      expected: SessionDetail
    ) => {
      if (current !== expected) return false;

      current = null;
      return true;
    },
    runAttachedSessionCreation: (
      _sourceSessionId: string,
      operation: () => Promise<SessionDetail>
    ) => {
      if (pendingCreation) return pendingCreation;

      pendingCreation = operation();
      return pendingCreation;
    },
    setSession: (session: SessionDetail) => {
      current = session;
    },
    syncWorkspaceFromGit: () => {},
    toSummary: (session: SessionDetail) => session as SessionSummary
  };

  const firstPromise = createReadOnlyClaudeSession(callbacks, claudeSourceSession(), {
    reason: "DeskCue can continue this chat."
  });
  const secondPromise = createReadOnlyClaudeSession(callbacks, claudeSourceSession(), {
    reason: "DeskCue can continue this chat."
  });
  const first = await firstPromise;

  current = {
    ...first,
    command: "claude --resume source-claude --print next prompt",
    status: "running"
  };

  releaseSecondWorkspace();

  const second = await secondPromise;

  assert.equal(first.id, second.id);
  assert.equal(events.filter((event) => event.type === "session.created").length, 1);
});

test("rejects concurrent followers when first-open persistence fails", async () => {
  let current: SessionDetail | null = null;
  let pendingCreation: Promise<SessionDetail> | null = null;
  let rejectPersistence!: (error: Error) => void;
  let reportPersistenceStarted!: () => void;
  const persistenceStarted = new Promise<void>((resolve) => {
    reportPersistenceStarted = resolve;
  });
  const persistenceGate = new Promise<void>((_resolve, reject) => {
    rejectPersistence = reject;
  });
  const events: ServerEvent[] = [];
  const workspace: WorkspaceSummary = {
    branch: null,
    createdAt: "2026-08-27T10:00:00.000Z",
    id: "workspace-1",
    isGitRepo: true,
    name: "DeskCue",
    path: process.cwd()
  };

  const callbacks = {
    appendLog: () => {
      throw new Error("must not append before persistence");
    },
    claimAttachedSession: (candidate: SessionDetail) => {
      current = candidate;
      return null;
    },
    createWorkspace: async () => workspace,
    emitServerEvent: (event: ServerEvent) => events.push(event),
    findAttachedSession: () => undefined,
    getPublicSession: () => current,
    isSessionCurrent: (_sessionId: string, expected: SessionDetail) =>
      current === expected,
    persistState: async () => {
      reportPersistenceStarted();
      await persistenceGate;
    },
    restoreSessionIfCurrent: () => false,
    removeSessionIfCurrent: (
      _sessionId: string,
      expected: SessionDetail
    ) => {
      if (current !== expected) return false;

      current = null;
      return true;
    },
    runAttachedSessionCreation: (
      _sourceSessionId: string,
      operation: () => Promise<SessionDetail>
    ) => {
      if (pendingCreation) return pendingCreation;

      pendingCreation = operation();
      return pendingCreation;
    },
    setSession: (session: SessionDetail) => {
      current = session;
    },
    syncWorkspaceFromGit: () => {},
    toSummary: (session: SessionDetail) => session as SessionSummary
  };

  const first = createReadOnlyClaudeSession(callbacks, claudeSourceSession(), {
    reason: "DeskCue can continue this chat."
  });
  const second = createReadOnlyClaudeSession(callbacks, claudeSourceSession(), {
    reason: "DeskCue can continue this chat."
  });

  await persistenceStarted;
  rejectPersistence(new Error("disk unavailable"));

  const results = await Promise.allSettled([first, second]);

  assert.equal(results[0]?.status, "rejected");
  assert.equal(results[1]?.status, "rejected");
  await assert.rejects(
    Promise.reject(results[0]?.status === "rejected" ? results[0].reason : null),
    /disk unavailable/
  );

  await assert.rejects(
    Promise.reject(results[1]?.status === "rejected" ? results[1].reason : null),
    /disk unavailable/
  );

  assert.equal(current, null);
  assert.equal(events.length, 0);
});

test("allows a clean retry after a failed first-open single flight", async () => {
  let current: SessionDetail | null = null;
  let pendingCreation: Promise<SessionDetail> | null = null;
  let persistCalls = 0;
  const workspace: WorkspaceSummary = {
    branch: null,
    createdAt: "2026-08-27T10:00:00.000Z",
    id: "workspace-1",
    isGitRepo: true,
    name: "DeskCue",
    path: process.cwd()
  };

  const callbacks = {
    appendLog: () => {},
    claimAttachedSession: (candidate: SessionDetail) => {
      current = candidate;
      return null;
    },
    createWorkspace: async () => workspace,
    emitServerEvent: () => {},
    findAttachedSession: () => current ?? undefined,
    getPublicSession: () => current,
    isSessionCurrent: (_sessionId: string, expected: SessionDetail) =>
      current === expected,
    persistState: async () => {
      persistCalls += 1;
      if (persistCalls === 1) throw new Error("disk unavailable");
    },
    restoreSessionIfCurrent: () => false,
    removeSessionIfCurrent: (
      _sessionId: string,
      expected: SessionDetail
    ) => {
      if (current !== expected) return false;

      current = null;
      return true;
    },
    runAttachedSessionCreation: (
      _sourceSessionId: string,
      operation: () => Promise<SessionDetail>
    ) => {
      if (pendingCreation) return pendingCreation;

      pendingCreation = operation();
      pendingCreation.then(
        () => { pendingCreation = null; },
        () => { pendingCreation = null; }
      );

      return pendingCreation;
    },
    setSession: (session: SessionDetail) => {
      current = session;
    },
    syncWorkspaceFromGit: () => {},
    toSummary: (session: SessionDetail) => session as SessionSummary
  };

  await assert.rejects(
    createReadOnlyClaudeSession(callbacks, claudeSourceSession(), {
      reason: "DeskCue can continue this chat."
    }),
    /disk unavailable/
  );

  await new Promise((resolve) => setImmediate(resolve));

  const retried = await createReadOnlyClaudeSession(
    callbacks,
    claudeSourceSession(),
    { reason: "DeskCue can continue this chat." }
  );

  assert.ok(retried.id);
  assert.equal(persistCalls, 2);
});
