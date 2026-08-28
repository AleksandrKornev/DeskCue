import assert from "node:assert/strict";
import test from "node:test";

import type { SessionDetail } from "@deskcue/protocol";
import { emptyPreview } from "#sessions/model/sessionDefaults";
import { SessionRepository } from "#sessions/state/sessionRepository";

import { StoreBackedSessionOperations } from "./storeBackedSessionOperations.ts";

function sessionDetail(): SessionDetail {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    adapterId: "codex",
    sourceSessionId: "source-1",
    command: "codex resume source-1",
    status: "read_only",
    startedAt: "2026-08-05T09:00:00.000Z",
    finishedAt: "2026-08-05T09:30:00.000Z",
    lastActivityAt: "2026-08-05T09:30:00.000Z",
    exitCode: null,
    preview: emptyPreview(),
    replyState: {
      phase: "queued",
      promptText: "Continue",
      requestedAt: "2026-08-05T10:00:00.000Z"
    },
    git: {
      branch: "main",
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: true,
      lastUpdatedAt: "2026-08-05T09:00:00.000Z"
    },
    logs: [],
    inputHistory: []
  };
}

test("cancelling a queued prompt schedules its log before durable persistence", async () => {
  const repository = new SessionRepository();

  repository.setSession(sessionDetail());
  const lifecycle: string[] = [];
  const operations = new StoreBackedSessionOperations({
    eventBus: {
      publishServerEvent: () => {}
    } as never,
    gitPolling: {} as never,
    persistence: {
      materializeSession: (sessionId: string) => repository.getSession(sessionId),
      persistNow: async () => {
        lifecycle.push("persist-now");
      },
      schedulePersist: () => {
        lifecycle.push("schedule-persist");
      }
    } as never,
    repository,
    sessionRunner: {
      hasChild: () => false
    } as never,
    sourceTurnInterrupts: {} as never
  });

  const result = await operations.interruptSession("session-1");

  assert.equal(result.replyState.phase, "idle");
  assert.equal(result.logs.at(-1)?.text, "Queued input cancelled.\n");
  assert.deepEqual(lifecycle, ["schedule-persist", "persist-now"]);
});

test("cancelling a queued prompt surfaces durable persistence failure", async () => {
  const repository = new SessionRepository();

  repository.setSession(sessionDetail());
  const persistenceError = new Error("sqlite unavailable");
  const operations = new StoreBackedSessionOperations({
    eventBus: {
      publishServerEvent: () => {}
    } as never,
    gitPolling: {} as never,
    persistence: {
      materializeSession: (sessionId: string) => repository.getSession(sessionId),
      persistNow: async () => {
        throw persistenceError;
      },
      schedulePersist: () => {}
    } as never,
    repository,
    sessionRunner: {
      hasChild: () => false
    } as never,
    sourceTurnInterrupts: {} as never
  });

  await assert.rejects(
    operations.interruptSession("session-1"),
    persistenceError
  );
});
