import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentSessionDetail,
  AgentSessionSummary,
  CodexSessionDetail,
  SessionDetail,
  WorkspaceSummary
} from "@deskcue/protocol";
import { emptyPreview, emptyReplyState } from "#sessions/model/sessionDefaults";

import {
  resumeCodexAgentSession,
  resumeDiscoveredAgentSession
} from "./sessionAttachOrchestration.ts";

const now = "2026-07-15T10:00:00.000Z";

function workspace(): WorkspaceSummary {
  return {
    id: "workspace-1",
    name: "Workspace",
    path: "C:\\projects\\ExampleWorkspace",
    isGitRepo: true,
    branch: "main",
    createdAt: now
  };
}

function session(overrides: Partial<SessionDetail>): SessionDetail {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    adapterId: "codex",
    sourceSessionId: "codex-source",
    command: "codex resume codex-source (read-only)",
    status: "read_only",
    startedAt: now,
    finishedAt: null,
    lastActivityAt: now,
    exitCode: null,
    preview: emptyPreview(),
    replyState: emptyReplyState(),
    git: {
      branch: "main",
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: true,
      lastUpdatedAt: now
    },
    logs: [],
    inputHistory: [],
    ...overrides
  };
}

function activeCodexSession(): CodexSessionDetail {
  const timestamp = new Date().toISOString();

  return {
    id: "codex-source",
    threadName: "Active Codex thread",
    workspacePath: "C:\\projects\\ExampleWorkspace",
    workspaceName: "Workspace",
    updatedAt: timestamp,
    model: "gpt-5.5",
    originator: null,
    cliVersion: null,
    source: null,
    filePath: "C:\\Users\\example\\.codex\\sessions\\thread.jsonl",
    approvalPolicy: "never",
    sandboxMode: "danger-full-access",
    transcript: [
      {
        id: "turn-started",
        timestamp,
        role: "system",
        text: "Turn started",
        phase: null,
        parts: [{ type: "status", label: "Turn started", detail: null }]
      }
    ]
  };
}

function resumableCodexSession(): CodexSessionDetail {
  const timestamp = new Date().toISOString();

  return {
    ...activeCodexSession(),
    transcript: [
      {
        id: "turn-started",
        timestamp,
        role: "system",
        text: "Turn started",
        phase: null,
        parts: [{ type: "status", label: "Turn started", detail: null }]
      },
      {
        id: "turn-completed",
        timestamp,
        role: "system",
        text: "Turn completed",
        phase: null,
        parts: [{ type: "status", label: "Turn completed", detail: null }]
      }
    ]
  };
}

function discoveredAgentSession(
  overrides: Partial<AgentSessionSummary> = {}
): AgentSessionSummary {
  return {
    id: "codex:codex-source",
    agentId: "codex",
    agentLabel: "Codex",
    sourceSessionId: "codex-source",
    title: "Discovered source session",
    workspacePath: "C:\\projects\\ExampleWorkspace",
    workspaceName: "Workspace",
    updatedAt: now,
    model: "gpt-5.5",
    originator: null,
    cliVersion: null,
    source: null,
    filePath: "C:\\Users\\example\\.codex\\sessions\\thread.jsonl",
    attachMode: "read_only",
    workState: "running",
    ...overrides
  };
}

test("reuses existing read-only Codex shell for an active external thread", async () => {
  const existing = session({});
  let createReadOnlyCalls = 0;
  let launchCalls = 0;

  const result = await resumeCodexAgentSession(
    {
      createReadOnlyCodexSession: async () => {
        createReadOnlyCalls += 1;
        return session({ id: "new-read-only" });
      },
      createWorkspace: async () => workspace(),
      findReadOnlyAttachedSession: () => existing,
      findReusableAttachedSession: () => null,
      getSession: (sessionId) => sessionId === existing.id ? existing : null,
      launchSession: async () => {
        launchCalls += 1;
        return session({ id: "launched" });
      },
      restartCodexTransport: async () => session({ id: "restarted" }),
      sendInput: async () => session({ id: "sent" })
    },
    activeCodexSession()
  );

  assert.equal(result.id, existing.id);
  assert.equal(createReadOnlyCalls, 0);
  assert.equal(launchCalls, 0);
});

test("launches Codex resume instead of reusing stale read-only shell", async () => {
  const existing = session({});
  let launchedArgs: string[] | undefined;
  let launchCalls = 0;

  const result = await resumeCodexAgentSession(
    {
      createReadOnlyCodexSession: async () => session({ id: "new-read-only" }),
      createWorkspace: async () => workspace(),
      findReadOnlyAttachedSession: () => existing,
      findReusableAttachedSession: () => null,
      getSession: (sessionId) => sessionId === existing.id ? existing : null,
      launchSession: async ({ spawnSpec }) => {
        launchCalls += 1;
        launchedArgs = spawnSpec?.args;
        return session({
          id: "launched",
          command: "codex resume codex-source",
          status: "running"
        });
      },
      restartCodexTransport: async () => session({ id: "restarted" }),
      sendInput: async () => session({ id: "sent" })
    },
    resumableCodexSession()
  );

  assert.equal(result.id, "launched");
  assert.equal(result.status, "running");
  assert.equal(launchCalls, 1);
  assert.ok(launchedArgs);
  assert.equal(launchedArgs[launchedArgs.indexOf("-m") + 1], "gpt-5.5");
});

