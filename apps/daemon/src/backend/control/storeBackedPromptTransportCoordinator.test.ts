import assert from "node:assert/strict";
import test from "node:test";

import type { SessionDetail } from "@deskcue/protocol";
import { SourcePromptStartupError } from "#agents/sourceAgentPromptProcess";
import { emptyPreview, emptyReplyState } from "#sessions/model/sessionDefaults";

import { StoreBackedPromptTransportCoordinator } from "./storeBackedPromptTransportCoordinator.ts";

function coordinatorFor(
  session: SessionDetail,
  lifecycle: string[],
  runtimeOverrides: Record<string, unknown> = {},
  onUpdateSession: (patch: Partial<SessionDetail>) => void = () => {}
) {
  let currentSession = session;
  let deliveryPhase: "accepted" | "dispatching" | "not_sent" | "outcome_unknown" | "prepared" | null = null;

  return new StoreBackedPromptTransportCoordinator({
    appendLog: () => {},
    finishSession: () => {},
    getCallbackContext: () => ({
      persistState: async () => {},
      repository: {
        getSession: () => currentSession,
        getWorkspace: () => null
      },
      restartCodexTransport: async () => session,
      sessionRunner: {
        deleteChild: () => {},
        getChild: () => undefined,
        isCurrentChild: () => false,
        killChild: async () => {},
        spawnProcess: () => {
          throw new Error("unexpected spawn");
        }
      },
      updateSession: () => {}
    }) as never,
    getSession: () => currentSession,
    gitPolling: {
      start: () => {},
      stop: () => {}
    } as never,
    persistState: async () => {},
    promptDeliveries: {
      markAccepted: () => {
        if (deliveryPhase !== "dispatching") return false;

        deliveryPhase = "accepted";
        lifecycle.push("accepted");
        return true;
      },
      markAcceptedBySession: () => {
        if (deliveryPhase !== "dispatching") return false;

        deliveryPhase = "accepted";
        lifecycle.push("accepted");
        return true;
      },
      markActiveOutcomeUnknownForShutdown: () => {
        if (deliveryPhase === "dispatching" || deliveryPhase === "accepted") {
          deliveryPhase = "outcome_unknown";
          lifecycle.push("outcome-unknown");
          return 1;
        }

        return 0;
      },
      markCompleted: () => lifecycle.push("completed"),
      markDispatching: () => {
        if (deliveryPhase !== "prepared") return false;

        deliveryPhase = "dispatching";
        lifecycle.push("dispatching");
        return true;
      },
      markDispatchingBySession: () => {
        if (deliveryPhase !== "prepared") return false;

        deliveryPhase = "dispatching";
        lifecycle.push("dispatching");
        return true;
      },
      markInterrupted: () => lifecycle.push("interrupted"),
      markNotSent: () => {
        if (deliveryPhase !== "prepared") return false;

        deliveryPhase = null;
        lifecycle.push("not-sent");
        return true;
      },
      markNotSentAfterActiveWriterConflict: () => {
        if (!deliveryPhase) return false;

        deliveryPhase = "not_sent";
        lifecycle.push("active-writer-not-sent");
        return true;
      },
      markNotSentAfterSynchronousSpawnFailure: () => {
        if (deliveryPhase !== "prepared" && deliveryPhase !== "dispatching") return false;

        deliveryPhase = null;
        lifecycle.push("not-sent");
        return true;
      },
      markNotSentBySession: () => {
        if (deliveryPhase !== "prepared") return false;

        deliveryPhase = null;
        lifecycle.push("not-sent");
        return true;
      },
      markObservedBySession: () => true,
      markOutcomeUnknown: () => {
        if (deliveryPhase !== "dispatching" && deliveryPhase !== "accepted") return false;

        deliveryPhase = "outcome_unknown";
        lifecycle.push("outcome-unknown");
        return true;
      },
      markOutcomeUnknownBySession: () => {
        if (deliveryPhase !== "dispatching" && deliveryPhase !== "accepted") return false;

        deliveryPhase = "outcome_unknown";
        lifecycle.push("outcome-unknown");
        return true;
      },
      prepare: (_session, prompt) => {
        deliveryPhase = "prepared";
        lifecycle.push(`prepare:${prompt}`);
        return "journal-1";
      }
    },
    publishSessionUpdate: () => {},
    repository: {} as never,
    sessionRunner: {
      deleteChild: () => true,
      isCurrentChild: () => false,
      killChild: async () => {}
    } as never,
    ...runtimeOverrides,
    updateSession: (_sessionId, patch) => {
      onUpdateSession(patch);
      currentSession = { ...currentSession, ...patch };
    }
  });
}

