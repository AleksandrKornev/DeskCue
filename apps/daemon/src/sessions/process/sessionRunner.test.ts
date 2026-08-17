import assert from "node:assert/strict";
import test from "node:test";

import type { SessionDetail } from "@deskcue/protocol";

import { attachSessionExitHandler } from "./sessionLifecycle.ts";
import type { RunningChild } from "./sessionProcess.ts";
import { SessionRunner } from "./sessionRunner.ts";

function fakeChild({ exitDelayMs }: { exitDelayMs: number | null }): RunningChild {
  const exitHandlers = new Set<(event: { exitCode: number | null }) => void>();
  return {
    kill() {
      if (exitDelayMs === null) {
        return;
      }
      setTimeout(() => {
        for (const handler of exitHandlers) {
          handler({ exitCode: 0 });
        }
      }, exitDelayMs);
    },
    onData() {
      return { dispose() {} };
    },
    onExit(handler) {
      exitHandlers.add(handler);
      return {
        dispose: () => exitHandlers.delete(handler)
      };
    },
    // A missing pid exercises the supervisor's direct-child fallback without
    // asking the host OS to terminate an unrelated process group in this unit test.
    pid: -1,
    transport: "pipe",
    write() {}
  };
}

test("close waits for a delayed child exit before returning", async () => {
  const child = fakeChild({ exitDelayMs: 20 });
  const runner = new SessionRunner({
    createPipe: () => child
  });
  let sessionStatus: "running" | "done" = "running";
  runner.spawnProcess({
    command: "agent",
    cwd: "C:\\workspace",
    env: {},
    sessionId: "session-1",
    spawnSpec: {
      args: [],
      file: "agent.exe",
      transport: "pipe"
    }
  }).onExit(() => {
    sessionStatus = "done";
  });

  const shutdownResult = await runner.close({ timeoutMs: 100 });
  const statusCapturedByFinalPersistence = sessionStatus;

  assert.equal(statusCapturedByFinalPersistence, "done");
  assert.deepEqual(shutdownResult, {
    confirmedExitSessionIds: ["session-1"],
    preservedSessionIds: [],
    survivors: []
  });
});

test("close detaches a preserved pipe child without killing it", async () => {
  const child = fakeChild({ exitDelayMs: null });
  child.surviveParentExit = true;
  let detached = 0;
  let killed = 0;
  child.detachFromDeskCue = () => {
    detached += 1;
  };
  child.kill = () => {
    killed += 1;
  };
  const runner = new SessionRunner({ createPipe: () => child });
  runner.spawnProcess({
    command: "agent",
    cwd: "C:\\workspace",
    env: {},
    sessionId: "source-prompt",
    spawnSpec: { args: [], file: "agent.exe", transport: "pipe" }
  });

  const result = await runner.close({
    preserve: (sessionId) => sessionId === "source-prompt"
  });

  assert.equal(killed, 0);
  assert.equal(detached, 1);
  assert.equal(runner.hasChild("source-prompt"), false);
  assert.deepEqual(result, {
    confirmedExitSessionIds: [],
    preservedSessionIds: ["source-prompt"],
    survivors: []
  });
});

test("close still kills an ordinary pipe child even when the caller asks to preserve it", async () => {
  const child = fakeChild({ exitDelayMs: 0 });
  const originalKill = child.kill.bind(child);
  let killed = 0;
  child.kill = () => {
    killed += 1;
    originalKill();
  };
  const runner = new SessionRunner({ createPipe: () => child });
  runner.spawnProcess({
    command: "agent",
    cwd: "C:\\workspace",
    env: {},
    sessionId: "ordinary-pipe",
    spawnSpec: { args: [], file: "agent.exe", transport: "pipe" }
  });

  const result = await runner.close({ preserve: () => true, timeoutMs: 100 });

  assert.equal(killed, 1);
  assert.deepEqual(result.preservedSessionIds, []);
  assert.deepEqual(result.confirmedExitSessionIds, ["ordinary-pipe"]);
});

test("close returns sessions that did not confirm exit before the deadline", async () => {
  const child = fakeChild({ exitDelayMs: null });
  const runner = new SessionRunner({
    createPipe: () => child
  });
  runner.spawnProcess({
    command: "agent",
    cwd: "C:\\workspace",
    env: {},
    sessionId: "session-stuck",
    spawnSpec: {
      args: [],
      file: "agent.exe",
      transport: "pipe"
    }
  });

  const shutdownResult = await runner.close({ timeoutMs: 5 });

  assert.deepEqual(shutdownResult.confirmedExitSessionIds, []);
  assert.equal(shutdownResult.survivors.length, 1);
  assert.equal(shutdownResult.survivors[0]?.sessionId, "session-stuck");
  assert.equal(shutdownResult.survivors[0]?.pid, null);
  assert.match(shutdownResult.survivors[0]?.error ?? "", /did not exit/);
});

test("killChild rejects and retains ownership when process exit is unconfirmed", async () => {
  const child = fakeChild({ exitDelayMs: null });
  const runner = new SessionRunner({ createPipe: () => child });
  runner.spawnProcess({
    command: "agent",
    cwd: "C:\\workspace",
    env: {},
    sessionId: "session-stuck",
    spawnSpec: { args: [], file: "agent.exe", transport: "pipe" }
  });

  await assert.rejects(
    runner.killChild("session-stuck", child, "test", 5),
    /did not exit/
  );
  assert.equal(runner.hasChild("session-stuck"), true);
  assert.equal(runner.deleteChild("session-stuck"), false);
  assert.equal(runner.hasChild("session-stuck"), true);
});

test("keeps child identity until the lifecycle exit handler finalizes the session", async () => {
  const child = fakeChild({ exitDelayMs: 0 });
  const runner = new SessionRunner({ createPipe: () => child });
  runner.spawnProcess({
    command: "agent",
    cwd: "C:\\workspace",
    env: {},
    sessionId: "session-natural-exit",
    spawnSpec: { args: [], file: "agent.exe", transport: "pipe" }
  });
  let finished = false;
  attachSessionExitHandler({
    child,
    getSession: () => ({
      adapterId: "generic-cli",
      command: "agent",
      sourceSessionId: null,
      status: "running"
    }) as SessionDetail,
    isCurrentChild: (sessionId, candidate) => runner.isCurrentChild(sessionId, candidate),
    onAppendSystemLog: () => undefined,
    onFinishSession: (sessionId) => {
      finished = true;
      runner.deleteChild(sessionId);
    },
    sessionId: "session-natural-exit"
  });

  child.kill();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(finished, true);
  assert.equal(runner.hasChild("session-natural-exit"), false);
});

test("close cancels delayed session actions", async () => {
  const runner = new SessionRunner();
  let called = false;
  runner.scheduleDelayedAction("session-1", async () => {
    called = true;
  }, 5);

  await runner.close({ timeoutMs: 0 });
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(called, false);
});
