import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AgentSessionDetail, SessionDetail, WorkspaceSummary } from "@deskcue/protocol";
import type { DaemonEventBus } from "#application/ports";
import { SqliteDatabaseContext } from "#persistence/connection/sqliteConnection";
import { SqliteAgentSessionReviewStore } from "#persistence/journals/agentSessionReviewStore";
import { SqlitePromptDeliveryJournalStore } from "#persistence/journals/promptDeliveryJournalStore";
import { DeskCueSqliteStateStorage } from "#persistence/state/sqliteStateStorage";
import { emptyPreview, emptyReplyState } from "#sessions/model/sessionDefaults";
import type { RunningChild } from "#sessions/process/sessionProcess";
import { SessionRunner } from "#sessions/process/sessionRunner";

import { StoreBackedSessionBackend } from "./storeBackedSessionBackend.ts";

test("backend drains borrowed SQLite stores before the shared context closes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-shared-backend-sqlite-"));
  const context = new SqliteDatabaseContext(join(directory, "state.sqlite"));
  const eventBus: DaemonEventBus = {
    on() {},
    publishServerEvent() {}
  };

  try {
    const backend = await StoreBackedSessionBackend.create(eventBus, context);

    await backend.close();

    assert.equal(context.database.open, true);
    const reviews = new SqliteAgentSessionReviewStore(context);

    reviews.markReviewed("session-after-backend-close");

    assert.ok(reviews.readReviewedAt("session-after-backend-close"));
    reviews.close();
    assert.equal(context.database.open, true);
  } finally {
    context.close();
    context.close();
    assert.equal(context.database.open, false);
    await rm(directory, { force: true, recursive: true });
  }
});

async function recoveryFixture(adapterId: "claude-code" | "codex" | "generic-cli") {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-prompt-recovery-"));
  const context = new SqliteDatabaseContext(join(directory, "state.sqlite"));
  const workspace: WorkspaceSummary = {
    id: "workspace-1",
    name: "Workspace",
    path: directory,
    isGitRepo: false,
    branch: null,
    createdAt: "2026-08-11T09:00:00.000Z"
  };

  const session: SessionDetail = {
    id: "session-1",
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    adapterId,
    sourceSessionId: "source-1",
    command: `${adapterId} resume source-1`,
    status: "running",
    startedAt: "2026-08-11T09:30:00.000Z",
    finishedAt: null,
    lastActivityAt: "2026-08-11T10:00:00.000Z",
    exitCode: null,
    preview: emptyPreview(),
    replyState: {
      phase: "sending",
      promptText: "May still be running",
      requestedAt: "2026-08-11T10:00:00.000Z"
    },
    actionRequest: null,
    git: {
      branch: null,
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: false,
      lastUpdatedAt: "2026-08-11T10:00:00.000Z"
    },
    logs: [],
    inputHistory: ["May still be running"]
  };

  const storage = new DeskCueSqliteStateStorage(context);

  await storage.save({ version: 1, workspaces: [workspace], sessions: [session] });

  storage.close();
  const eventBus: DaemonEventBus = {
    on() {},
    publishServerEvent() {}
  };

  return { context, directory, eventBus, session, workspace };
}

test("restart exposes a prepared prompt as definitely not sent without auto retry", async () => {
  const fixture = await recoveryFixture("codex");

  try {
    const journal = new SqlitePromptDeliveryJournalStore(fixture.context);

    journal.prepare(fixture.session, "Definitely not sent");

    journal.close();

    const backend = await StoreBackedSessionBackend.create(fixture.eventBus, fixture.context);
    const recovered = backend.getSession(fixture.session.id);

    assert.deepEqual(recovered?.promptRecovery, {
      phase: "not_sent",
      promptText: "Definitely not sent",
      requestedAt: recovered?.promptRecovery?.requestedAt,
      retryable: true
    });

    assert.deepEqual(recovered?.replyState, emptyReplyState());
    assert.match(recovered?.logs.at(-1)?.text ?? "", /was not sent/i);
    await backend.close();
  } finally {
    fixture.context.close();
    await rm(fixture.directory, { force: true, recursive: true });
  }
});

