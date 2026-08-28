import assert from "node:assert/strict";
import test from "node:test";

import type { AgentSessionDetail, ServerEvent, SessionDetail } from "@deskcue/protocol";
import type { SourceTurnInterruptTarget } from "#agents/sourceTurnInterruptLifecycle";
import { emptyPreview, emptyReplyState } from "#sessions/model/sessionDefaults";
import { SessionRepository } from "#sessions/state/sessionRepository";

import { StoreBackedSessionOperations } from "./storeBackedSessionOperations.ts";

function sessionDetail(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    adapterId: "codex",
    sourceSessionId: "source-1",
    command: "codex resume source-1",
    status: "stopped",
    startedAt: "2026-07-31T05:00:00.000Z",
    finishedAt: "2026-07-31T05:30:00.000Z",
    lastActivityAt: "2026-07-31T05:30:00.000Z",
    exitCode: null,
    preview: emptyPreview(),
    replyState: emptyReplyState(),
    git: {
      branch: "main",
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: true,
      lastUpdatedAt: "2026-07-31T05:00:00.000Z"
    },
    logs: [],
    inputHistory: [],
    ...overrides
  };
}

test("rejects an active external agent turn without a verified control channel", async () => {
  const repository = new SessionRepository();

  repository.setSession(sessionDetail());

  const operations = new StoreBackedSessionOperations({
    eventBus: {} as never,
    gitPolling: {} as never,
    persistence: {} as never,
    repository,
    sessionRunner: {
      hasChild: () => false
    } as never,
    sourceTurnInterrupts: {} as never
  });

  await assert.rejects(
    operations.interruptSession("session-1", {
      fingerprint: "external-turn",
      startedAt: "2026-07-31T05:40:56.000Z"
    }),
    /does not have a verified control channel/
  );
});

test("does not advertise interrupt for an external Codex Desktop chat", async () => {
  const repository = new SessionRepository();

  repository.setSession(sessionDetail());

  const operations = new StoreBackedSessionOperations({
    eventBus: {} as never,
    gitPolling: {} as never,
    persistence: {} as never,
    repository,
    sessionRunner: {
      hasChild: () => false
    } as never,
    sourceTurnInterrupts: {} as never
  });

  assert.deepEqual(
    await operations.getExternalDesktopInterruptCapability("session-1"),
    { kind: "unavailable", reason: "desktop_interrupt_not_supported" }
  );

  await assert.rejects(
    operations.interruptExternalDesktopSession("session-1"),
    /cannot interrupt an external Codex Desktop chat/
  );
});

test("journals and serializes prompt writes for a daemon-owned Generic PTY", async () => {
  const repository = new SessionRepository();

  repository.setSession(sessionDetail({
    adapterId: "generic-cli",
    command: "local-agent",
    sourceSessionId: null,
    status: "running"
  }));
  const writes: string[] = [];
  const promptLifecycle: string[] = [];
  let releasePersist!: () => void;
  const persistGate = new Promise<void>((resolve) => {
    releasePersist = resolve;
  });
  const child = {
    pid: 42,
    transport: "pty",
    kill: () => {},
    onData: () => ({ dispose: () => {} }),
    onExit: () => ({ dispose: () => {} }),
    write: (value: string) => writes.push(value)
  };

  const operations = new StoreBackedSessionOperations({
    eventBus: { publishServerEvent: () => {} } as never,
    gitPolling: {} as never,
    persistence: {
      persistNow: () => persistGate,
      schedulePersist: () => {}
    } as never,
    promptDeliveries: {
      markAccepted: () => {
        promptLifecycle.push("accepted");
        return true;
      },
      markAcceptedBySession: () => true,
      markActiveOutcomeUnknownForShutdown: () => 0,
      markCompleted: () => {},
      markDispatching: () => {
        promptLifecycle.push("dispatching");
        return true;
      },
      markDispatchingBySession: () => true,
      markInterrupted: () => {},
      markNotSent: () => true,
      markNotSentAfterActiveWriterConflict: () => true,
      markNotSentBySession: () => true,
      markObservedBySession: () => true,
      markOutcomeUnknown: () => true,
      markOutcomeUnknownBySession: () => true,
      prepare: (_session, prompt) => {
        promptLifecycle.push(`prepared:${prompt}`);
        return "generic-delivery-1";
      }
    },
    repository,
    sessionRunner: {
      getChild: () => child,
      hasChild: () => true
    } as never,
    sourceTurnInterrupts: {} as never
  });

  const first = operations.sendInput("session-1", "First prompt");

  await Promise.resolve();

  assert.deepEqual(promptLifecycle, ["prepared:First prompt"]);
  assert.equal(writes.length, 0);
  await assert.rejects(
    operations.sendInput("session-1", "Second prompt"),
    /already handling input/
  );

  let drained = false;
  const shutdown = operations.beginShutdown().then(() => {
    drained = true;
  });

  await Promise.resolve();
  assert.equal(drained, false);
  await assert.rejects(
    operations.sendInput("session-1", "Prompt during shutdown"),
    /shutting down/
  );

  releasePersist();
  await Promise.all([first, shutdown]);

  assert.equal(drained, true);
  assert.deepEqual(promptLifecycle, [
    "prepared:First prompt",
    "dispatching",
    "accepted"
  ]);
  assert.equal(writes.length, 1);
  assert.match(writes[0] ?? "", /First prompt/);
  assert.equal(repository.getSession("session-1")?.replyState.phase, "waiting");
});

