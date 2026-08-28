import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentSessionDetail,
  ServerEvent,
  SessionDetail,
  SessionSummary
} from "@deskcue/protocol";
import { deriveReplyStateFromAgentSession } from "#agents/codex/session/codexReplyState";
import { emptyPreview, emptyReplyState } from "#sessions/model/sessionDefaults";
import { toSessionSummary } from "#sessions/projection/sessionProjection";

import {
  reconcileAttachedAgentSession,
  syncManagedSessionReplyState
} from "./sessionReplyStateSync.ts";

function sessionDetail(patch: Partial<SessionDetail> = {}): SessionDetail {
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
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: true,
      lastUpdatedAt: "2026-06-22T10:01:00.000Z"
    },
    logs: [],
    inputHistory: [],
    ...patch
  };
}

function agentSessionDetail(patch: Partial<AgentSessionDetail> = {}): AgentSessionDetail {
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
    workState: "idle",
    transcript: [],
    ...patch
  };
}

function summary(session: SessionDetail): SessionSummary {
  return toSessionSummary(session, () => true);
}

test("detaches a running attached session when the source session is no longer resumable", () => {
  const session = sessionDetail({
    adapterId: "codex",
    sourceSessionId: "source-1"
  });
  const events: ServerEvent[] = [];
  let detachedReason = "";

  const result = syncManagedSessionReplyState(
    {
      appendLog: () => {},
      detachAttachedSession: async (_sessionId, options) => {
        detachedReason = options.reason;
        session.status = "stopped";
      },
      detachPromptTransport: () => {},
      emitServerEvent: (event) => {
        events.push(event);
      },
      getPublicSession: () => session,
      hasPromptTransport: () => true,
      listSessions: () => [session],
      persistState: async () => {},
      startQueuedPrompt: async () => session,
      toSummary: summary,
      updateSession: (_sessionId, patch) => {
        Object.assign(session, patch);
      }
    },
    agentSessionDetail({
      attachMode: "read_only",
      attachModeReason: "Active elsewhere"
    })
  );

  assert.equal(result?.status, "stopped");
  assert.equal(detachedReason, "Active elsewhere");
  assert.equal(events.length, 0);
});

test("keeps a running takeover session while its prompt is waiting for transcript sync", () => {
  const session = sessionDetail({
    adapterId: "codex",
    sourceSessionId: "source-1",
    replyState: {
      phase: "waiting",
      promptText: "take over",
      requestedAt: "2026-06-22T10:00:00.000Z"
    }
  });
  let detached = false;

  const result = syncManagedSessionReplyState(
    {
      appendLog: () => {},
      detachAttachedSession: async () => {
        detached = true;
        session.status = "stopped";
      },
      detachPromptTransport: () => {},
      emitServerEvent: () => {},
      getPublicSession: () => session,
      listSessions: () => [session],
      persistState: async () => {},
      startQueuedPrompt: async () => session,
      toSummary: summary,
      updateSession: (_sessionId, patch) => {
        Object.assign(session, patch);
      }
    },
    agentSessionDetail({
      attachMode: "read_only",
      attachModeReason: "Active elsewhere",
      transcript: [
        {
          id: "entry-1",
          timestamp: "2026-06-22T09:59:00.000Z",
          role: "system",
          text: "Turn started",
          phase: null
        }
      ]
    })
  );

  assert.equal(detached, false);
  assert.equal(result?.status, "running");
  assert.equal(result?.replyState.phase, "waiting");
});

function syncCallbacks(session: SessionDetail, events: ServerEvent[] = []) {
  return {
    appendLog: () => {},
    detachAttachedSession: async () => {},
    detachPromptTransport: () => {},
    emitServerEvent: (event: ServerEvent) => {
      events.push(event);
    },
    getPublicSession: () => session,
    hasPromptTransport: () => true,
    listSessions: () => [session],
    persistState: async () => {},
    startQueuedPrompt: async () => session,
    toSummary: summary,
    updateSession: (_sessionId: string, patch: Partial<SessionDetail>) => {
      Object.assign(session, patch);
    }
  };
}

