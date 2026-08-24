import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  AgentSessionDetail,
  AgentSessionSummary,
  AgentTranscriptEntry,
  ServerEvent
} from "@deskcue/protocol";
import type { DaemonApplication } from "#application/daemonApplication";

import { createAgentSessionRealtimeSync } from "./agentSessionRealtimeSync.ts";
import { AgentSessionTurnStateRepository } from "./agentSessionTurnStateRepository.ts";

function createRealtimeSync(
  application: DaemonApplication,
  options: Parameters<typeof createAgentSessionRealtimeSync>[2] = {}
) {
  return createAgentSessionRealtimeSync(application, () => false, {
    turnStateStoragePath: null,
    ...options
  });
}

function createAgentSessionDetail(
  attachMode: AgentSessionSummary["attachMode"],
  transcript: AgentTranscriptEntry[]
): AgentSessionDetail {
  return {
    agentId: "codex",
    agentLabel: "Codex",
    attachMode,
    filePath: "codex.jsonl",
    id: "codex:source-1",
    model: "gpt-5",
    originator: "Codex Desktop",
    cliVersion: "0.142.2",
    source: "vscode",
    sourceSessionId: "source-1",
    title: "Check Access tab e2e",
    transcript,
    updatedAt: "2026-07-09T08:00:30.000Z",
    workState: attachMode === "read_only" ? "running" : "idle",
    workspaceName: "ExampleWorkspace",
    workspacePath: "C:\\projects\\ExampleWorkspace"
  };
}

function summaryFromDetail(detail: AgentSessionDetail): AgentSessionSummary {
  const { transcript: _transcript, ...summary } = detail;

  return summary;
}

function lifecycleEntry(
  id: string,
  timestamp: string,
  label: "Turn started" | "Turn completed" | "Turn interrupted",
  detail: string | null = null
): AgentTranscriptEntry {
  return {
    id,
    parts: [
      {
        detail,
        label,
        type: "status"
      }
    ],
    phase: null,
    role: "system",
    text: detail ?? label,
    timestamp
  };
}

function textEntry(id: string, timestamp: string, text: string): AgentTranscriptEntry {
  return {
    id,
    phase: null,
    role: "assistant",
    text,
    timestamp
  };
}

test("agent session realtime sync publishes turn finished event after observed active turn completes", async () => {
  const events = new EventEmitter();
  const publishedEvents: ServerEvent[] = [];
  const startedAt = new Date(Date.now() - 5_000).toISOString();
  const completedAt = new Date(Date.now() - 1_000).toISOString();
  let detail = createAgentSessionDetail("read_only", [
    lifecycleEntry("start-1", startedAt, "Turn started")
  ]);
  const application = {
    events: Object.assign(events, {
      publishServerEvent: (event: ServerEvent) => {
        publishedEvents.push(event);
        events.emit("event", event);
      }
    }),
    managedSessions: {
      listSessions: () => []
    },
    sourceAgentSessions: {
      getSessionDetail: async () => detail,
      listRecentSessions: async () => [summaryFromDetail(detail)],
      reconcileAttachedSession: <T extends AgentSessionDetail | AgentSessionSummary>(session: T) =>
        session,
      syncReplyStateFromAgentSession: () => {}
    }
  } as unknown as DaemonApplication;
  const sync = createRealtimeSync(application);

  await sync();
  detail = createAgentSessionDetail("resume", [
    lifecycleEntry("start-1", startedAt, "Turn started"),
    textEntry("assistant-1", completedAt, "Done with the requested change."),
    lifecycleEntry("done-1", completedAt, "Turn completed")
  ]);
  await sync();
  await sync();

  assert.deepEqual(
    publishedEvents.filter((event) => event.type === "agent.session.turn.finished"),
    [
      {
        type: "agent.session.turn.finished",
        payload: {
          agentId: "codex",
          agentLabel: "Codex",
          agentSessionId: "codex:source-1",
          answer: "Done with the requested change.",
          completedAt,
          durationMs: null,
          sourceSessionId: "source-1",
          startedAt,
          status: "completed",
          title: "Check Access tab e2e",
          workspaceName: "ExampleWorkspace",
          workspacePath: "C:\\projects\\ExampleWorkspace"
        }
      }
    ]
  );
});

