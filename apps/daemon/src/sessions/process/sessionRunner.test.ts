import assert from "node:assert/strict";
import test from "node:test";

import type { SessionDetail } from "@deskcue/protocol";

import { attachSessionExitHandler } from "./sessionLifecycle.ts";
import type { RunningChild } from "./sessionProcess.ts";
import { SessionRunner } from "./sessionRunner.ts";

type FakeChild = RunningChild & {
  emitExit(exitCode?: number | null): void;
};

function fakeChild({ exitDelayMs }: { exitDelayMs: number | null }): FakeChild {
  const exitHandlers = new Set<(event: { exitCode: number | null }) => void>();
  const child: FakeChild = {
    emitExit(exitCode = 0) {
      for (const handler of exitHandlers) {
        handler({ exitCode });
      }
    },
    kill() {
      if (exitDelayMs === null) return;

      setTimeout(() => {
        child.emitExit(0);
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

  return child;
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

test("restart termination releases ownership before the old child exits", async () => {
  const child = fakeChild({ exitDelayMs: 0 });
  const runner = new SessionRunner({ createPipe: () => child });

  runner.spawnProcess({
    command: "agent",
    cwd: "C:\\workspace",
    env: {},
    sessionId: "session-restart",
    spawnSpec: { args: [], file: "agent.exe", transport: "pipe" }
  });
  let finalized = false;

  attachSessionExitHandler({
    child,
    getSession: () => ({
      adapterId: "codex",
      command: "codex exec resume source-session continue",
      sourceSessionId: "source-session",
      status: "running"
    }) as SessionDetail,
    isCurrentChild: (sessionId, candidate) => runner.isCurrentChild(sessionId, candidate),
    onAppendSystemLog: () => undefined,
    onFinishSession: () => {
      finalized = true;
    },
    sessionId: "session-restart"
  });

  await runner.killChildForRestart("session-restart", child, 100);

  assert.equal(finalized, false);
  assert.equal(runner.hasChild("session-restart"), false);
});

test("restart termination restores current ownership when the old child does not exit", async () => {
  const child = fakeChild({ exitDelayMs: null });
  const runner = new SessionRunner({ createPipe: () => child });

  runner.spawnProcess({
    command: "agent",
    cwd: "C:\\workspace",
    env: {},
    sessionId: "session-stuck-restart",
    spawnSpec: { args: [], file: "agent.exe", transport: "pipe" }
  });

  await assert.rejects(
    runner.killChildForRestart("session-stuck-restart", child, 5),
    /did not exit/
  );

  assert.equal(runner.isCurrentChild("session-stuck-restart", child), true);
  assert.equal(runner.hasChild("session-stuck-restart"), true);
  const shutdownResult = await runner.close({ timeoutMs: 5 });

  assert.equal(shutdownResult.survivors.length, 1);

  assert.equal(shutdownResult.survivors[0]?.sessionId, "session-stuck-restart");
});

test("restart does not retain a child whose exit was already observed", async () => {
  const child = fakeChild({ exitDelayMs: null });
  const runner = new SessionRunner({ createPipe: () => child });

  runner.spawnProcess({
    command: "agent",
    cwd: "C:\\workspace",
    env: {},
    sessionId: "session-exited-restart",
    spawnSpec: { args: [], file: "agent.exe", transport: "pipe" }
  });

  child.emitExit(0);

  await runner.killChildForRestart("session-exited-restart", child, 5);

  assert.equal(runner.hasChild("session-exited-restart"), false);
  assert.deepEqual(await runner.close({ timeoutMs: 5 }), {
    confirmedExitSessionIds: [],
    preservedSessionIds: [],
    survivors: []
  });
});

test("restart keeps a failed old child tracked after registering its replacement", async () => {
  const oldChild = fakeChild({ exitDelayMs: null });
  const replacement = fakeChild({ exitDelayMs: 0 });
  let oldKillCount = 0;
  const originalOldKill = oldChild.kill.bind(oldChild);

  oldChild.kill = (signal) => {
    oldKillCount += 1;
    originalOldKill(signal);
  };

  const children = [oldChild, replacement];
  const runner = new SessionRunner({
    createPipe: () => children.shift()!
  });

  runner.spawnProcess({
    command: "agent",
    cwd: "C:\\workspace",
    env: {},
    sessionId: "session-racing-restart",
    spawnSpec: { args: [], file: "agent.exe", transport: "pipe" }
  });

  const termination = runner.killChildForRestart("session-racing-restart", oldChild, 5);

  runner.spawnProcess({
    command: "replacement",
    cwd: "C:\\workspace",
    env: {},
    sessionId: "session-racing-restart",
    spawnSpec: { args: [], file: "agent.exe", transport: "pipe" }
  });

  await assert.rejects(termination, /did not exit/);

  assert.equal(runner.isCurrentChild("session-racing-restart", oldChild), false);
  assert.equal(runner.isCurrentChild("session-racing-restart", replacement), true);
  const shutdownResult = await runner.close({ timeoutMs: 20 });

  assert.ok(oldKillCount >= 2);

  assert.equal(
    shutdownResult.survivors.some(({ sessionId }) => sessionId === "session-racing-restart"),
    true
  );
});

test("close preserves a replacement but still terminates its retired predecessor", async () => {
  const oldChild = fakeChild({ exitDelayMs: null });
  const replacement = fakeChild({ exitDelayMs: null });

  replacement.surviveParentExit = true;
  let detachedReplacement = 0;
  let oldKillCount = 0;

  replacement.detachFromDeskCue = () => {
    detachedReplacement += 1;
  };

  const originalOldKill = oldChild.kill.bind(oldChild);

  oldChild.kill = (signal) => {
    oldKillCount += 1;
    originalOldKill(signal);
  };

  const children = [oldChild, replacement];
  const runner = new SessionRunner({
    createPipe: () => children.shift()!
  });

  runner.spawnProcess({
    command: "agent",
    cwd: "C:\\workspace",
    env: {},
    sessionId: "session-preserved-replacement",
    spawnSpec: { args: [], file: "agent.exe", transport: "pipe" }
  });
  const termination = runner.killChildForRestart(
    "session-preserved-replacement",
    oldChild,
    5
  );

  runner.spawnProcess({
    command: "replacement",
    cwd: "C:\\workspace",
    env: {},
    sessionId: "session-preserved-replacement",
    spawnSpec: { args: [], file: "agent.exe", transport: "pipe" }
  });

  await assert.rejects(termination, /did not exit/);

  const shutdownResult = await runner.close({
    preserve: () => true,
    timeoutMs: 5
  });

  assert.equal(detachedReplacement, 1);
  assert.ok(oldKillCount >= 2);
  assert.deepEqual(shutdownResult.preservedSessionIds, ["session-preserved-replacement"]);
  assert.equal(shutdownResult.survivors.length, 1);
  assert.equal(shutdownResult.survivors[0]?.sessionId, "session-preserved-replacement");
});

test("close never reports a preserved replacement as confirmed exited", async () => {
  const oldChild = fakeChild({ exitDelayMs: null });
  const replacement = fakeChild({ exitDelayMs: null });

  replacement.surviveParentExit = true;
  const children = [oldChild, replacement];
  const runner = new SessionRunner({ createPipe: () => children.shift()! });

  runner.spawnProcess({
    command: "agent",
    cwd: "C:\\workspace",
    env: {},
    sessionId: "session-preserved-with-retired",
    spawnSpec: { args: [], file: "agent.exe", transport: "pipe" }
  });
  const termination = runner.killChildForRestart(
    "session-preserved-with-retired",
    oldChild,
    5
  );

  runner.spawnProcess({
    command: "replacement",
    cwd: "C:\\workspace",
    env: {},
    sessionId: "session-preserved-with-retired",
    spawnSpec: { args: [], file: "agent.exe", transport: "pipe" }
  });

  await assert.rejects(termination, /did not exit/);
  oldChild.kill = () => oldChild.emitExit(0);

  const result = await runner.close({ preserve: () => true, timeoutMs: 100 });

  assert.deepEqual(result.preservedSessionIds, ["session-preserved-with-retired"]);
  assert.deepEqual(result.confirmedExitSessionIds, []);
  assert.deepEqual(result.survivors, []);
});

test("close rejects a process spawned after shutdown begins", async () => {
  const child = fakeChild({ exitDelayMs: null });
  const runner = new SessionRunner({ createPipe: () => child });

  runner.spawnProcess({
    command: "agent",
    cwd: "C:\\workspace",
    env: {},
    sessionId: "session-closing",
    spawnSpec: { args: [], file: "agent.exe", transport: "pipe" }
  });

  const closing = runner.close({ timeoutMs: 5 });

  assert.throws(() => runner.spawnProcess({
    command: "late-agent",
    cwd: "C:\\workspace",
    env: {},
    sessionId: "late-session",
    spawnSpec: { args: [], file: "agent.exe", transport: "pipe" }
  }), /runner is closing/);
  await closing;
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