test("restart terminally resolves prompt journals without a durable session", async () => {
  const fixture = await recoveryFixture("codex");

  try {
    const journal = new SqlitePromptDeliveryJournalStore(fixture.context);

    journal.prepare({
      ...fixture.session,
      id: "orphan-session"
    }, "Prompt whose session was not persisted");
    journal.close();

    const backend = await StoreBackedSessionBackend.create(fixture.eventBus, fixture.context);

    assert.equal(backend.getSession("orphan-session"), null);

    await backend.close();

    const phase = fixture.context.database.prepare(`
      SELECT phase
      FROM prompt_delivery_journal
      WHERE session_id = ?
    `).get("orphan-session") as { phase: string } | undefined;

    assert.equal(phase?.phase, "interrupted");
    const recovered = new SqlitePromptDeliveryJournalStore(fixture.context);

    assert.deepEqual(recovered.recoverActiveAfterRestart(), []);

    recovered.close();
  } finally {
    fixture.context.close();
    await rm(fixture.directory, { force: true, recursive: true });
  }
});

test("restart keeps an ambiguous source prompt recoverable across repeated restarts", async () => {
  const fixture = await recoveryFixture("claude-code");

  try {
    const journal = new SqlitePromptDeliveryJournalStore(fixture.context);
    const deliveryId = journal.prepare(fixture.session, "May still be running");

    assert.equal(journal.markDispatching(deliveryId), true);

    assert.equal(journal.markAccepted(deliveryId), true);
    journal.close();

    const first = await StoreBackedSessionBackend.create(fixture.eventBus, fixture.context);
    const firstRecoveryLogCount = first.getSession(fixture.session.id)?.logs.filter(
      (log) => log.text.includes("prompt delivery")
    ).length;

    assert.deepEqual(first.getSession(fixture.session.id)?.promptRecovery, {
      phase: "outcome_unknown",
      promptText: "May still be running",
      requestedAt: first.getSession(fixture.session.id)?.promptRecovery?.requestedAt,
      retryable: false
    });

    await first.close();

    const second = await StoreBackedSessionBackend.create(fixture.eventBus, fixture.context);

    assert.equal(second.getSession(fixture.session.id)?.promptRecovery?.phase, "outcome_unknown");

    assert.equal(second.getSession(fixture.session.id)?.promptRecovery?.retryable, false);
    assert.ok(firstRecoveryLogCount && firstRecoveryLogCount > 0);
    assert.equal(second.getSession(fixture.session.id)?.logs.filter(
      (log) => log.text.includes("prompt delivery")
    ).length, firstRecoveryLogCount);
    await second.close();
  } finally {
    fixture.context.close();
    await rm(fixture.directory, { force: true, recursive: true });
  }
});

test("restart clears a stale session recovery after the journal observed the prompt", async () => {
  const fixture = await recoveryFixture("codex");

  try {
    const requestedAt = "2026-08-11T10:00:00.000Z";
    const storage = new DeskCueSqliteStateStorage(fixture.context);

    await storage.save({
      version: 1,
      workspaces: [fixture.workspace],
      sessions: [{
        ...fixture.session,
        promptRecovery: {
          phase: "outcome_unknown",
          promptText: "Observed prompt",
          requestedAt,
          retryable: false
        }
      }]
    });

    storage.close();
    const journal = new SqlitePromptDeliveryJournalStore(fixture.context);
    const deliveryId = journal.prepare(fixture.session, "Observed prompt");

    assert.equal(journal.markDispatching(deliveryId), true);

    assert.equal(journal.markAccepted(deliveryId), true);
    assert.equal(journal.markOutcomeUnknown(deliveryId), true);
    assert.equal(journal.markObservedBySession(fixture.session.id), true);
    journal.close();

    const backend = await StoreBackedSessionBackend.create(fixture.eventBus, fixture.context);

    assert.equal(backend.getSession(fixture.session.id)?.promptRecovery, null);

    await backend.close();
  } finally {
    fixture.context.close();
    await rm(fixture.directory, { force: true, recursive: true });
  }
});

