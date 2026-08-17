import assert from "node:assert/strict";
import test from "node:test";

import type { AgentSessionDetail, SessionDetail, SessionSummary } from "@deskcue/protocol";

import { AppError } from "./errors.ts";
import { ManagedSessionService } from "./managedSessionService.ts";
import type { ManagedSessionBackend, SourceAgentSessionDiscovery } from "./ports.ts";

function createManagedSession(patch: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: "session-1",
    adapterId: "codex",
    sourceSessionId: "source-1",
    ...patch
  } as SessionDetail;
}

function createAgentSession(patch: Partial<AgentSessionDetail> = {}): AgentSessionDetail {
  return {
    id: "codex:source-1",
    agentId: "codex",
    sourceSessionId: "source-1",
    originator: "Codex Desktop",
    source: "vscode",
    ...patch
  } as AgentSessionDetail;
}

test("opens only a source chat confirmed as Codex Desktop", async () => {
  const openedSessionIds: string[] = [];
  function createService(agentSession: AgentSessionDetail) {
    return new ManagedSessionService(
      {
        getSession: () => createManagedSession(),
        openExternalCodexDesktopChat: async (sessionId: string) => {
          openedSessionIds.push(sessionId);
        }
      } as unknown as ManagedSessionBackend,
      {
        getSessionDetailForManagedSession: async () => agentSession
      } as unknown as SourceAgentSessionDiscovery
    );
  }
  const service = createService(createAgentSession());

  await service.openExternalCodexDesktopChat("session-1");

  assert.deepEqual(openedSessionIds, ["session-1"]);
});

test("refuses a Codex source chat without Desktop metadata", async () => {
  const service = new ManagedSessionService(
    {
      getSession: () => createManagedSession(),
      openExternalCodexDesktopChat: async () => {
        throw new Error("The host launcher must not be called.");
      }
    } as unknown as ManagedSessionBackend,
    {
      getSessionDetailForManagedSession: async () => createAgentSession({
        originator: "Codex CLI"
      })
    } as unknown as SourceAgentSessionDiscovery
  );

  await assert.rejects(
    service.openExternalCodexDesktopChat("session-1"),
    /confirmed external Codex Desktop chat/
  );
});

test("reports direct interrupt as unavailable only for an active verified Codex Desktop chat", async () => {
  const service = new ManagedSessionService(
    {
      getSession: () => createManagedSession(),
      interruptSession: async () => {
        throw new AppError("not_accepting_input", "External turn is not owned by DeskCue.");
      }
    } as unknown as ManagedSessionBackend,
    {
      getSessionDetailForManagedSession: async () => createAgentSession({
        turnState: {
          activityAt: "2026-07-31T10:00:01.000Z",
          completedAt: null,
          evidence: "turn_lifecycle",
          fingerprint: "turn-1",
          phase: "active",
          startedAt: "2026-07-31T10:00:00.000Z"
        }
      })
    } as unknown as SourceAgentSessionDiscovery
  );

  await assert.rejects(
    service.interruptSession("session-1"),
    (error: unknown) => {
      assert(error instanceof AppError);
      assert.equal(error.code, "external_desktop_interrupt_unavailable");
      return true;
    }
  );
});

test("forwards the active source turn when interrupting a DeskCue-managed chat", async () => {
  let receivedSourceTurn: { fingerprint: string; startedAt: string } | null = null;
  const service = new ManagedSessionService(
    {
      getSession: () => createManagedSession(),
      interruptSession: async (
        _sessionId: string,
        sourceTurn?: { fingerprint: string; startedAt: string } | null
      ) => {
        receivedSourceTurn = sourceTurn ?? null;
        return createManagedSession();
      }
    } as unknown as ManagedSessionBackend,
    {
      getSessionDetailForManagedSession: async () => createAgentSession({
        turnState: {
          activityAt: "2026-07-31T10:00:01.000Z",
          completedAt: null,
          evidence: "turn_lifecycle",
          fingerprint: "turn-1",
          phase: "active",
          startedAt: "2026-07-31T10:00:00.000Z"
        }
      })
    } as unknown as SourceAgentSessionDiscovery
  );

  await service.interruptSession("session-1");

  assert.deepEqual(receivedSourceTurn, {
    fingerprint: "turn-1",
    startedAt: "2026-07-31T10:00:00.000Z"
  });
});