function sessionDetail(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    adapterId: "codex",
    sourceSessionId: "source-1",
    command: "codex resume source-1",
    status: "running",
    startedAt: "2026-08-05T09:00:00.000Z",
    finishedAt: null,
    lastActivityAt: "2026-08-05T09:00:00.000Z",
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
    inputHistory: [],
    ...overrides
  };
}

test("reports source prompt transport support by adapter id", () => {
  const coordinator = coordinatorFor(sessionDetail(), []);

  assert.equal(coordinator.supportsSourceInput("codex"), true);
  assert.equal(coordinator.supportsSourceInput("claude-code"), true);
  assert.equal(coordinator.supportsSourceInput("generic-cli"), false);
});

test("prepares the journal before Codex transport and records transport ownership", async () => {
  const lifecycle: string[] = [];
  const session = sessionDetail();
  const coordinator = coordinatorFor(session, lifecycle, {
    publishSessionUpdate: () => lifecycle.push("published"),
    restartCodexTransportProcess: async (callbacks: {
      markPromptAccepted?: (sessionId: string) => void;
      markPromptDispatching?: (sessionId: string) => void;
    }) => {
      callbacks.markPromptDispatching?.(session.id);
      lifecycle.push("transport");
      callbacks.markPromptAccepted?.(session.id);
      return session;
    }
  });

  await coordinator.sendSourceInput(session, {} as never, "  Continue safely  ");

  assert.deepEqual(lifecycle, [
    "prepare:Continue safely",
    "dispatching",
    "transport",
    "accepted",
    "published"
  ]);
});

test("prepares the journal before Claude transport and records transport ownership", async () => {
  const lifecycle: string[] = [];
  const session = sessionDetail({ adapterId: "claude-code" });
  const coordinator = coordinatorFor(session, lifecycle, {
    restartClaudePromptTransportProcess: async (callbacks: {
      markPromptAccepted?: (sessionId: string) => void;
      markPromptDispatching?: (sessionId: string) => void;
    }) => {
      callbacks.markPromptDispatching?.(session.id);
      lifecycle.push("transport");
      callbacks.markPromptAccepted?.(session.id);
      return session;
    }
  });

  await coordinator.sendSourceInput(session, undefined, "  Continue safely  ");

  assert.deepEqual(lifecycle, [
    "prepare:Continue safely",
    "dispatching",
    "transport",
    "accepted"
  ]);
});

test("marks a prepared Codex delivery not sent when transport validation fails", async () => {
  const lifecycle: string[] = [];
  const session = sessionDetail();
  const coordinator = coordinatorFor(session, lifecycle, {
    publishSessionUpdate: () => lifecycle.push("published"),
    restartCodexTransportProcess: async () => {
      lifecycle.push("transport");
      throw new Error("replacement failed");
    }
  });

  await assert.rejects(
    coordinator.sendSourceInput(session, {} as never, "Continue safely"),
    /replacement failed/
  );

  assert.deepEqual(lifecycle, [
    "prepare:Continue safely",
    "transport",
    "not-sent",
    "published"
  ]);
});

test("marks a dispatching Codex delivery outcome unknown when transport throws", async () => {
  const lifecycle: string[] = [];
  const session = sessionDetail();
  const coordinator = coordinatorFor(session, lifecycle, {
    publishSessionUpdate: () => lifecycle.push("published"),
    restartCodexTransportProcess: async (callbacks: {
      markPromptDispatching?: (sessionId: string) => void;
    }) => {
      callbacks.markPromptDispatching?.(session.id);
      lifecycle.push("transport");
      throw new Error("transport failed after dispatch");
    }
  });

  await assert.rejects(
    coordinator.sendSourceInput(session, {} as never, "Continue safely"),
    /transport failed after dispatch/
  );

  assert.deepEqual(lifecycle, [
    "prepare:Continue safely",
    "dispatching",
    "transport",
    "outcome-unknown",
    "published"
  ]);
});