function sourceDetail(transcript: AgentSessionDetail["transcript"]): AgentSessionDetail {
  return {
    id: "codex:source-1",
    agentId: "codex",
    agentLabel: "Codex",
    sourceSessionId: "source-1",
    title: "Recovery",
    workspacePath: "C:/workspace",
    workspaceName: "Workspace",
    updatedAt: "2026-08-11T10:00:01.000Z",
    model: null,
    originator: null,
    cliVersion: null,
    source: null,
    filePath: "session.jsonl",
    attachMode: "resume",
    attachModeReason: null,
    workState: "running",
    transcript
  };
}

test("unfinished source prompt remains recoverable across repeated restarts", async () => {
  const fixture = await recoveryFixture("codex");

  try {
    const deliveryRequestedAt = "2026-08-11T10:00:00.000Z";
    const observedPromptAt = "2026-08-11T10:00:01.000Z";
    const storage = new DeskCueSqliteStateStorage(fixture.context);

    await storage.save({
      version: 1,
      workspaces: [fixture.workspace],
      sessions: [{
        ...fixture.session,
        replyState: {
          deliveryRequestedAt,
          phase: "waiting",
          promptText: "Observed active prompt",
          requestedAt: observedPromptAt,
          sourcePromptObserved: true
        }
      }]
    });

    storage.close();
    const journal = new SqlitePromptDeliveryJournalStore(fixture.context);
    const deliveryId = journal.prepare(
      fixture.session,
      "Observed active prompt",
      deliveryRequestedAt
    );

    journal.markDispatching(deliveryId);

    journal.markAccepted(deliveryId);
    journal.close();

    const first = await StoreBackedSessionBackend.create(fixture.eventBus, fixture.context);
    const recovery = first.getSession(fixture.session.id)?.promptRecovery;

    assert.equal(recovery?.observedPromptAt, observedPromptAt);
    const reconciled = first.syncReplyStateFromAgentSession(sourceDetail([
      {
        id: "observed-user",
        timestamp: observedPromptAt,
        role: "user",
        text: "Observed active prompt",
        phase: null
      }
    ]));

    assert.equal(reconciled?.promptRecovery?.phase, "outcome_unknown");
    assert.equal(reconciled?.replyState.phase, "idle");
    await first.close();

    const persistedStorage = new DeskCueSqliteStateStorage(fixture.context);
    const persistedState = await persistedStorage.load();

    assert.equal(
      persistedState.sessions.find((session) => session.id === fixture.session.id)
        ?.promptRecovery?.phase,
      "outcome_unknown"
    );

    persistedStorage.close();

    const second = await StoreBackedSessionBackend.create(fixture.eventBus, fixture.context);

    assert.equal(second.getSession(fixture.session.id)?.promptRecovery?.phase, "outcome_unknown");
    assert.equal(
      second.getSession(fixture.session.id)?.promptRecovery?.observedPromptAt,
      observedPromptAt
    );

    assert.equal(second.getSession(fixture.session.id)?.promptRecovery?.retryable, false);
    await second.close();
  } finally {
    fixture.context.close();
    await rm(fixture.directory, { force: true, recursive: true });
  }
});