function transcriptEntry(
  id: string,
  role: "user" | "system",
  text: string,
  timestamp: string
) {
  return {
    id,
    phase: null,
    role,
    text,
    timestamp,
    ...(role === "system"
      ? { parts: [{ detail: null, label: text, type: "status" as const }] }
      : {})
  };
}

test("binds a managed Claude interrupt to its exact current source user entry", async () => {
  let receivedSourceTurn: {
    fingerprint: string;
    startedAt: string;
    userEntryId?: string;
  } | null = null;
  const managedSession = createManagedSession({
    adapterId: "claude-code",
    replyState: {
      phase: "waiting",
      promptText: "current DeskCue prompt",
      requestedAt: "2026-07-31T10:00:00.000Z"
    }
  });
  const service = new ManagedSessionService(
    {
      getSession: () => managedSession,
      interruptSession: async (
        _sessionId: string,
        sourceTurn?: { fingerprint: string; startedAt: string; userEntryId?: string } | null
      ) => {
        receivedSourceTurn = sourceTurn ?? null;
        return managedSession;
      }
    } as unknown as ManagedSessionBackend,
    {
      getSessionDetailForManagedSession: async () => createAgentSession({
        agentId: "claude-code",
        transcript: [
          transcriptEntry("user-previous", "user", "previous DeskCue prompt", "2026-07-31T09:00:00.000Z"),
          transcriptEntry("turn-previous", "system", "Turn started", "2026-07-31T09:00:01.000Z"),
          transcriptEntry("turn-complete", "system", "Turn completed", "2026-07-31T09:00:02.000Z"),
          transcriptEntry("user-current", "user", "current DeskCue prompt", "2026-07-31T10:00:00.000Z"),
          transcriptEntry("turn-current", "system", "Turn started", "2026-07-31T10:00:01.000Z")
        ],
        turnState: {
          activityAt: "2026-07-31T10:00:01.000Z",
          completedAt: null,
          evidence: "turn_lifecycle",
          fingerprint: "turn-current",
          phase: "active",
          startedAt: "2026-07-31T10:00:01.000Z"
        }
      })
    } as unknown as SourceAgentSessionDiscovery
  );

  await service.interruptSession("session-1");

  assert.deepEqual(receivedSourceTurn, {
    fingerprint: "turn-current",
    startedAt: "2026-07-31T10:00:01.000Z",
    userEntryId: "user-current"
  });
});

test("starts a queued Codex prompt immediately when its source chat is already idle", async () => {
  let startedQueuedSessionId = "";
  const queued = createManagedSession({
    replyState: {
      phase: "queued",
      promptText: "Test prompt",
      requestedAt: "2026-08-05T06:54:41.380Z"
    },
    status: "read_only"
  });
  const started = {
    ...queued,
    replyState: {
      ...queued.replyState,
      phase: "sending" as const
    },
    status: "running" as const
  };
  const service = new ManagedSessionService(
    {
      getSession: () => queued,
      sendInput: async () => queued,
      startQueuedPrompt: async (sessionId: string) => {
        startedQueuedSessionId = sessionId;
        return started;
      }
    } as unknown as ManagedSessionBackend,
    {
      getSessionDetailForManagedSession: async () => createAgentSession({
        attachMode: "resume",
        workState: "idle",
        turnState: {
          activityAt: null,
          completedAt: "2026-08-05T06:54:40.000Z",
          evidence: "terminal_lifecycle",
          fingerprint: "turn-1",
          phase: "completed",
          startedAt: null
        }
      })
    } as unknown as SourceAgentSessionDiscovery
  );

  const result = await service.sendInput("session-1", "Test prompt");

  assert.equal(startedQueuedSessionId, "session-1");
  assert.equal(result.replyState.phase, "sending");
  assert.equal(result.status, "running");
});

test("keeps ordinary interrupt errors for a non-Desktop Codex source chat", async () => {
  const service = new ManagedSessionService(
    {
      getSession: () => createManagedSession(),
      interruptSession: async () => {
        throw new AppError("not_accepting_input", "External turn is not owned by DeskCue.");
      }
    } as unknown as ManagedSessionBackend,
    {
      getSessionDetailForManagedSession: async () => createAgentSession({
        originator: "Codex CLI",
        turnState: {
          activityAt: "2026-07-31T10:00:01.000Z",
          completedAt: null,
          evidence: "turn_lifecycle",
          fingerprint: "turn-1",
          phase: "active",
          startedAt: "2026-07-31T10:00:00.000Z"
        }
      })
    } as unknown as SourceAgentSessionDiscovery
  );

  await assert.rejects(
    service.interruptSession("session-1"),
    (error: unknown) => {
      assert(error instanceof AppError);
      assert.equal(error.code, "not_accepting_input");
      return true;
    }
  );
});