test("marks a confirmed Codex startup failure not sent and disposes its child", async () => {
  const lifecycle: string[] = [];
  const recoveryUpdates: SessionDetail["promptRecovery"][] = [];
  const session = sessionDetail({
    promptRecovery: {
      phase: "not_sent",
      promptText: "Previous attempt",
      requestedAt: "2026-08-11T07:00:00.000Z",
      retryable: true
    }
  });
  const child = {} as never;
  const coordinator = coordinatorFor(
    session,
    lifecycle,
    {
      restartCodexTransportProcess: async (callbacks: {
        markPromptDispatching?: (sessionId: string) => void;
      }) => {
        callbacks.markPromptDispatching?.(session.id);
        throw new SourcePromptStartupError(new Error("nested startup failed"), child);
      },
      publishSessionUpdate: () => lifecycle.push("published"),
      sessionRunner: {
        deleteChild: () => {
          lifecycle.push("delete-child");
          return true;
        },
        isCurrentChild: (_sessionId: string, activeChild: unknown) => activeChild === child,
        killChild: async () => {
          lifecycle.push("kill-child");
        }
      }
    },
    (patch) => {
      if (patch.promptRecovery !== undefined) recoveryUpdates.push(patch.promptRecovery);
    }
  );

  await assert.rejects(
    coordinator.sendSourceInput(session, {} as never, "Explicit retry"),
    SourcePromptStartupError
  );

  assert.deepEqual(lifecycle, [
    "prepare:Explicit retry",
    "dispatching",
    "not-sent",
    "kill-child",
    "delete-child",
    "published"
  ]);
  assert.deepEqual(recoveryUpdates[0], null);
  assert.equal(recoveryUpdates[1]?.phase, "not_sent");
  assert.equal(recoveryUpdates[1]?.promptText, "Explicit retry");
  assert.notEqual(recoveryUpdates[1]?.requestedAt, "2026-08-11T07:00:00.000Z");
  assert.equal(recoveryUpdates[1]?.retryable, true);
});

test("keeps ownership when an accepted process races a journal transition", async () => {
  const lifecycle: string[] = [];
  const session = sessionDetail();
  let recoveryPhase: string | undefined;
  const coordinator = coordinatorFor(
    session,
    lifecycle,
    {
      restartCodexTransportProcess: async (callbacks: {
        markPromptAccepted?: (sessionId: string) => void;
        markPromptDispatching?: (sessionId: string) => void;
      }) => {
        callbacks.markPromptDispatching?.(session.id);
        callbacks.markPromptAccepted?.(session.id);
        callbacks.markPromptAccepted?.(session.id);
        return session;
      }
    },
    (patch) => {
      recoveryPhase = patch.promptRecovery?.phase;
    }
  );

  await coordinator.sendSourceInput(session, {} as never, "Continue safely");

  assert.equal(recoveryPhase, "outcome_unknown");
  assert.deepEqual(lifecycle, [
    "prepare:Continue safely",
    "dispatching",
    "accepted",
    "outcome-unknown"
  ]);
});

test("classifies a Claude pre-dispatch failure exactly once", async () => {
  const lifecycle: string[] = [];
  const session = sessionDetail({ adapterId: "claude-code" });
  const coordinator = coordinatorFor(session, lifecycle, {
    publishSessionUpdate: () => lifecycle.push("published"),
    restartClaudePromptTransportProcess: async () => {
      lifecycle.push("transport");
      throw new Error("Claude validation failed");
    }
  });

  await assert.rejects(
    coordinator.sendSourceInput(session, undefined, "Continue safely"),
    /Claude validation failed/
  );

  assert.deepEqual(lifecycle, [
    "prepare:Continue safely",
    "transport",
    "not-sent",
    "published"
  ]);
});