test("rejects a prompt while the Codex thread is active in another client", async () => {
  const existing = session({});
  let sentPrompt = "";

  await assert.rejects(resumeCodexAgentSession(
    {
      createReadOnlyCodexSession: async () => session({ id: "new-read-only" }),
      createWorkspace: async () => workspace(),
      findReadOnlyAttachedSession: () => existing,
      findReusableAttachedSession: () => null,
      getSession: (sessionId) => sessionId === existing.id ? existing : null,
      launchSession: async () => session({ id: "launched" }),
      restartCodexTransport: async () => session({ id: "restarted" }),
      sendInput: async (_sessionId, input) => {
        sentPrompt = input;
        return session({ id: "sent" });
      }
    },
    activeCodexSession(),
    "  continue  "
  ), /active in another client/);

  assert.equal(sentPrompt, "");
});

test("does not bypass Codex ownership checks when a reusable shell exists", async () => {
  const existing = session({ status: "running" });
  let sentPrompt = "";

  await assert.rejects(resumeDiscoveredAgentSession(
    {
      createReadOnlyCodexSession: async () => session({ id: "read-only" }),
      createWorkspace: async () => workspace(),
      findReadOnlyAttachedSession: () => null,
      findReusableAttachedSession: () => existing,
      getSession: () => existing,
      launchSession: async () => session({ id: "launched" }),
      restartCodexTransport: async () => session({ id: "restarted" }),
      sendInput: async (_sessionId, input) => {
        sentPrompt = input;
        return session({ id: "sent" });
      }
    },
    {
      ...discoveredAgentSession(),
      transcript: activeCodexSession().transcript
    } as AgentSessionDetail,
    "continue"
  ), /active in another client/);

  assert.equal(sentPrompt, "");
});

test("routes a discovered Codex session through its attach strategy", async () => {
  let readOnlySourceSessionId = "";

  const result = await resumeDiscoveredAgentSession(
    {
      createReadOnlyCodexSession: async (codexSession) => {
        readOnlySourceSessionId = codexSession.id;
        return session({ id: "discovered-read-only" });
      },
      createWorkspace: async () => workspace(),
      findReadOnlyAttachedSession: () => null,
      findReusableAttachedSession: () => null,
      getSession: () => null,
      launchSession: async () => session({ id: "launched" }),
      restartCodexTransport: async () => session({ id: "restarted" }),
      sendInput: async () => session({ id: "sent" })
    },
    discoveredAgentSession()
  );

  assert.equal(result.id, "discovered-read-only");
  assert.equal(readOnlySourceSessionId, "codex-source");
});

test("does not reuse a running Codex shell for a Claude source-id collision", async () => {
  const codex = session({
    id: "managed-codex",
    sourceSessionId: "shared-source",
    status: "running"
  });
  const claude = session({
    adapterId: "claude-code",
    id: "managed-claude",
    sourceSessionId: "shared-source",
    status: "read_only"
  });
  let lookupAdapterId: string | undefined;
  let sentSessionId = "";

  const result = await resumeDiscoveredAgentSession(
    {
      createReadOnlyClaudeSession: async () => claude,
      createReadOnlyCodexSession: async () => session({ id: "read-only" }),
      createWorkspace: async () => workspace(),
      findReadOnlyAttachedSession: () => null,
      findReusableAttachedSession: (_sourceSessionId, adapterId) => {
        lookupAdapterId = adapterId;
        return adapterId === "codex" ? codex : null;
      },
      getSession: () => codex,
      launchSession: async () => session({ id: "launched" }),
      restartClaudePromptTransport: async () => claude,
      restartCodexTransport: async () => session({ id: "restarted" }),
      sendInput: async (sessionId) => {
        sentSessionId = sessionId;
        return codex;
      }
    },
    discoveredAgentSession({
      agentId: "claude-code",
      agentLabel: "Claude Code",
      attachMode: "resume",
      id: "claude-code:shared-source",
      sourceSessionId: "shared-source",
      workState: "idle"
    })
  );

  assert.equal(lookupAdapterId, "claude-code");
  assert.equal(sentSessionId, "");
  assert.equal(result.id, claude.id);
});

test("opens a resumable discovered Codex session as read-only until a prompt is sent", async () => {
  let launchCalls = 0;
  let reason = "";

  const result = await resumeDiscoveredAgentSession(
    {
      createReadOnlyCodexSession: async (_codexSession, nextReason) => {
        reason = nextReason;
        return session({ id: "completed-review" });
      },
      createWorkspace: async () => workspace(),
      findReadOnlyAttachedSession: () => null,
      findReusableAttachedSession: () => null,
      getSession: () => null,
      launchSession: async () => {
        launchCalls += 1;
        return session({ id: "launched" });
      },
      restartCodexTransport: async () => session({ id: "restarted" }),
      sendInput: async () => session({ id: "sent" })
    },
    {
      ...discoveredAgentSession({ attachMode: "resume", workState: "idle" }),
      transcript: resumableCodexSession().transcript
    } as AgentSessionDetail
  );

  assert.equal(result.id, "completed-review");
  assert.equal(launchCalls, 0);
  assert.match(reason, /Sending a follow-up continues it/);
});

test("rejects a discovered source agent without a registered attach strategy", async () => {
  await assert.rejects(
    resumeDiscoveredAgentSession(
      {
        createReadOnlyCodexSession: async () => session({ id: "read-only" }),
        createWorkspace: async () => workspace(),
        findReadOnlyAttachedSession: () => null,
        findReusableAttachedSession: () => null,
        getSession: () => null,
        launchSession: async () => session({ id: "launched" }),
        restartCodexTransport: async () => session({ id: "restarted" }),
        sendInput: async () => session({ id: "sent" })
      },
      discoveredAgentSession({
        agentId: "other",
        agentLabel: "Other"
      })
    ),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "Adapter other does not support attach yet."
  );
});