test("agent session realtime sync publishes a completion masked by an immediate next prompt", async () => {
  const events = new EventEmitter();
  const publishedEvents: ServerEvent[] = [];
  const startedAt = new Date(Date.now() - 8_000).toISOString();
  const completedAt = new Date(Date.now() - 4_000).toISOString();
  const nextStartedAt = new Date(Date.now() - 1_000).toISOString();
  let detail = createAgentSessionDetail("read_only", [
    lifecycleEntry("start-1", startedAt, "Turn started")
  ]);
  const application = {
    events: Object.assign(events, {
      publishServerEvent: (event: ServerEvent) => {
        publishedEvents.push(event);
        events.emit("event", event);
      }
    }),
    managedSessions: { listSessions: () => [] },
    sourceAgentSessions: {
      getSessionDetail: async () => detail,
      listRecentSessions: async () => [summaryFromDetail(detail)],
      reconcileAttachedSession: <T extends AgentSessionDetail | AgentSessionSummary>(session: T) =>
        session,
      syncReplyStateFromAgentSession: () => {}
    }
  } as unknown as DaemonApplication;
  const sync = createRealtimeSync(application);

  await sync();
  detail = createAgentSessionDetail("read_only", [
    lifecycleEntry("start-1", startedAt, "Turn started"),
    textEntry("assistant-1", completedAt, "Previous reply"),
    lifecycleEntry("done-1", completedAt, "Turn completed"),
    lifecycleEntry("start-2", nextStartedAt, "Turn started")
  ]);
  await sync();
  await sync();

  assert.deepEqual(
    publishedEvents.filter((event) => event.type === "agent.session.turn.finished"),
    [
      {
        type: "agent.session.turn.finished",
        payload: {
          agentId: "codex",
          agentLabel: "Codex",
          agentSessionId: "codex:source-1",
          answer: "Previous reply",
          completedAt,
          durationMs: null,
          sourceSessionId: "source-1",
          startedAt,
          status: "completed",
          title: "Check Access tab e2e",
          workspaceName: "ExampleWorkspace",
          workspacePath: "C:\\projects\\ExampleWorkspace"
        }
      }
    ]
  );
});