test("does not replace an owned prompt with a later identical turn", () => {
  const session = sessionDetail({
    adapterId: "codex",
    sourceSessionId: "source-1",
    replyState: {
      deliveryRequestedAt: "2026-06-22T10:00:00.000Z",
      phase: "sending",
      promptText: "Repeat",
      requestedAt: "2026-06-22T10:00:00.000Z"
    }
  });
  const sourceSession = agentSessionDetail({
    workState: "running",
    transcript: [
      {
        id: "owned-user",
        timestamp: "2026-06-22T10:00:01.000Z",
        role: "user",
        text: "Repeat",
        phase: null
      },
      {
        id: "owned-terminal",
        timestamp: "2026-06-22T10:00:02.000Z",
        role: "system",
        text: "Turn completed",
        phase: null
      },
      {
        id: "later-user",
        timestamp: "2026-06-22T10:00:03.000Z",
        role: "user",
        text: "Repeat",
        phase: null
      }
    ]
  });

  assert.deepEqual(deriveReplyStateFromAgentSession(session, sourceSession, true), emptyReplyState());
});

test("does not observe an identical prompt outside the delivery observation window", () => {
  const session = sessionDetail({
    adapterId: "codex",
    sourceSessionId: "source-1",
    replyState: {
      deliveryRequestedAt: "2026-06-22T10:00:00.000Z",
      phase: "waiting",
      promptText: "Repeat",
      requestedAt: "2026-06-22T10:00:00.000Z"
    }
  });
  const sourceSession = agentSessionDetail({
    workState: "running",
    transcript: [{
      id: "later-user",
      timestamp: "2026-06-22T10:05:00.000Z",
      role: "user",
      text: "Repeat",
      phase: null
    }]
  });

  assert.deepEqual(deriveReplyStateFromAgentSession(session, sourceSession, true), session.replyState);
});

test("keeps a stopped Claude recovery unresolved without a terminal outcome", () => {
  const session = sessionDetail({
    adapterId: "claude-code",
    sourceSessionId: "source-1",
    status: "stopped",
    promptRecovery: {
      observedPromptAt: "2026-06-22T10:00:01.000Z",
      phase: "checking",
      promptText: "recover Claude",
      requestedAt: "2026-06-22T10:00:00.000Z",
      retryable: false
    },
    inputHistory: ["recover Claude"]
  });
  const events: ServerEvent[] = [];

  const result = syncManagedSessionReplyState(
    syncCallbacks(session, events),
    agentSessionDetail({
      agentId: "claude-code",
      agentLabel: "Claude Code",
      transcript: [{
        id: "recovered-user",
        timestamp: "2026-06-22T10:00:01.000Z",
        role: "user",
        text: "recover Claude",
        phase: null
      }]
    })
  );

  assert.equal(result?.promptRecovery?.phase, "outcome_unknown");
  assert.equal(result?.status, "read_only");
  assert.deepEqual(result?.replyState, {
    phase: "idle",
    promptText: null,
    requestedAt: null
  });

  assert.equal(events.at(-1)?.type, "session.updated");
});

test("finishes a bounded source check as outcome unknown without inventing agent state", () => {
  const session = sessionDetail({
    adapterId: "codex",
    sourceSessionId: "source-1",
    status: "read_only",
    promptRecovery: {
      observedPromptAt: "2026-06-22T10:00:01.000Z",
      phase: "checking",
      promptText: "missing prompt",
      requestedAt: "2026-06-22T10:00:00.000Z",
      retryable: false
    },
    replyState: {
      phase: "sending",
      promptText: "missing prompt",
      requestedAt: "2026-06-22T10:00:00.000Z"
    }
  });

  const result = syncManagedSessionReplyState(
    syncCallbacks(session),
    agentSessionDetail({ transcript: [] })
  );

  assert.equal(result?.promptRecovery?.phase, "outcome_unknown");
  assert.equal(result?.promptRecovery?.retryable, false);
  assert.deepEqual(result?.replyState, emptyReplyState());
});