test("opens only an external Codex Desktop session on the host", async () => {
  const repository = new SessionRepository();

  repository.setSession(sessionDetail());
  const openedSourceSessionIds: string[] = [];
  const operations = new StoreBackedSessionOperations({
    eventBus: {} as never,
    gitPolling: {} as never,
    persistence: {} as never,
    repository,
    sessionRunner: {
      hasChild: () => false
    } as never,
    sourceTurnInterrupts: {} as never,
    openCodexDesktopThread: async (sourceSessionId) => {
      openedSourceSessionIds.push(sourceSessionId);
    }
  });

  await operations.openExternalCodexDesktopChat("session-1");

  assert.deepEqual(openedSourceSessionIds, ["source-1"]);
});

test("records and confirms an owned interrupt after a synchronous managed transport exit", async () => {
  const repository = new SessionRepository();

  repository.setSession(sessionDetail({ status: "running", finishedAt: null }));
  const lifecycle: string[] = [];
  const sourceEvents: ServerEvent[] = [];
  let interruptPhase: "confirmed" | "idle" | "requested" = "idle";
  let hasChild = true;
  const child = {
    pid: 42,
    transport: "pipe",
    kill: () => {},
    onData: () => ({ dispose: () => {} }),
    onExit: () => ({ dispose: () => {} }),
    write: () => {}
  };

  const operations = new StoreBackedSessionOperations({
    eventBus: {
      publishServerEvent: (event: ServerEvent) => sourceEvents.push(event)
    } as never,
    gitPolling: {} as never,
    persistence: {
      persistNow: async () => {},
      schedulePersist: () => {}
    } as never,
    repository,
    sessionRunner: {
      getChild: () => hasChild ? child : undefined,
      hasChild: () => hasChild,
      isCurrentChild: () => hasChild,
      deleteChild: () => {
        hasChild = false;
      },
      killChild: () => {
        lifecycle.push("transport-exit");
        hasChild = false;
      },
      spawnProcess: () => child
    } as never,
    sourceTurnInterrupts: {
      decorate: <T extends AgentSessionDetail>(sourceSession: T) => ({
        ...sourceSession,
        ...(interruptPhase === "idle"
          ? {}
          : {
              interruptLifecycle: {
                phase: interruptPhase,
                requestedAt: "2026-08-05T08:00:01.000Z",
                confirmedAt: interruptPhase === "confirmed"
                  ? "2026-08-05T08:00:02.000Z"
                  : null,
                turnFingerprint: "turn-1",
                confirmation: interruptPhase === "confirmed" ? "verified_process" : null,
                outcome: interruptPhase === "confirmed" ? "interrupted" : null
              }
            })
      }),
      requestManaged: (_session: SessionDetail, target: SourceTurnInterruptTarget) => {
        interruptPhase = "requested";
        lifecycle.push(`request:${target.fingerprint}`);
        return { ownsCancellation: true, record: {} };
      },
      confirmManagedTransportExit: () => {
        interruptPhase = "confirmed";
        lifecycle.push("confirm");
      }
    } as never
  });

  const result = await operations.interruptSession("session-1", {
    fingerprint: "turn-1",
    startedAt: "2026-08-05T08:00:00.000Z"
  }, {
    agentId: "codex",
    agentLabel: "Codex",
    attachMode: "resume",
    cliVersion: null,
    filePath: "source.jsonl",
    id: "codex:source-1",
    model: null,
    originator: null,
    source: "codex",
    sourceSessionId: "source-1",
    title: "Source chat",
    transcript: [],
    updatedAt: "2026-08-05T08:00:00.000Z",
    workspaceName: "Workspace",
    workspacePath: "D:\\work\\repo",
    workState: "running"
  });

  assert.equal(result.status, "stopped");
  assert.deepEqual(lifecycle, ["request:turn-1", "transport-exit", "confirm"]);
  assert.deepEqual(sourceEvents.filter((event) => event.type === "agent.session.updated").map((event) => ({
    phase: event.type === "agent.session.updated"
      ? event.payload.interruptLifecycle?.phase
      : null,
    type: event.type
  })), [
    { phase: "requested", type: "agent.session.updated" },
    { phase: "confirmed", type: "agent.session.updated" }
  ]);
});

