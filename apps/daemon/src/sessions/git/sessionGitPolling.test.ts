import assert from "node:assert/strict";
import test from "node:test";

import type { GitSnapshot, SessionDetail } from "@deskcue/protocol";

import { SessionGitPolling } from "./sessionGitPolling.ts";

function gitSnapshot(): GitSnapshot {
  return {
    branch: "main",
    changedFiles: [],
    diff: "",
    isDirty: false,
    isGitRepo: true,
    lastUpdatedAt: "2026-08-06T00:00:00.000Z"
  };
}

function runningSession(id: string): SessionDetail {
  return {
    id,
    workspaceId: "workspace-1",
    command: "codex",
    adapterId: "generic-cli",
    sourceSessionId: null,
    status: "running",
    startedAt: "2026-08-06T00:00:00.000Z",
    finishedAt: null,
    lastActivityAt: "2026-08-06T00:00:00.000Z",
    exitCode: null,
    logs: [],
    inputHistory: [],
    git: gitSnapshot(),
    preview: {
      active: false,
      networkMode: "device-direct",
      port: null,
      targetUrl: null
    },
    replyState: { phase: "idle", promptText: null, requestedAt: null },
    actionRequest: null,
    workspaceName: "Workspace"
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for managed Git polling.");
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test("managed Git polling deduplicates concurrent sessions for one workspace", async () => {
  const read = createDeferred<GitSnapshot>();
  const snapshots: string[] = [];
  let readCount = 0;
  const polling = new SessionGitPolling({
    buildSnapshot: async () => {
      readCount += 1;
      return read.promise;
    },
    getSession: (sessionId) => runningSession(sessionId),
    onGitSnapshot: (sessionId) => snapshots.push(sessionId)
  });

  polling.start("session-1", "D:\\workspace");
  polling.start("session-2", "D:\\workspace");
  await waitFor(() => readCount === 1);

  read.resolve(gitSnapshot());
  await waitFor(() => snapshots.length === 2);
  await polling.close();

  assert.equal(readCount, 1);
  assert.deepEqual(snapshots.sort(), ["session-1", "session-2"]);
});

test("managed Git polling close rejects queued workspace reads and drains the active read", async () => {
  const activeRead = createDeferred<GitSnapshot>();
  const startedPaths: string[] = [];
  let closeFinished = false;
  const polling = new SessionGitPolling({
    buildSnapshot: async (workspacePath) => {
      startedPaths.push(workspacePath);
      return activeRead.promise;
    },
    concurrency: 1,
    getSession: (sessionId) => runningSession(sessionId),
    onGitSnapshot: () => undefined,
    queueCapacity: 1
  });

  polling.start("session-1", "D:\\workspace-1");
  polling.start("session-2", "D:\\workspace-2");
  await waitFor(() => startedPaths.length === 1);

  const close = polling.close().then(() => { closeFinished = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(closeFinished, false);
  assert.deepEqual(startedPaths, ["D:\\workspace-1"]);

  activeRead.resolve(gitSnapshot());
  await close;
  assert.equal(closeFinished, true);
  assert.deepEqual(startedPaths, ["D:\\workspace-1"]);
});