test("publishes a fresh managed-session summary when a late terminal clears recovery", () => {
  const session = sessionDetail({
    adapterId: "codex",
    sourceSessionId: "source-1",
    status: "read_only",
    promptRecovery: {
      observedPromptAt: "2026-06-22T10:00:01.000Z",
      phase: "checking",
      promptText: "recover this turn",
      requestedAt: "2026-06-22T10:00:00.000Z",
      retryable: false
    }
  });
  const events: ServerEvent[] = [];

  const result = syncManagedSessionReplyState(
    syncCallbacks(session, events),
    agentSessionDetail({
      updatedAt: "2026-06-22T10:02:00.000Z",
      transcript: [
        {
          id: "recovered-user",
          timestamp: "2026-06-22T10:00:01.000Z",
          role: "user",
          text: "recover this turn",
          phase: null
        },
        {
          id: "recovered-final",
          timestamp: "2026-06-22T10:02:00.000Z",
          role: "assistant",
          text: "Recovered",
          phase: "final"
        },
        {
          id: "recovered-turn-completed",
          timestamp: "2026-06-22T10:02:00.000Z",
          role: "system",
          text: "Turn completed",
          phase: null
        }
      ]
    })
  );

  const event = events.at(-1);

  assert.equal(result?.promptRecovery, null);
  assert.equal(result?.lastActivityAt, "2026-06-22T10:02:00.000Z");
  assert.equal(event?.type, "session.updated");
  if (event?.type === "session.updated") {
    assert.equal(event.payload.lastActivityAt, "2026-06-22T10:02:00.000Z");
    assert.equal(event.payload.promptRecovery, null);
  }
});

for (const adapterId of ["codex", "claude-code"] as const) {
test(`restores a failed ${adapterId} shell after source-confirmed prompt completion`, () => {
  const observedPromptAt = "2026-06-22T10:00:01.000Z";
  const session = sessionDetail({
    adapterId,
    sourceSessionId: "source-1",
    status: "failed",
    exitCode: 1,
    inputHistory: ["recover this turn"],
    logs: [{
      id: "input-sent",
      timestamp: "2026-06-22T10:00:00.000Z",
      stream: "system",
      text: "Input sent.\n"
    }],
    promptRecovery: {
      observedPromptAt,
      phase: "checking",
      promptText: "recover this turn",
      requestedAt: "2026-06-22T10:00:00.000Z",
      retryable: false
    }
  });
  const sourceSession = agentSessionDetail({
    agentId: adapterId,
    agentLabel: adapterId === "codex" ? "Codex" : "Claude Code",
    updatedAt: "2026-06-22T10:02:00.000Z",
    transcript: [
      {
        id: "recovered-user",
        timestamp: observedPromptAt,
        role: "user",
        text: "recover this turn",
        phase: null
      },
      {
        id: "recovered-final",
        timestamp: "2026-06-22T10:02:00.000Z",
        role: "assistant",
        text: "Recovered",
        phase: "final"
      },
      {
        id: "recovered-turn-completed",
        timestamp: "2026-06-22T10:02:00.000Z",
        role: "system",
        text: "Turn completed",
        phase: null
      }
    ]
  });

  const recovered = syncManagedSessionReplyState(syncCallbacks(session), sourceSession);

  assert.equal(recovered?.promptRecovery, null);
  assert.equal(recovered?.status, "read_only");
  assert.equal(recovered?.exitCode, 0);

  const normalized = syncManagedSessionReplyState(syncCallbacks(session), sourceSession);

  assert.equal(normalized?.status, "read_only");
  assert.equal(normalized?.exitCode, 0);
});
}