test("deduplicates direct and overview reply-state sync for the same session", async () => {
  const managedSession = createManagedSession({
    replyState: {
      phase: "waiting",
      promptText: "active prompt",
      requestedAt: "2026-08-05T10:00:00.000Z"
    },
    status: "running"
  });
  let discoveryCount = 0;
  let reconciliationCount = 0;
  let notifyDiscoveryStarted: (() => void) | undefined;
  const discoveryStarted = new Promise<void>((resolve) => {
    notifyDiscoveryStarted = resolve;
  });
  let releaseDiscovery: (() => void) | undefined;
  const discoveryBlocked = new Promise<void>((resolve) => {
    releaseDiscovery = resolve;
  });
  const service = new ManagedSessionService(
    {
      getSession: () => managedSession,
      listSessions: () => [managedSession],
      syncReplyStateFromAgentSession: () => {
        reconciliationCount += 1;
        return managedSession;
      }
    } as unknown as ManagedSessionBackend,
    {
      getSessionDetailForManagedSession: async () => {
        discoveryCount += 1;
        notifyDiscoveryStarted?.();
        await discoveryBlocked;
        return createAgentSession();
      }
    } as unknown as SourceAgentSessionDiscovery
  );

  const directSync = service.syncReplyStateForSession("session-1");
  await discoveryStarted;
  const overviewSync = service.syncReplyStatesForRunningAttachedSessions();

  assert.equal(discoveryCount, 1);
  releaseDiscovery?.();
  await Promise.all([directSync, overviewSync]);
  assert.equal(discoveryCount, 1);
  assert.equal(reconciliationCount, 1);
});

test("recovery sync requests a bounded chat tail beyond a tool-heavy transcript tail", async () => {
  for (const adapterId of ["codex", "claude-code"] as const) {
    const calls: Array<{ chatMessageTail?: number; transcriptTail?: number }> = [];
    const managedSession = createManagedSession({
      adapterId,
      promptRecovery: {
        phase: "checking",
        promptText: "Prompt before more than 160 tool entries",
        requestedAt: "2026-08-11T10:00:00.000Z",
        retryable: false
      },
      status: "stopped"
    });
    const service = new ManagedSessionService(
      {
        getSession: () => managedSession,
        listSessions: () => [managedSession],
        syncReplyStateFromAgentSession: () => managedSession
      } as unknown as ManagedSessionBackend,
      {
        getSessionDetailForManagedSession: async (
          _session: SessionSummary,
          transcriptTail?: number,
          chatMessageTail?: number
        ) => {
          calls.push({ chatMessageTail, transcriptTail });
          return createAgentSession({ agentId: adapterId });
        }
      } as unknown as SourceAgentSessionDiscovery
    );

    await service.syncReplyStateForSession(managedSession.id);

    assert.deepEqual(calls, [{ chatMessageTail: 8, transcriptTail: 160 }]);
  }
});

test("overview keeps reconciling an observed read-only prompt until its terminal reply", async () => {
  const managedSession = createManagedSession({
    status: "read_only",
    replyState: {
      phase: "waiting",
      promptText: "Observed prompt",
      requestedAt: "2026-08-11T10:00:00.000Z"
    }
  });
  let reconciliations = 0;
  const service = new ManagedSessionService(
    {
      getSession: () => managedSession,
      listSessions: () => [managedSession],
      syncReplyStateFromAgentSession: () => {
        reconciliations += 1;
        return {
          ...managedSession,
          replyState: { phase: "idle", promptText: null, requestedAt: null }
        };
      }
    } as unknown as ManagedSessionBackend,
    {
      getSessionDetailForManagedSession: async () => createAgentSession({
        transcript: [{
          id: "assistant-reply",
          timestamp: "2026-08-11T10:00:01.000Z",
          role: "assistant",
          text: "Done",
          phase: null
        }]
      })
    } as unknown as SourceAgentSessionDiscovery
  );

  await service.syncReplyStatesForRunningAttachedSessions();

  assert.equal(reconciliations, 1);
});