test("publishes a rollback when an owned source interrupt cannot stop its transport", async () => {
  const repository = new SessionRepository();

  repository.setSession(sessionDetail({ status: "running", finishedAt: null }));
  const publishedPhases: Array<string | undefined> = [];
  let interruptPhase: "idle" | "requested" = "idle";
  const child = {
    pid: 42,
    transport: "pipe",
    kill: () => {},
    onData: () => ({ dispose: () => {} }),
    onExit: () => ({ dispose: () => {} }),
    write: () => {}
  };

  const sourceAgentSession = {
    agentId: "claude-code",
    agentLabel: "Claude Code",
    attachMode: "resume",
    cliVersion: null,
    filePath: "source.jsonl",
    id: "claude-code:source-1",
    model: null,
    originator: null,
    source: "claude.projects",
    sourceSessionId: "source-1",
    title: "Source chat",
    transcript: [],
    updatedAt: "2026-08-05T08:00:00.000Z",
    workspaceName: "Workspace",
    workspacePath: "D:\\work\\repo",
    workState: "running"
  } satisfies AgentSessionDetail;
  const operations = new StoreBackedSessionOperations({
    eventBus: {
      publishServerEvent: (event: ServerEvent) => {
        if (event.type === "agent.session.updated") publishedPhases.push(event.payload.interruptLifecycle?.phase);
      }
    } as never,
    gitPolling: {} as never,
    persistence: {
      persistNow: async () => {},
      schedulePersist: () => {}
    } as never,
    repository,
    sessionRunner: {
      deleteChild: () => false,
      getChild: () => child,
      hasChild: () => true,
      isCurrentChild: () => true,
      killChild: () => {
        throw new Error("process tree did not exit");
      },
      spawnProcess: () => child
    } as never,
    sourceTurnInterrupts: {
      cancelManagedRequest: () => {
        interruptPhase = "idle";
        return true;
      },
      decorate: <T extends AgentSessionDetail>(sourceSession: T) => ({
        ...sourceSession,
        ...(interruptPhase === "requested"
          ? {
              interruptLifecycle: {
                phase: "requested" as const,
                requestedAt: "2026-08-05T08:00:01.000Z",
                confirmedAt: null,
                turnFingerprint: "turn-1",
                confirmation: null,
                outcome: null
              }
            }
          : {})
      }),
      requestManaged: () => {
        interruptPhase = "requested";
        return { ownsCancellation: true, record: {} };
      }
    } as never
  });

  await assert.rejects(
    operations.interruptSession("session-1", {
      fingerprint: "turn-1",
      startedAt: "2026-08-05T08:00:00.000Z"
    }, sourceAgentSession),
    /process tree did not exit/
  );

  assert.equal(repository.getSession("session-1")?.status, "running");
  assert.deepEqual(publishedPhases, ["requested", undefined]);
});

