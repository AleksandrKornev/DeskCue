import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SqlitePromptDeliveryJournalStore } from "./promptDeliveryJournalStore.ts";

function recoveryShape(record: ReturnType<SqlitePromptDeliveryJournalStore["recoverActiveAfterRestart"]>[number]) {
  return {
    phase: record.phase,
    previousPhase: record.previousPhase,
    recoveryDisposition: record.recoveryDisposition,
    sessionId: record.sessionId
  };
}

function bySessionId(left: ReturnType<typeof recoveryShape>, right: ReturnType<typeof recoveryShape>) {
  return left.sessionId.localeCompare(right.sessionId);
}

function session(id: string) {
  return {
    adapterId: "codex",
    id,
    sourceSessionId: `source-${id}`
  };
}

async function withJournal(run: (databasePath: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-prompt-journal-"));

  try {
    await run(join(directory, "state.sqlite"));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

test("prepared prompt is durably classified as definitely not sent after restart", async () => {
  await withJournal(async (databasePath) => {
    const first = new SqlitePromptDeliveryJournalStore(databasePath);

    first.prepare(session("session-prepared"), "Continue the task");

    first.close();

    const second = new SqlitePromptDeliveryJournalStore(databasePath);
    const recovered = second.recoverActiveAfterRestart();

    assert.deepEqual(recovered.map(recoveryShape), [{
      phase: "not_sent",
      previousPhase: "prepared",
      recoveryDisposition: "definitely_not_sent",
      sessionId: "session-prepared"
    }]);

    assert.deepEqual(second.recoverActiveAfterRestart().map(recoveryShape), [{
      phase: "not_sent",
      previousPhase: "not_sent",
      recoveryDisposition: "definitely_not_sent",
      sessionId: "session-prepared"
    }]);
    second.close();
  });
});

test("dispatching and accepted prompts become outcome unknown after restart", async () => {
  await withJournal(async (databasePath) => {
    const first = new SqlitePromptDeliveryJournalStore(databasePath);
    const dispatchingId = first.prepare(session("session-dispatching"), "Dispatch me");
    const acceptedId = first.prepare(session("session-accepted"), "Accept me");

    assert.equal(first.markDispatching(dispatchingId), true);

    assert.equal(first.markDispatching(acceptedId), true);
    assert.equal(first.markAccepted(acceptedId), true);
    first.close();

    const second = new SqlitePromptDeliveryJournalStore(databasePath);

    assert.deepEqual(second.recoverActiveAfterRestart().map(recoveryShape).sort(bySessionId), [
      {
        phase: "outcome_unknown",
        previousPhase: "accepted",
        recoveryDisposition: "outcome_unknown",
        sessionId: "session-accepted"
      },
      {
        phase: "outcome_unknown",
        previousPhase: "dispatching",
        recoveryDisposition: "outcome_unknown",
        sessionId: "session-dispatching"
      }
    ]);

    assert.deepEqual(second.recoverActiveAfterRestart().map(recoveryShape).sort(bySessionId), [
      {
        phase: "outcome_unknown",
        previousPhase: "outcome_unknown",
        recoveryDisposition: "outcome_unknown",
        sessionId: "session-accepted"
      },
      {
        phase: "outcome_unknown",
        previousPhase: "outcome_unknown",
        recoveryDisposition: "outcome_unknown",
        sessionId: "session-dispatching"
      }
    ]);
    second.close();
  });
});

test("active-writer conflict remains definitely not sent after restart", async () => {
  await withJournal(async (databasePath) => {
    const first = new SqlitePromptDeliveryJournalStore(databasePath);
    const deliveryId = first.prepare(session("session-active-writer"), "Continue safely");

    assert.equal(first.markDispatching(deliveryId), true);
    assert.equal(first.markAccepted(deliveryId), true);
    assert.equal(first.markNotSentAfterActiveWriterConflict("session-active-writer"), true);
    first.close();

    const second = new SqlitePromptDeliveryJournalStore(databasePath);

    assert.deepEqual(second.recoverActiveAfterRestart().map(recoveryShape), [{
      phase: "not_sent",
      previousPhase: "not_sent",
      recoveryDisposition: "definitely_not_sent",
      sessionId: "session-active-writer"
    }]);
    second.close();
  });
});

test("session transitions preserve prepared, dispatching, accepted ordering", async () => {
  await withJournal(async (databasePath) => {
    const store = new SqlitePromptDeliveryJournalStore(databasePath);

    store.prepare(session("session-ordered"), "Continue");

    assert.equal(store.markAcceptedBySession("session-ordered"), false);
    assert.equal(store.markDispatchingBySession("session-ordered"), true);
    assert.equal(store.markDispatchingBySession("session-ordered"), false);
    assert.equal(store.markAcceptedBySession("session-ordered"), true);
    assert.equal(store.markAcceptedBySession("session-ordered"), false);

    assert.equal(
      store.recoverActiveAfterRestart()[0]?.previousPhase,
      "accepted"
    );

    store.close();
  });
});

test("terminal prompt journal entries are not recovered after restart", async () => {
  await withJournal(async (databasePath) => {
    const store = new SqlitePromptDeliveryJournalStore(databasePath);

    store.prepare(session("session-completed"), "Continue");

    store.markDispatchingBySession("session-completed");
    store.markAcceptedBySession("session-completed");
    store.markCompleted("session-completed");
    assert.deepEqual(store.recoverActiveAfterRestart(), []);
    store.close();
  });
});

test("transcript observation terminally resolves outcome-unknown recovery", async () => {
  await withJournal(async (databasePath) => {
    const store = new SqlitePromptDeliveryJournalStore(databasePath);
    const deliveryId = store.prepare(session("session-observed"), "Continue");

    store.markDispatchingBySession("session-observed");

    store.markAcceptedBySession("session-observed");
    store.recoverActiveAfterRestart();

    assert.equal(store.markAcceptedBySession("session-observed"), false);
    assert.equal(store.markObservedBySession("session-observed"), true);
    assert.deepEqual(store.recoverActiveAfterRestart(), []);
    store.markCompleted("session-observed");
    assert.deepEqual(store.recoverActiveAfterRestart(), []);
    store.close();

    const database = new Database(databasePath, { readonly: true });
    const row = database.prepare(
      "SELECT phase FROM prompt_delivery_journal WHERE id = ?"
    ).get(deliveryId) as { phase: string };

    database.close();
    assert.equal(row.phase, "observed");
  });
});

test("observing a retry supersedes an older definitely-not-sent attempt", async () => {
  await withJournal(async (databasePath) => {
    const store = new SqlitePromptDeliveryJournalStore(databasePath);

    store.prepare(session("session-observed"), "First attempt");

    store.recoverActiveAfterRestart();

    store.prepare(session("session-observed"), "Replacement attempt");
    store.markDispatchingBySession("session-observed");
    store.markAcceptedBySession("session-observed");
    store.recoverActiveAfterRestart();

    assert.equal(store.markObservedBySession("session-observed"), true);
    assert.deepEqual(store.recoverActiveAfterRestart(), []);
    store.close();
  });
});

test("successful explicit retry resolves an older not-sent recovery record", async () => {
  await withJournal(async (databasePath) => {
    const store = new SqlitePromptDeliveryJournalStore(databasePath);

    store.prepare(session("session-retry"), "First attempt");

    store.recoverActiveAfterRestart();

    store.prepare(session("session-retry"), "Explicit retry");
    store.markDispatchingBySession("session-retry");
    store.markAcceptedBySession("session-retry");
    store.markCompleted("session-retry");

    assert.deepEqual(store.recoverActiveAfterRestart(), []);
    store.close();
  });
});

test("shutdown preserves accepted work as outcome unknown and queued work as not sent", async () => {
  await withJournal(async (databasePath) => {
    const store = new SqlitePromptDeliveryJournalStore(databasePath);

    store.prepare(session("session-queued"), "Queued");

    store.prepare(session("session-dispatching"), "Dispatching");
    store.markDispatchingBySession("session-dispatching");
    store.prepare(session("session-accepted"), "Accepted");
    store.markDispatchingBySession("session-accepted");
    store.markAcceptedBySession("session-accepted");

    assert.equal(store.markActiveOutcomeUnknownForShutdown(), 2);
    assert.deepEqual(
      store.recoverActiveAfterRestart().map(recoveryShape).sort(bySessionId),
      [
        {
          phase: "outcome_unknown",
          previousPhase: "outcome_unknown",
          recoveryDisposition: "outcome_unknown",
          sessionId: "session-accepted"
        },
        {
          phase: "outcome_unknown",
          previousPhase: "outcome_unknown",
          recoveryDisposition: "outcome_unknown",
          sessionId: "session-dispatching"
        },
        {
          phase: "not_sent",
          previousPhase: "prepared",
          recoveryDisposition: "definitely_not_sent",
          sessionId: "session-queued"
        }
      ]
    );

    store.close();
  });
});