test("keeps an existing not-sent recovery card when retry fails before dispatch", async () => {
  const lifecycle: string[] = [];
  const recoveryUpdates: SessionDetail["promptRecovery"][] = [];
  const session = sessionDetail({
    promptRecovery: {
      phase: "not_sent",
      promptText: "Previous attempt",
      requestedAt: "2026-08-11T07:00:00.000Z",
      retryable: true
    }
  });
  const coordinator = coordinatorFor(
    session,
    lifecycle,
    {
      restartCodexTransportProcess: async () => {
        throw new Error("validation failed");
      }
    },
    (patch) => {
      if (patch.promptRecovery !== undefined) recoveryUpdates.push(patch.promptRecovery);
    }
  );

  await assert.rejects(
    coordinator.sendSourceInput(session, {} as never, "Explicit retry"),
    /validation failed/
  );

  assert.deepEqual(recoveryUpdates, []);
  assert.deepEqual(lifecycle, ["prepare:Explicit retry", "not-sent"]);
});

test("rejects empty Codex and Claude prompts before journal mutation", async () => {
  const lifecycle: string[] = [];
  const codex = sessionDetail();
  const claude = sessionDetail({ adapterId: "claude-code", id: "session-2" });
  const coordinator = coordinatorFor(codex, lifecycle);

  await assert.rejects(
    coordinator.sendSourceInput(codex, {} as never, "   "),
    /Prompt is empty/
  );

  await assert.rejects(
    coordinator.sendSourceInput(claude, undefined, "\n\t"),
    /Prompt is empty/
  );

  assert.deepEqual(lifecycle, []);
});

test("dispatches a detached read-only Codex prompt immediately instead of queueing it", async () => {
  const lifecycle: string[] = [];
  const session = sessionDetail({ status: "read_only" });
  const coordinator = coordinatorFor(session, lifecycle, {
    restartCodexTransportProcess: async (callbacks: {
      markPromptAccepted?: (sessionId: string) => void;
      markPromptDispatching?: (sessionId: string) => void;
    }) => {
      callbacks.markPromptDispatching?.(session.id);
      lifecycle.push("transport");
      callbacks.markPromptAccepted?.(session.id);
      return session;
    }
  });

  const result = await coordinator.sendSourceInput(
    session,
    undefined,
    "Continue after the turn"
  );

  assert.equal(result.replyState.phase, "idle");
  assert.deepEqual(lifecycle, [
    "prepare:Continue after the turn",
    "dispatching",
    "transport",
    "accepted"
  ]);
});

test("rejects a concurrent prompt before it can prepare or spawn another transport", async () => {
  const lifecycle: string[] = [];
  const session = sessionDetail();
  let releaseTransport!: () => void;

  const transportGate = new Promise<void>((resolve) => {
    releaseTransport = resolve;
  });
  const coordinator = coordinatorFor(session, lifecycle, {
    restartCodexTransportProcess: async (callbacks: {
      markPromptAccepted?: (sessionId: string) => void;
      markPromptDispatching?: (sessionId: string) => void;
    }) => {
      callbacks.markPromptDispatching?.(session.id);
      lifecycle.push("transport");
      await transportGate;
      callbacks.markPromptAccepted?.(session.id);
      return session;
    }
  });

  const first = coordinator.sendSourceInput(session, {} as never, "First prompt");

  await Promise.resolve();

  await assert.rejects(
    coordinator.sendSourceInput(session, {} as never, "Second prompt"),
    /already handling a prompt/
  );

  releaseTransport();
  await first;

  assert.deepEqual(lifecycle, [
    "prepare:First prompt",
    "dispatching",
    "transport",
    "accepted"
  ]);
});