test("does not leave a detached Codex prompt queued when transport cannot start", async () => {
  const repository = new SessionRepository();

  repository.setSession(sessionDetail({ status: "read_only" }));
  const lifecycle: string[] = [];
  let journalRequestedAt: string | undefined;
  const operations = new StoreBackedSessionOperations({
    eventBus: {
      publishServerEvent: () => {}
    } as never,
    gitPolling: {} as never,
    persistence: {
      persistNow: async () => {
        lifecycle.push("persist");
      },
      schedulePersist: () => {}
    } as never,
    promptDeliveries: {
      markAccepted: () => true,
      markAcceptedBySession: () => true,
      markActiveOutcomeUnknownForShutdown: () => 0,
      markCompleted: () => {},
      markDispatching: () => true,
      markDispatchingBySession: () => true,
      markInterrupted: () => lifecycle.push("interrupted"),
      markNotSent: () => true,
      markNotSentAfterActiveWriterConflict: () => true,
      markNotSentBySession: () => true,
      markObservedBySession: () => true,
      markOutcomeUnknown: () => true,
      markOutcomeUnknownBySession: () => true,
      prepare: (_session, prompt, requestedAt) => {
        journalRequestedAt = requestedAt;
        lifecycle.push(`prepare:${prompt}`);
        return "journal-1";
      }
    },
    repository,
    sessionRunner: {
      deleteChild: () => false,
      getChild: () => undefined,
      hasChild: () => false,
      isCurrentChild: () => false,
      killChild: async () => {},
      spawnProcess: () => {
        throw new Error("unexpected spawn");
      }
    } as never,
    sourceTurnInterrupts: {} as never
  });

  await assert.rejects(
    operations.sendInput("session-1", "Continue safely"),
    /not accepting input/
  );

  const result = repository.getSession("session-1");

  assert.equal(result?.replyState.phase, "idle");
  assert.equal(result?.promptRecovery?.phase, "not_sent");
  assert.equal(result?.promptRecovery?.requestedAt, journalRequestedAt);
  assert.deepEqual(lifecycle, ["prepare:Continue safely", "persist"]);
});

test("marks an unconfirmed shutdown survivor as recovery-required instead of stopped", () => {
  const repository = new SessionRepository();

  repository.setSession(sessionDetail({ status: "running", finishedAt: null }));
  const events: string[] = [];
  const operations = new StoreBackedSessionOperations({
    eventBus: {
      publishServerEvent: (event: ServerEvent) => events.push(event.type)
    } as never,
    gitPolling: {
      stop: (sessionId: string) => events.push(`git-stop:${sessionId}`)
    } as never,
    persistence: {
      persistNow: async () => {},
      schedulePersist: () => {}
    } as never,
    promptDeliveries: {
      markAccepted: () => true,
      markAcceptedBySession: () => true,
      markActiveOutcomeUnknownForShutdown: () => 0,
      markCompleted: () => {},
      markDispatching: () => true,
      markDispatchingBySession: () => true,
      markInterrupted: (sessionId) => events.push(`prompt-interrupted:${sessionId}`),
      markNotSent: () => true,
      markNotSentAfterActiveWriterConflict: () => true,
      markNotSentBySession: () => true,
      markObservedBySession: () => true,
      markOutcomeUnknown: () => true,
      markOutcomeUnknownBySession: (sessionId) => {
        events.push(`prompt-outcome-unknown:${sessionId}`);
        return true;
      },
      prepare: () => "journal-1"
    },
    repository,
    sessionRunner: {
      hasChild: () => true
    } as never,
    sourceTurnInterrupts: {} as never
  });

  operations.markSessionRecoveryRequiredAfterShutdown({
    error: "process did not exit",
    pid: 42,
    sessionId: "session-1"
  });

  const session = repository.getSession("session-1");

  assert.equal(session?.status, "read_only");

  assert.equal(session?.exitCode, null);
  assert.equal(session?.replyState.phase, "idle");
  assert.match(session?.logs.at(-1)?.text ?? "", /requires recovery/);
  assert.deepEqual(events, [
    "prompt-outcome-unknown:session-1",
    "git-stop:session-1",
    "session.log",
    "session.updated"
  ]);
});