test("does not associate an older waiting prompt with a newer identical delivery", async () => {
  const fixture = await recoveryFixture("codex");

  try {
    const oldObservedAt = "2026-08-11T10:00:01.000Z";
    const storage = new DeskCueSqliteStateStorage(fixture.context);

    await storage.save({
      version: 1,
      workspaces: [fixture.workspace],
      sessions: [{
        ...fixture.session,
        promptRecovery: {
          observedPromptAt: oldObservedAt,
          phase: "checking",
          promptText: "Repeat",
          requestedAt: "2026-08-11T10:00:00.000Z",
          retryable: false
        },
        replyState: {
          deliveryRequestedAt: "2026-08-11T10:00:00.000Z",
          phase: "waiting",
          promptText: "Repeat",
          requestedAt: oldObservedAt,
          sourcePromptObserved: true
        }
      }]
    });

    storage.close();

    const journal = new SqlitePromptDeliveryJournalStore(fixture.context);
    const deliveryId = journal.prepare(
      fixture.session,
      "Repeat",
      "2026-08-11T10:10:00.000Z"
    );

    journal.markDispatching(deliveryId);
    journal.markAccepted(deliveryId);
    journal.close();

    const backend = await StoreBackedSessionBackend.create(fixture.eventBus, fixture.context);
    const recovered = backend.getSession(fixture.session.id)?.promptRecovery;

    assert.equal(recovered?.phase, "outcome_unknown");
    assert.equal(recovered?.observedPromptAt, undefined);

    const reconciled = backend.syncReplyStateFromAgentSession(sourceDetail([
      {
        id: "old-user",
        timestamp: oldObservedAt,
        role: "user",
        text: "Repeat",
        phase: null
      },
      {
        id: "old-terminal",
        timestamp: "2026-08-11T10:00:02.000Z",
        role: "system",
        text: "Turn completed",
        phase: null
      }
    ]));

    assert.equal(reconciled?.promptRecovery?.phase, "outcome_unknown");
    await backend.close();
  } finally {
    fixture.context.close();
    await rm(fixture.directory, { force: true, recursive: true });
  }
});

test("restart reports a daemon-owned ambiguous transport as lost instead of background work", async () => {
  const fixture = await recoveryFixture("generic-cli");

  try {
    const journal = new SqlitePromptDeliveryJournalStore(fixture.context);
    const deliveryId = journal.prepare(fixture.session, "Owned transport prompt");

    journal.markDispatching(deliveryId);

    journal.close();

    const backend = await StoreBackedSessionBackend.create(fixture.eventBus, fixture.context);
    const recovered = backend.getSession(fixture.session.id);

    assert.equal(recovered?.status, "stopped");

    assert.equal(recovered?.promptRecovery?.phase, "outcome_unknown");
    assert.match(recovered?.logs.at(-1)?.text ?? "", /cannot continue after restart/i);
    await backend.close();
  } finally {
    fixture.context.close();
    await rm(fixture.directory, { force: true, recursive: true });
  }
});

function inertPipeChild({
  onDetach,
  onKill
}: {
  onDetach: () => void;
  onKill: () => void;
}): RunningChild {
  return {
    detachFromDeskCue: onDetach,
    kill: onKill,
    onData: () => ({ dispose() {} }),
    onExit: () => ({ dispose() {} }),
    pid: -1,
    surviveParentExit: true,
    transport: "pipe",
    write() {}
  };
}

test("graceful close preserves a source pipe transport and recovers it on next hydrate", async () => {
  const fixture = await recoveryFixture("codex");

  try {
    let detached = 0;
    let killed = 0;
    const child = inertPipeChild({
      onDetach: () => {
        detached += 1;
      },
      onKill: () => {
        killed += 1;
      }
    });
    const runner = new SessionRunner({ createPipe: () => child });
    const journal = new SqlitePromptDeliveryJournalStore(fixture.context);
    const deliveryId = journal.prepare(fixture.session, "Continue in background");

    journal.markDispatching(deliveryId);

    journal.markAccepted(deliveryId);
    journal.close();

    const first = await StoreBackedSessionBackend.create(
      fixture.eventBus,
      fixture.context,
      runner
    );

    runner.spawnProcess({
      command: "codex exec resume source-1",
      cwd: fixture.directory,
      env: {},
      sessionId: fixture.session.id,
      spawnSpec: { args: [], file: "codex", transport: "pipe" }
    });

    await first.close();

    assert.equal(killed, 0);
    assert.equal(detached, 1);

    const second = await StoreBackedSessionBackend.create(fixture.eventBus, fixture.context);

    assert.equal(second.getSession(fixture.session.id)?.promptRecovery?.phase, "outcome_unknown");
    assert.equal(second.getSession(fixture.session.id)?.promptRecovery?.retryable, false);

    await second.close();
  } finally {
    fixture.context.close();
    await rm(fixture.directory, { force: true, recursive: true });
  }
});