test("shutdown drains an already-started prompt before process ownership closes", async () => {
  const lifecycle: string[] = [];
  const session = sessionDetail();
  let releaseTransport!: () => void;

  const transportGate = new Promise<void>((resolve) => {
    releaseTransport = resolve;
  });
  const coordinator = coordinatorFor(session, lifecycle, {
    restartCodexTransportProcess: async (callbacks: {
      markPromptAccepted?: (sessionId: string) => void;
      markPromptDispatching?: (sessionId: string) => void;
    }) => {
      callbacks.markPromptDispatching?.(session.id);
      lifecycle.push("transport");
      await transportGate;
      callbacks.markPromptAccepted?.(session.id);
      return session;
    }
  });

  const send = coordinator.sendSourceInput(session, {} as never, "First prompt");

  await Promise.resolve();
  let drained = false;

  const drain = coordinator.beginShutdown().then(() => {
    drained = true;
  });

  await Promise.resolve();
  assert.equal(drained, false);

  releaseTransport();
  await Promise.all([send, drain]);

  assert.equal(drained, true);
  assert.deepEqual(lifecycle, [
    "prepare:First prompt",
    "dispatching",
    "transport",
    "outcome-unknown"
  ]);
});

test("does not accept another prompt while an earlier delivery outcome is unknown", async () => {
  const lifecycle: string[] = [];
  const session = sessionDetail({
    promptRecovery: {
      phase: "outcome_unknown",
      promptText: "Earlier prompt",
      requestedAt: "2026-08-05T10:00:00.000Z",
      retryable: false
    }
  });
  const coordinator = coordinatorFor(session, lifecycle);

  await assert.rejects(
    coordinator.sendSourceInput(session, {} as never, "Potential duplicate"),
    /outcome is still unknown/
  );

  assert.deepEqual(lifecycle, []);
});

test("does not prepare a prompt after shutdown begins", async () => {
  const lifecycle: string[] = [];
  const session = sessionDetail();
  const coordinator = coordinatorFor(session, lifecycle);

  coordinator.beginShutdown();
  await assert.rejects(
    coordinator.sendSourceInput(
      { ...session, adapterId: "claude-code" },
      undefined,
      "Late prompt"
    ),
    /shutting down/
  );

  assert.deepEqual(lifecycle, []);
});

test("records an interrupt before attempting to restart the Codex transport", async () => {
  const lifecycle: string[] = [];
  const session = sessionDetail({ status: "read_only" });
  const sessionRunner = {
    getChild: () => undefined,
    isCurrentChild: () => false,
    killChild: () => {},
    spawnProcess: () => {
      throw new Error("transport should not spawn without a workspace");
    }
  };

  const coordinator = new StoreBackedPromptTransportCoordinator({
    appendLog: () => {},
    finishSession: () => {},
    getCallbackContext: () => ({
      appendLog: () => {},
      finishSession: () => {},
      getSession: () => session,
      gitPolling: {
        start: () => {},
        stop: () => {}
      },
      persistState: async () => {},
      repository: {
        getSession: () => session,
        getWorkspace: () => null
      },
      sessionRunner,
      updateSession: () => {}
    }) as never,
    getSession: () => session,
    gitPolling: {} as never,
    persistState: async () => {},
    promptDeliveries: {
      markAccepted: () => true,
      markAcceptedBySession: () => true,
      markActiveOutcomeUnknownForShutdown: () => 0,
      markCompleted: () => lifecycle.push("completed"),
      markDispatching: () => true,
      markDispatchingBySession: () => true,
      markInterrupted: () => lifecycle.push("interrupted"),
      markNotSent: () => true,
      markNotSentAfterActiveWriterConflict: () => true,
      markNotSentBySession: () => true,
      markObservedBySession: () => true,
      markOutcomeUnknown: () => true,
      markOutcomeUnknownBySession: () => true,
      prepare: () => "journal-1"
    },
    publishSessionUpdate: () => {},
    repository: {} as never,
    sessionRunner: sessionRunner as never,
    updateSession: () => {}
  });

  await assert.rejects(
    coordinator.restartCodexTransport(session, { reason: "interrupt" }),
    /not accepting input/
  );

  assert.deepEqual(lifecycle, ["interrupted"]);
});

test("keeps Claude print ownership until source reconciliation completes", () => {
  const lifecycle: string[] = [];
  const claudeSession = sessionDetail({
    adapterId: "claude-code",
    replyState: {
      phase: "sending",
      promptText: "Continue",
      requestedAt: "2026-08-05T10:00:00.000Z"
    }
  });
  const coordinator = coordinatorFor(claudeSession, lifecycle);

  coordinator.recordSessionFinished("session-1", claudeSession, "read_only", 0);
  assert.deepEqual(lifecycle, []);

  coordinator.recordSessionFinished(
    "session-1",
    { ...claudeSession, adapterId: "codex" },
    "read_only",
    0
  );

  coordinator.recordSessionFinished("session-1", claudeSession, "failed", 1);

  assert.deepEqual(lifecycle, ["completed", "interrupted"]);
});