test("keeps a running takeover session after its prompt returns to idle", () => {
  const session = sessionDetail({
    adapterId: "codex",
    sourceSessionId: "source-1",
    inputHistory: ["take over"],
    replyState: emptyReplyState()
  });
  let detached = false;

  const result = syncManagedSessionReplyState(
    {
      appendLog: () => {},
      detachAttachedSession: async () => {
        detached = true;
        session.status = "stopped";
      },
      detachPromptTransport: () => {},
      emitServerEvent: () => {},
      getPublicSession: () => session,
      hasPromptTransport: () => true,
      listSessions: () => [session],
      persistState: async () => {},
      startQueuedPrompt: async () => session,
      toSummary: summary,
      updateSession: (_sessionId, patch) => {
        Object.assign(session, patch);
      }
    },
    agentSessionDetail({
      attachMode: "read_only",
      attachModeReason: "Active elsewhere"
    })
  );

  assert.equal(detached, false);
  assert.equal(result?.status, "running");
  assert.deepEqual(result?.replyState, emptyReplyState());
});

test("restores waiting state when an active turn is the latest DeskCue prompt", () => {
  const session = sessionDetail({
    adapterId: "codex",
    sourceSessionId: "source-1",
    inputHistory: ["DeskCue-owned prompt"],
    replyState: emptyReplyState()
  });

  const result = syncManagedSessionReplyState(
    {
      appendLog: () => {},
      detachAttachedSession: async () => {},
      detachPromptTransport: () => {},
      emitServerEvent: () => {},
      getPublicSession: () => session,
      listSessions: () => [session],
      persistState: async () => {},
      startQueuedPrompt: async () => session,
      toSummary: summary,
      updateSession: (_sessionId, patch) => {
        Object.assign(session, patch);
      }
    },
    agentSessionDetail({
      workState: "running",
      transcript: [
        {
          id: "entry-1",
          timestamp: "2026-06-22T10:00:01.000Z",
          role: "user",
          text: "DeskCue-owned prompt",
          phase: null
        }
      ]
    })
  );

  assert.deepEqual(result?.replyState, {
    phase: "waiting",
    promptText: "DeskCue-owned prompt",
    requestedAt: "2026-06-22T10:00:01.000Z"
  });
});

test("detaches the prompt transport when a takeover prompt completes", () => {
  const session = sessionDetail({
    adapterId: "codex",
    sourceSessionId: "source-1",
    inputHistory: ["take over"],
    replyState: {
      phase: "waiting",
      promptText: "take over",
      requestedAt: "2026-06-22T10:00:00.000Z"
    }
  });
  const detachedTransports: Array<{ sessionId: string; reason: string }> = [];
  const events: ServerEvent[] = [];

  const result = syncManagedSessionReplyState(
    {
      appendLog: () => {},
      detachAttachedSession: async () => {
        session.status = "stopped";
      },
      detachPromptTransport: (sessionId, reason) => {
        detachedTransports.push({ sessionId, reason });
        session.status = "read_only";
        session.exitCode = 0;
        session.finishedAt = "2026-06-22T10:00:05.000Z";
        session.replyState = emptyReplyState();
      },
      emitServerEvent: (event) => {
        events.push(event);
      },
      getPublicSession: () => session,
      hasPromptTransport: () => true,
      listSessions: () => [session],
      persistState: async () => {},
      startQueuedPrompt: async () => session,
      toSummary: summary,
      updateSession: (_sessionId, patch) => {
        Object.assign(session, patch);
      }
    },
    agentSessionDetail({
      workState: "idle",
      transcript: [
        {
          id: "entry-1",
          timestamp: "2026-06-22T10:00:01.000Z",
          role: "user",
          text: "take over",
          phase: null
        },
        {
          id: "entry-2",
          timestamp: "2026-06-22T10:00:05.000Z",
          role: "assistant",
          text: "ok",
          phase: "final_answer"
        }
      ]
    })
  );

  assert.equal(result?.status, "read_only");
  assert.deepEqual(result?.replyState, emptyReplyState());
  assert.deepEqual(detachedTransports, [
    {
      sessionId: "session-1",
      reason: "completed-prompt"
    }
  ]);
  assert.equal(events.length, 0);
});