test("agent session turn-state repository keeps v1 JSON bounded and drops expired records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-turn-state-repository-"));
  const storagePath = join(directory, "turn-state.json");
  const repository = new AgentSessionTurnStateRepository(storagePath);
  const now = Date.now();

  try {
    for (let index = 0; index < 205; index += 1) {
      repository.set(`session-${index}`, {
        observedAt: new Date(now - index).toISOString(),
        owner: index % 2 === 0 ? "external" : "managed",
        state: {
          completedAt: new Date(now - index).toISOString(),
          evidence: "terminal_lifecycle",
          fingerprint: `done-${index}`,
          phase: "completed",
          turnStartFingerprint: null
        }
      });
    }

    repository.set("expired", {
      observedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString(),
      owner: "external",
      state: {
        completedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString(),
        evidence: "terminal_lifecycle",
        fingerprint: "expired",
        phase: "completed",
        turnStartFingerprint: null
      }
    });

    assert.equal(await repository.persist(), true);
    const stored = JSON.parse(await readFile(storagePath, "utf8")) as {
      sessions: Array<{ id: string }>;
      version: number;
    };

    assert.equal(stored.version, 1);
    assert.equal(stored.sessions.length, 200);
    assert.equal(stored.sessions.some((record) => record.id === "expired"), false);
    assert.equal(stored.sessions[0]?.id, "session-0");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("agent session realtime sync catches a fast external turn between polls", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-realtime-sync-"));
  const transcriptPath = join(directory, "session.jsonl");
  const events = new EventEmitter();
  const publishedEvents: ServerEvent[] = [];
  const previousCompletedAt = new Date(Date.now() - 10_000).toISOString();
  const completedAt = new Date(Date.now() - 1_000).toISOString();
  let detail = {
    ...createAgentSessionDetail("read_only", [
      lifecycleEntry("previous-done", previousCompletedAt, "Turn completed")
    ]),
    filePath: transcriptPath
  };

  const application = {
    events: Object.assign(events, {
      publishServerEvent: (event: ServerEvent) => {
        publishedEvents.push(event);
        events.emit("event", event);
      }
    }),
    managedSessions: { listSessions: () => [] },
    sourceAgentSessions: {
      getSessionDetail: async () => detail,
      listRecentSessions: async () => [summaryFromDetail(detail)],
      reconcileAttachedSession: <T extends AgentSessionDetail | AgentSessionSummary>(session: T) => session,
      syncReplyStateFromAgentSession: () => {}
    }
  } as unknown as DaemonApplication;

  try {
    await writeFile(transcriptPath, "baseline", "utf8");
    const sync = createRealtimeSync(application, { turnStateStoragePath: null });

    await sync();

    await writeFile(transcriptPath, "new terminal turn", "utf8");
    detail = {
      ...createAgentSessionDetail("read_only", [
        lifecycleEntry("previous-done", previousCompletedAt, "Turn completed"),
        textEntry("assistant-1", completedAt, "Fast reply"),
        lifecycleEntry("done-1", completedAt, "Turn completed")
      ]),
      filePath: transcriptPath
    };

    await sync();

    assert.equal(
      publishedEvents.filter((event) => event.type === "agent.session.turn.finished").length,
      1
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("agent session realtime sync continues tracking a resumed source chat after a terminal turn", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-realtime-sync-"));
  const transcriptPath = join(directory, "session.jsonl");
  const events = new EventEmitter();
  const publishedEvents: ServerEvent[] = [];
  const firstCompletedAt = new Date(Date.now() - 10_000).toISOString();
  const secondStartedAt = new Date(Date.now() - 5_000).toISOString();
  const secondCompletedAt = new Date(Date.now() - 1_000).toISOString();
  let detail = {
    ...createAgentSessionDetail("read_only", [
      lifecycleEntry("done-1", firstCompletedAt, "Turn completed")
    ]),
    filePath: transcriptPath
  };

  const application = {
    events: Object.assign(events, {
      publishServerEvent: (event: ServerEvent) => {
        publishedEvents.push(event);
        events.emit("event", event);
      }
    }),
    managedSessions: { listSessions: () => [] },
    sourceAgentSessions: {
      getSessionDetail: async () => detail,
      listRecentSessions: async () => [summaryFromDetail(detail)],
      reconcileAttachedSession: <T extends AgentSessionDetail | AgentSessionSummary>(session: T) => session,
      syncReplyStateFromAgentSession: () => {}
    }
  } as unknown as DaemonApplication;

  try {
    await writeFile(transcriptPath, "first terminal", "utf8");
    const sync = createRealtimeSync(application, { turnStateStoragePath: null });

    await sync();

    await writeFile(transcriptPath, "second terminal", "utf8");
    detail = {
      ...createAgentSessionDetail("resume", [
        lifecycleEntry("done-1", firstCompletedAt, "Turn completed"),
        lifecycleEntry("start-2", secondStartedAt, "Turn started"),
        textEntry("assistant-2", secondCompletedAt, "Second reply"),
        lifecycleEntry("done-2", secondCompletedAt, "Turn completed")
      ]),
      filePath: transcriptPath
    };

    await sync();

    assert.deepEqual(
      publishedEvents
        .filter((event) => event.type === "agent.session.turn.finished")
        .map((event) => event.payload.completedAt),
      [secondCompletedAt]
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("agent session realtime sync publishes turn finished event after daemon restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-realtime-sync-"));
  const turnStateStoragePath = join(directory, "turn-state.json");
  const events = new EventEmitter();
  const publishedEvents: ServerEvent[] = [];
  const startedAt = new Date(Date.now() - 5_000).toISOString();
  const completedAt = new Date(Date.now() - 1_000).toISOString();
  let detail = createAgentSessionDetail("read_only", [
    lifecycleEntry("start-1", startedAt, "Turn started")
  ]);
  const application = {
    events: Object.assign(events, {
      publishServerEvent: (event: ServerEvent) => {
        publishedEvents.push(event);
        events.emit("event", event);
      }
    }),
    managedSessions: {
      listSessions: () => []
    },
    sourceAgentSessions: {
      getSessionDetail: async () => detail,
      listRecentSessions: async () => [summaryFromDetail(detail)],
      reconcileAttachedSession: <T extends AgentSessionDetail | AgentSessionSummary>(session: T) =>
        session,
      syncReplyStateFromAgentSession: () => {}
    }
  } as unknown as DaemonApplication;

  try {
    const firstSync = createRealtimeSync(application, {
      turnStateStoragePath
    });

    await firstSync();

    detail = createAgentSessionDetail("resume", [
      lifecycleEntry("start-1", startedAt, "Turn started"),
      textEntry("assistant-1", completedAt, "Done after restart."),
      lifecycleEntry("done-1", completedAt, "Turn completed")
    ]);
    const secondSync = createRealtimeSync(application, {
      turnStateStoragePath
    });

    await secondSync();

    assert.deepEqual(
      publishedEvents.filter((event) => event.type === "agent.session.turn.finished"),
      [
        {
          type: "agent.session.turn.finished",
          payload: {
            agentId: "codex",
            agentLabel: "Codex",
            agentSessionId: "codex:source-1",
            answer: "Done after restart.",
            completedAt,
            durationMs: null,
            sourceSessionId: "source-1",
            startedAt,
            status: "completed",
            title: "Check Access tab e2e",
            workspaceName: "ExampleWorkspace",
            workspacePath: "C:\\projects\\ExampleWorkspace"
          }
        }
      ]
    );
  } finally {
    await rm(directory, {
      force: true,
      recursive: true
    });
  }
});

test("agent session realtime sync publishes transcript updated event when observed transcript changes", async () => {
  const events = new EventEmitter();
  const publishedEvents: ServerEvent[] = [];
  const startedAt = new Date(Date.now() - 5_000).toISOString();
  const completedAt = new Date(Date.now() - 1_000).toISOString();
  let detail = createAgentSessionDetail("resume", [
    lifecycleEntry("start-1", startedAt, "Turn started")
  ]);
  const application = {
    events: Object.assign(events, {
      publishServerEvent: (event: ServerEvent) => {
        publishedEvents.push(event);
        events.emit("event", event);
      }
    }),
    managedSessions: {
      listSessions: () => [
        {
          adapterId: "codex",
          id: "managed-1",
          sourceSessionId: "source-1",
          status: "running"
        }
      ]
    },
    sourceAgentSessions: {
      getSessionDetail: async () => detail,
      listRecentSessions: async () => [summaryFromDetail(detail)],
      reconcileAttachedSession: <T extends AgentSessionDetail | AgentSessionSummary>(session: T) =>
        session,
      syncReplyStateFromAgentSession: () => {}
    }
  } as unknown as DaemonApplication;
  const sync = createRealtimeSync(application);

  await sync();
  detail = createAgentSessionDetail("resume", [
    lifecycleEntry("start-1", startedAt, "Turn started"),
    textEntry("assistant-1", completedAt, "Done.")
  ]);
  await sync();

  assert.deepEqual(
    publishedEvents.filter((event) => event.type === "agent.session.transcript.updated"),
    [
      {
        type: "agent.session.transcript.updated",
        payload: {
          agentId: "codex",
          agentLabel: "Codex",
          agentSessionId: "codex:source-1",
          latestEntryId: "assistant-1",
          sourceSessionId: "source-1",
          transcriptLength: 2,
          updatedAt: "2026-07-09T08:00:30.000Z",
          workState: "idle"
        }
      }
    ]
  );
});

test("agent session realtime sync publishes turn finished after a managed shell becomes read-only", async () => {
  const events = new EventEmitter();
  const publishedEvents: ServerEvent[] = [];
  const startedAt = new Date(Date.now() - 5_000).toISOString();
  const completedAt = new Date(Date.now() - 1_000).toISOString();
  let detail = createAgentSessionDetail("resume", [
    lifecycleEntry("start-1", startedAt, "Turn started")
  ]);
  let managedSessionStatus: "running" | "read_only" = "running";
  const application = {
    events: Object.assign(events, {
      publishServerEvent: (event: ServerEvent) => {
        publishedEvents.push(event);
        events.emit("event", event);
      }
    }),
    managedSessions: {
      listSessions: () => [
        {
          adapterId: "codex",
          id: "managed-1",
          sourceSessionId: "source-1",
          status: managedSessionStatus
        }
      ]
    },
    sourceAgentSessions: {
      getSessionDetail: async () => detail,
      listRecentSessions: async () => [summaryFromDetail(detail)],
      reconcileAttachedSession: <T extends AgentSessionDetail | AgentSessionSummary>(session: T) =>
        session,
      syncReplyStateFromAgentSession: () => {}
    }
  } as unknown as DaemonApplication;
  const sync = createRealtimeSync(application);

  await sync();
  managedSessionStatus = "read_only";
  detail = createAgentSessionDetail("resume", [
    lifecycleEntry("start-1", startedAt, "Turn started"),
    lifecycleEntry("done-1", completedAt, "Turn completed")
  ]);
  await sync();

  assert.deepEqual(
    publishedEvents.filter((event) => event.type === "agent.session.turn.finished"),
    [
      {
        type: "agent.session.turn.finished",
        payload: {
          agentId: "codex",
          agentLabel: "Codex",
          agentSessionId: "codex:source-1",
          answer: null,
          completedAt,
          durationMs: null,
          managedSessionId: "managed-1",
          sourceSessionId: "source-1",
          startedAt,
          status: "completed",
          title: "Check Access tab e2e",
          workspaceName: "ExampleWorkspace",
          workspacePath: "C:\\projects\\ExampleWorkspace"
        }
      }
    ]
  );
});

test("agent session realtime sync publishes managed turn finished when active state was missed", async () => {
  const events = new EventEmitter();
  const publishedEvents: ServerEvent[] = [];
  const startedAt = new Date(Date.now() - 5_000).toISOString();
  const completedAt = new Date(Date.now() - 1_000).toISOString();
  let detail = createAgentSessionDetail("resume", [
    lifecycleEntry("previous-done", startedAt, "Turn completed")
  ]);
  const application = {
    events: Object.assign(events, {
      publishServerEvent: (event: ServerEvent) => {
        publishedEvents.push(event);
        events.emit("event", event);
      }
    }),
    managedSessions: {
      listSessions: () => [
        {
          adapterId: "codex",
          sourceSessionId: "source-1",
          status: "running"
        }
      ]
    },
    sourceAgentSessions: {
      getSessionDetail: async () => detail,
      listRecentSessions: async () => [summaryFromDetail(detail)],
      reconcileAttachedSession: <T extends AgentSessionDetail | AgentSessionSummary>(session: T) =>
        session,
      syncReplyStateFromAgentSession: () => {}
    }
  } as unknown as DaemonApplication;
  const sync = createRealtimeSync(application);

  await sync();
  detail = createAgentSessionDetail("resume", [
    lifecycleEntry("previous-done", startedAt, "Turn completed"),
    textEntry("assistant-1", completedAt, "Done."),
    lifecycleEntry("done-1", completedAt, "Turn completed", "Completed in 2065s")
  ]);
  await sync();

  assert.deepEqual(
    publishedEvents.filter((event) => event.type === "agent.session.turn.finished"),
    [
      {
        type: "agent.session.turn.finished",
        payload: {
          agentId: "codex",
          agentLabel: "Codex",
          agentSessionId: "codex:source-1",
          answer: "Done.",
          completedAt,
          durationMs: 2_065_000,
          sourceSessionId: "source-1",
          startedAt: null,
          status: "completed",
          title: "Check Access tab e2e",
          workspaceName: "ExampleWorkspace",
          workspacePath: "C:\\projects\\ExampleWorkspace"
        }
      }
    ]
  );
});

test("agent session realtime sync suppresses source turn notification for terminal managed attached sessions", async () => {
  const events = new EventEmitter();
  const publishedEvents: ServerEvent[] = [];
  const startedAt = new Date(Date.now() - 5_000).toISOString();
  const completedAt = new Date(Date.now() - 1_000).toISOString();
  let detail = createAgentSessionDetail("resume", [
    lifecycleEntry("start-1", startedAt, "Turn started")
  ]);
  let managedSessionStatus: "running" | "done" = "running";
  const application = {
    events: Object.assign(events, {
      publishServerEvent: (event: ServerEvent) => {
        publishedEvents.push(event);
        events.emit("event", event);
      }
    }),
    managedSessions: {
      listSessions: () => [
        {
          adapterId: "codex",
          sourceSessionId: "source-1",
          status: managedSessionStatus
        }
      ]
    },
    sourceAgentSessions: {
      getSessionDetail: async () => detail,
      listRecentSessions: async () => [summaryFromDetail(detail)],
      reconcileAttachedSession: <T extends AgentSessionDetail | AgentSessionSummary>(session: T) =>
        session,
      syncReplyStateFromAgentSession: () => {}
    }
  } as unknown as DaemonApplication;
  const sync = createRealtimeSync(application);

  await sync();
  managedSessionStatus = "done";
  detail = createAgentSessionDetail("resume", [
    lifecycleEntry("start-1", startedAt, "Turn started"),
    lifecycleEntry("done-1", completedAt, "Turn completed")
  ]);
  await sync();

  assert.deepEqual(
    publishedEvents.filter((event) => event.type === "agent.session.turn.finished"),
    []
  );
});

test("agent session realtime sync primes recent source sessions without live metadata", async () => {
  const events = new EventEmitter();
  const publishedEvents: ServerEvent[] = [];
  const detail = createAgentSessionDetail("read_only", [
    lifecycleEntry("start-1", new Date(Date.now() - 5_000).toISOString(), "Turn started")
  ]);
  const listCalls: Array<{ includeLiveMetadata?: boolean; limit: number }> = [];
  let detailReads = 0;
  const application = {
    events: Object.assign(events, {
      publishServerEvent: (event: ServerEvent) => {
        publishedEvents.push(event);
        events.emit("event", event);
      }
    }),
    managedSessions: {
      listSessions: () => []
    },
    sourceAgentSessions: {
      getSessionDetail: async () => {
        detailReads += 1;
        return detail;
      },
      listRecentSessions: async (limit: number, includeLiveMetadata?: boolean) => {
        listCalls.push({
          includeLiveMetadata,
          limit
        });
        return [summaryFromDetail(detail)];
      },
      reconcileAttachedSession: <T extends AgentSessionDetail | AgentSessionSummary>(session: T) =>
        session,
      syncReplyStateFromAgentSession: () => {}
    }
  } as unknown as DaemonApplication;
  const sync = createRealtimeSync(application);

  await sync({
    publishSummaries: true,
    syncManagedSessions: false,
    trackExternalTurns: true
  });

  assert.deepEqual(listCalls, [
    {
      includeLiveMetadata: false,
      limit: 50
    }
  ]);
  assert.equal(detailReads, 1);
  assert.deepEqual(
    publishedEvents.filter((event) => event.type === "agent.session.updated"),
    [
      {
        type: "agent.session.updated",
        payload: summaryFromDetail(detail)
      }
    ]
  );
});

test("agent session realtime sync reuses changed source detail for managed sessions", async () => {
  const events = new EventEmitter();
  const detail = createAgentSessionDetail("read_only", [
    lifecycleEntry("start-1", new Date(Date.now() - 5_000).toISOString(), "Turn started")
  ]);
  let detailReads = 0;
  let replySyncs = 0;
  const application = {
    events: Object.assign(events, {
      publishServerEvent: () => {
      }
    }),
    managedSessions: {
      listSessions: () => [
        {
          adapterId: "codex",
          sourceSessionId: "source-1",
          status: "running"
        }
      ]
    },
    sourceAgentSessions: {
      getSessionDetail: async () => {
        detailReads += 1;
        return detail;
      },
      listRecentSessions: async () => [summaryFromDetail(detail)],
      reconcileAttachedSession: <T extends AgentSessionDetail | AgentSessionSummary>(session: T) =>
        session,
      syncReplyStateFromAgentSession: () => {
        replySyncs += 1;
      }
    }
  } as unknown as DaemonApplication;
  const sync = createRealtimeSync(application);

  await sync({
    publishSummaries: true,
    syncManagedSessions: true,
    trackExternalTurns: true
  });

  assert.equal(detailReads, 1);
  assert.equal(replySyncs, 2);
});

test("agent session realtime sync skips initial idle source detail reads when the file is unavailable", async () => {
  const events = new EventEmitter();
  const publishedEvents: ServerEvent[] = [];
  const detail = createAgentSessionDetail("resume", []);
  const listCalls: Array<{ includeLiveMetadata?: boolean; limit: number }> = [];
  let detailReads = 0;
  const application = {
    events: Object.assign(events, {
      publishServerEvent: (event: ServerEvent) => {
        publishedEvents.push(event);
        events.emit("event", event);
      }
    }),
    managedSessions: {
      listSessions: () => []
    },
    sourceAgentSessions: {
      getSessionDetail: async () => {
        detailReads += 1;
        return detail;
      },
      listRecentSessions: async (limit: number, includeLiveMetadata?: boolean) => {
        listCalls.push({
          includeLiveMetadata,
          limit
        });
        return [summaryFromDetail(detail)];
      },
      reconcileAttachedSession: <T extends AgentSessionDetail | AgentSessionSummary>(session: T) =>
        session,
      syncReplyStateFromAgentSession: () => {}
    }
  } as unknown as DaemonApplication;
  const sync = createRealtimeSync(application);

  await sync({
    publishSummaries: true,
    sourceSessionLimit: 16,
    syncManagedSessions: false,
    trackExternalTurns: true
  });

  assert.deepEqual(listCalls, [
    {
      includeLiveMetadata: false,
      limit: 16
    }
  ]);
  assert.equal(detailReads, 0);
  assert.deepEqual(
    publishedEvents.filter((event) => event.type === "agent.session.updated"),
    [
      {
        type: "agent.session.updated",
        payload: summaryFromDetail(detail)
      }
    ]
  );
});

test("agent session realtime sync skips managed detail reads when disabled", async () => {
  const events = new EventEmitter();
  const detail = createAgentSessionDetail("resume", [
    lifecycleEntry("start-1", new Date(Date.now() - 5_000).toISOString(), "Turn started")
  ]);
  let detailReads = 0;
  let replySyncs = 0;
  const application = {
    events: Object.assign(events, {
      publishServerEvent: () => {
      }
    }),
    managedSessions: {
      listSessions: () => [
        {
          adapterId: "codex",
          sourceSessionId: "source-1",
          status: "running"
        }
      ]
    },
    sourceAgentSessions: {
      getSessionDetail: async () => {
        detailReads += 1;
        return detail;
      },
      listRecentSessions: async () => [],
      reconcileAttachedSession: <T extends AgentSessionDetail | AgentSessionSummary>(session: T) =>
        session,
      syncReplyStateFromAgentSession: () => {
        replySyncs += 1;
      }
    }
  } as unknown as DaemonApplication;
  const sync = createRealtimeSync(application);

  await sync({
    publishSummaries: false,
    syncManagedSessions: false,
    trackExternalTurns: true
  });

  assert.equal(detailReads, 0);
  assert.equal(replySyncs, 0);
});

test("agent session realtime sync syncs reply state from changed source detail", async () => {
  const events = new EventEmitter();
  const detail = createAgentSessionDetail("read_only", [
    lifecycleEntry("start-1", new Date(Date.now() - 5_000).toISOString(), "Turn started")
  ]);
  let replySyncs = 0;
  const application = {
    events: Object.assign(events, {
      publishServerEvent: () => {
      }
    }),
    managedSessions: {
      listSessions: () => []
    },
    sourceAgentSessions: {
      getSessionDetail: async () => detail,
      listRecentSessions: async () => [summaryFromDetail(detail)],
      reconcileAttachedSession: <T extends AgentSessionDetail | AgentSessionSummary>(session: T) =>
        session,
      syncReplyStateFromAgentSession: () => {
        replySyncs += 1;
      }
    }
  } as unknown as DaemonApplication;
  const sync = createRealtimeSync(application);

  await sync({
    publishSummaries: false,
    syncManagedSessions: false,
    trackExternalTurns: true
  });

  assert.equal(replySyncs, 1);
});

test("agent session realtime sync gradually primes unseen source details within the configured budget", async () => {
  const events = new EventEmitter();
  const directory = await mkdtemp(join(tmpdir(), "deskcue-realtime-sync-"));
  const filePath = join(directory, "source.jsonl");

  await writeFile(filePath, "{}\n");
  const details = Array.from({ length: 4 }, (_, index) => ({
    ...createAgentSessionDetail("resume", []),
    filePath,
    id: `codex:source-${index + 1}`,
    sourceSessionId: `source-${index + 1}`
  }));
  let detailReads = 0;
  const application = {
    events: Object.assign(events, {
      publishServerEvent: () => {}
    }),
    managedSessions: {
      listSessions: () => []
    },
    sourceAgentSessions: {
      getSessionDetail: async (sessionId: string) => {
        detailReads += 1;
        return details.find((detail) => detail.id === sessionId) ?? null;
      },
      listRecentSessions: async () => details.map(summaryFromDetail),
      reconcileAttachedSession: <T extends AgentSessionDetail | AgentSessionSummary>(session: T) =>
        session,
      syncReplyStateFromAgentSession: () => {}
    }
  } as unknown as DaemonApplication;
  const sync = createRealtimeSync(application);

  try {
    await sync({
      initialSourceDetailLimit: 2,
      publishSummaries: false,
      sourceSessionLimit: 4,
      syncManagedSessions: false,
      trackExternalTurns: true
    });

    assert.equal(detailReads, 2);

    await sync({
      initialSourceDetailLimit: 2,
      publishSummaries: false,
      sourceSessionLimit: 4,
      syncManagedSessions: false,
      trackExternalTurns: true
    });

    assert.equal(detailReads, 4);
  } finally {
    await rm(directory, {
      force: true,
      recursive: true
    });
  }
});