test("records a user-stopped prompt transport as interrupted even with a zero exit", () => {
  const lifecycle: string[] = [];
  const session = sessionDetail({ status: "stopped" });
  const coordinator = coordinatorFor(session, lifecycle);

  coordinator.recordSessionFinished(session.id, session, "stopped", 0);

  assert.deepEqual(lifecycle, ["interrupted"]);
});

test("preserves an active-writer conflict as definitely not sent", async () => {
  const lifecycle: string[] = [];
  const session = sessionDetail();
  const coordinator = coordinatorFor(session, lifecycle, {
    restartCodexTransportProcess: async (callbacks: {
      markPromptAccepted?: (sessionId: string) => void;
      markPromptDispatching?: (sessionId: string) => void;
    }) => {
      callbacks.markPromptDispatching?.(session.id);
      callbacks.markPromptAccepted?.(session.id);
      return session;
    }
  });

  await coordinator.sendSourceInput(session, {} as never, "Continue safely");
  const requestedAt = new Date().toISOString();
  const finishedSession = sessionDetail({
    logs: [{
      id: "writer-conflict",
      stream: "stderr",
      text: "thread-store conflict: thread source-1 already has an active writer",
      timestamp: new Date(Date.parse(requestedAt) + 1).toISOString()
    }],
    replyState: {
      phase: "sending",
      promptText: "Continue safely",
      requestedAt
    }
  });

  coordinator.recordSessionFinished(session.id, finishedSession, "read_only", null);

  assert.deepEqual(lifecycle, [
    "prepare:Continue safely",
    "dispatching",
    "accepted",
    "active-writer-not-sent"
  ]);
});

test("does not reuse an active-writer conflict from an earlier prompt attempt", async () => {
  const lifecycle: string[] = [];
  const session = sessionDetail({
    logs: [{
      id: "stale-writer-conflict",
      stream: "stderr",
      text: "thread-store conflict: thread source-1 already has an active writer",
      timestamp: "2026-08-05T10:00:00.000Z"
    }]
  });
  const coordinator = coordinatorFor(session, lifecycle, {
    restartCodexTransportProcess: async (callbacks: {
      markPromptAccepted?: (sessionId: string) => void;
      markPromptDispatching?: (sessionId: string) => void;
    }) => {
      callbacks.markPromptDispatching?.(session.id);
      callbacks.markPromptAccepted?.(session.id);
      return session;
    }
  });

  await coordinator.sendSourceInput(session, {} as never, "Continue safely");
  coordinator.recordSessionFinished(session.id, {
    ...session,
    replyState: {
      phase: "sending",
      promptText: "Continue safely",
      requestedAt: new Date().toISOString()
    }
  }, "failed", 1);

  assert.deepEqual(lifecycle, [
    "prepare:Continue safely",
    "dispatching",
    "accepted",
    "interrupted"
  ]);
});

test("shutdown exit cannot terminally resolve an accepted prompt", async () => {
  const lifecycle: string[] = [];
  const session = sessionDetail();
  const coordinator = coordinatorFor(session, lifecycle, {
    restartCodexTransportProcess: async (callbacks: {
      markPromptAccepted?: (sessionId: string) => void;
      markPromptDispatching?: (sessionId: string) => void;
    }) => {
      callbacks.markPromptDispatching?.(session.id);
      callbacks.markPromptAccepted?.(session.id);
      return session;
    }
  });

  await coordinator.sendSourceInput(session, {} as never, "Continue safely");
  coordinator.beginShutdown();
  coordinator.recordSessionFinished(session.id, session, "read_only", null);
  coordinator.recordSessionFinished(session.id, session, "failed", 1);

  assert.deepEqual(lifecycle, [
    "prepare:Continue safely",
    "dispatching",
    "accepted",
    "outcome-unknown"
  ]);
});