test("does not complete an owned transport from an unrelated terminal entry", () => {
  const requestedAt = new Date().toISOString();
  const session = sessionDetail({
    adapterId: "codex",
    sourceSessionId: "source-1",
    replyState: {
      deliveryRequestedAt: requestedAt,
      phase: "sending",
      promptText: "DeskCue prompt",
      requestedAt
    }
  });
  const detachedTransports: string[] = [];

  const result = syncManagedSessionReplyState(
    {
      ...syncCallbacks(session),
      detachPromptTransport: (_sessionId, reason) => {
        detachedTransports.push(reason);
      }
    },
    agentSessionDetail({
      transcript: [{
        id: "unrelated-terminal",
        timestamp: new Date(Date.parse(requestedAt) + 1).toISOString(),
        role: "system",
        text: "Turn completed",
        phase: null
      }]
    })
  );

  assert.equal(result?.replyState.phase, "sending");
  assert.deepEqual(detachedTransports, []);
});

for (const terminalLabel of ["Turn failed", "Turn interrupted"] as const) {
  test(`does not complete an owned transport when the source reports ${terminalLabel}`, () => {
    const session = sessionDetail({
      adapterId: "codex",
      sourceSessionId: "source-1",
      replyState: {
        deliveryRequestedAt: "2026-06-22T10:00:00.000Z",
        phase: "sending",
        promptText: "DeskCue prompt",
        requestedAt: "2026-06-22T10:00:00.000Z"
      }
    });
    const detachedTransports: string[] = [];

    const result = syncManagedSessionReplyState(
      {
        ...syncCallbacks(session),
        detachPromptTransport: (_sessionId, reason) => {
          detachedTransports.push(reason);
        }
      },
      agentSessionDetail({
        transcript: [
          {
            id: "owned-user",
            timestamp: "2026-06-22T10:00:01.000Z",
            role: "user",
            text: "DeskCue prompt",
            phase: null
          },
          {
            id: "owned-terminal",
            timestamp: "2026-06-22T10:00:02.000Z",
            role: "system",
            text: terminalLabel,
            phase: null
          }
        ]
      })
    );

    assert.equal(result?.replyState.phase, "waiting");
    assert.equal(result?.replyState.sourcePromptObserved, true);
    assert.deepEqual(detachedTransports, []);
  });
}

test("does not complete an owned transport from a non-final assistant update", () => {
  const session = sessionDetail({
    adapterId: "claude-code",
    sourceSessionId: "source-1",
    replyState: {
      deliveryRequestedAt: "2026-06-22T10:00:00.000Z",
      phase: "sending",
      promptText: "DeskCue prompt",
      requestedAt: "2026-06-22T10:00:00.000Z"
    }
  });
  const detachedTransports: string[] = [];

  const result = syncManagedSessionReplyState(
    {
      ...syncCallbacks(session),
      detachPromptTransport: (_sessionId, reason) => {
        detachedTransports.push(reason);
      }
    },
    agentSessionDetail({
      agentId: "claude-code",
      agentLabel: "Claude Code",
      workState: "running",
      transcript: [
        {
          id: "owned-user",
          timestamp: "2026-06-22T10:00:01.000Z",
          role: "user",
          text: "DeskCue prompt",
          phase: null
        },
        {
          id: "tool-preamble",
          timestamp: "2026-06-22T10:00:02.000Z",
          role: "assistant",
          text: "I will inspect that.",
          phase: "non_final"
        }
      ]
    })
  );

  assert.equal(result?.replyState.phase, "waiting");
  assert.equal(result?.replyState.sourcePromptObserved, true);
  assert.deepEqual(detachedTransports, []);
});

test("preserves an unassociated nonzero transport exit after a native Codex completion", async () => {
  const session = sessionDetail({
    adapterId: "codex",
    sourceSessionId: "source-1",
    status: "read_only",
    exitCode: 1,
    inputHistory: ["take over"],
    logs: [
      {
        id: "input-sent",
        timestamp: "2026-06-22T10:00:00.000Z",
        stream: "system",
        text: "Initial input sent.\n"
      }
    ],
    replyState: emptyReplyState()
  });
  const events: ServerEvent[] = [];
  let persisted = false;

  const result = syncManagedSessionReplyState(
    {
      ...syncCallbacks(session, events),
      persistState: async () => {
        persisted = true;
      }
    },
    agentSessionDetail({
      workState: "idle",
      transcript: [
        {
          id: "entry-1",
          timestamp: "2026-06-22T10:00:01.000Z",
          role: "user",
          text: "take over",
          phase: null
        },
        {
          id: "entry-2",
          timestamp: "2026-06-22T10:00:04.000Z",
          role: "assistant",
          text: "ok",
          phase: "final_answer"
        },
        {
          id: "entry-3",
          timestamp: "2026-06-22T10:00:05.000Z",
          role: "system",
          text: "Turn completed",
          phase: null
        }
      ]
    })
  );

  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(result?.status, "read_only");
  assert.equal(result?.exitCode, 1);
  assert.equal(persisted, false);
  assert.equal(events.length, 0);
});

test("keeps a nonzero transport exit when the native Codex turn fails", () => {
  const session = sessionDetail({
    adapterId: "codex",
    sourceSessionId: "source-1",
    status: "read_only",
    exitCode: 1,
    inputHistory: ["take over"],
    logs: [
      {
        id: "input-sent",
        timestamp: "2026-06-22T10:00:00.000Z",
        stream: "system",
        text: "Input sent.\n"
      }
    ],
    replyState: emptyReplyState()
  });

  const result = syncManagedSessionReplyState(
    syncCallbacks(session),
    agentSessionDetail({
      workState: "idle",
      transcript: [
        {
          id: "entry-1",
          timestamp: "2026-06-22T10:00:01.000Z",
          role: "user",
          text: "take over",
          phase: null
        },
        {
          id: "entry-2",
          timestamp: "2026-06-22T10:00:05.000Z",
          role: "system",
          text: "Turn failed",
          phase: null
        }
      ]
    })
  );

  assert.equal(result?.exitCode, 1);
});

test("does not normalize a failed owned turn from a later identical completion", () => {
  const session = sessionDetail({
    adapterId: "codex",
    sourceSessionId: "source-1",
    status: "read_only",
    exitCode: 1,
    inputHistory: ["take over"],
    logs: [{
      id: "input-sent",
      timestamp: "2026-06-22T10:00:00.000Z",
      stream: "system",
      text: "Input sent.\n"
    }],
    replyState: emptyReplyState()
  });

  const result = syncManagedSessionReplyState(
    syncCallbacks(session),
    agentSessionDetail({
      workState: "idle",
      transcript: [
        {
          id: "owned-user",
          timestamp: "2026-06-22T10:00:01.000Z",
          role: "user",
          text: "take over",
          phase: null
        },
        {
          id: "owned-failed",
          timestamp: "2026-06-22T10:00:02.000Z",
          role: "system",
          text: "Turn failed",
          phase: null
        },
        {
          id: "later-user",
          timestamp: "2026-06-22T10:00:03.000Z",
          role: "user",
          text: "take over",
          phase: null
        },
        {
          id: "later-completed",
          timestamp: "2026-06-22T10:00:04.000Z",
          role: "system",
          text: "Turn completed",
          phase: null
        }
      ]
    })
  );

  assert.equal(result?.exitCode, 1);
});

test("reconciles a read-only source session to resume when a managed takeover is running", () => {
  const session = sessionDetail({
    adapterId: "codex",
    sourceSessionId: "source-1",
    inputHistory: ["take over"],
    replyState: emptyReplyState()
  });

  const reconciled = reconcileAttachedAgentSession(
    [session],
    (sessionId) => sessionId === "session-1",
    agentSessionDetail({
      attachMode: "read_only",
      attachModeReason: "Active elsewhere"
    })
  );

  assert.equal(reconciled.attachMode, "resume");
  assert.equal(reconciled.attachModeReason, null);
});

test("reconciles a read-only source session to resume when the managed session owns the active turn", () => {
  const session = sessionDetail({
    adapterId: "codex",
    sourceSessionId: "source-1",
    replyState: {
      phase: "waiting",
      promptText: "continue",
      requestedAt: "2026-06-22T10:00:00.000Z"
    }
  });

  const reconciled = reconcileAttachedAgentSession(
    [session],
    (sessionId) => sessionId === "session-1",
    agentSessionDetail({
      attachMode: "read_only",
      attachModeReason: "Active elsewhere",
      transcript: [
        {
          id: "entry-1",
          timestamp: "2026-06-22T10:00:01.000Z",
          role: "user",
          text: "continue",
          phase: null
        }
      ]
    })
  );

  assert.equal(reconciled.attachMode, "resume");
  assert.equal(reconciled.attachModeReason, null);
});

test("reconciles a verified externally stopped turn to resume without waiting for a source terminal entry", () => {
  const reconciled = reconcileAttachedAgentSession(
    [],
    () => false,
    agentSessionDetail({
      attachMode: "read_only",
      attachModeReason: "Active elsewhere",
      interruptLifecycle: {
        phase: "confirmed",
        requestedAt: "2026-06-22T10:00:00.000Z",
        confirmedAt: "2026-06-22T10:00:01.000Z",
        turnFingerprint: "turn-started",
        confirmation: "verified_process",
        outcome: "interrupted"
      }
    })
  );

  assert.equal(reconciled.attachMode, "resume");
  assert.equal(reconciled.attachModeReason, null);
});

test("does not add an interrupt marker when an external Codex turn was not controlled", () => {
  const session = sessionDetail({
    adapterId: "codex",
    sourceSessionId: "source-1",
    inputHistory: ["stop it"],
    logs: [
      {
        id: "log-1",
        timestamp: "2026-06-22T10:00:05.000Z",
        stream: "system",
        text: "Prompt interrupt requested.\n"
      }
    ]
  });

  const reconciled = reconcileAttachedAgentSession(
    [session],
    (sessionId) => sessionId === "session-1",
    agentSessionDetail({
      attachMode: "read_only",
      attachModeReason: "Active elsewhere",
      transcript: [
        {
          id: "entry-1",
          timestamp: "2026-06-22T10:00:01.000Z",
          role: "user",
          text: "stop it",
          phase: null
        }
      ]
    })
  );

  const interruptEntry = reconciled.transcript.find((entry) => entry.text === "Turn interrupted");

  assert.equal(reconciled.attachMode, "resume");

  assert.equal(interruptEntry, undefined);
});

test("starts a queued prompt only after the external Codex turn becomes resumable", async () => {
  const session = sessionDetail({
    adapterId: "codex",
    sourceSessionId: "source-1",
    status: "read_only",
    replyState: {
      phase: "queued",
      promptText: "continue after the external turn",
      requestedAt: "2026-06-22T10:00:00.000Z"
    }
  });
  let starts = 0;
  const events: ServerEvent[] = [];
  const callbacks = {
    appendLog: () => {},
    detachAttachedSession: async () => {},
    detachPromptTransport: () => {},
    emitServerEvent: (event: ServerEvent) => {
      events.push(event);
    },
    getPublicSession: () => session,
    listSessions: () => [session],
    persistState: async () => {},
    startQueuedPrompt: async () => {
      starts += 1;
      return session;
    },
    toSummary: summary,
    updateSession: () => {}
  };

  syncManagedSessionReplyState(
    callbacks,
    agentSessionDetail({ attachMode: "read_only", attachModeReason: "Active elsewhere" })
  );

  assert.equal(starts, 0);

  syncManagedSessionReplyState(callbacks, agentSessionDetail({ attachMode: "resume" }));
  assert.equal(starts, 1);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(events[0]?.type, "session.updated");
});
