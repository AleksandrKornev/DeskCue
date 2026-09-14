import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import test from "node:test";

import { DaemonSupervisor } from "./daemonSupervisor.ts";

class FakeChild extends EventEmitter {
  connected = true;
  readonly killedWith: Array<NodeJS.Signals | number | undefined> = [];
  pid: number | undefined;
  readonly sent: unknown[] = [];

  constructor(private readonly exitOnKill = true) {
    super();
  }

  kill(signal?: NodeJS.Signals | number) {
    this.killedWith.push(signal);
    this.connected = false;
    if (this.exitOnKill) this.emit("exit", null, signal ?? "SIGTERM");
    return true;
  }

  send(message: unknown) {
    this.sent.push(message);
    return true;
  }

  exit(code = 0) {
    this.connected = false;
    this.emit("exit", code, null);
  }

  fail(error: Error) {
    this.connected = false;
    this.emit("error", error);
  }

  signal(signal: NodeJS.Signals) {
    this.connected = false;
    this.emit("exit", null, signal);
  }

  stopped() {
    this.emit("message", { type: "stopped" });
  }

  ready(pid: number) {
    this.pid = pid;
    this.emit("message", {
      baseUrl: "http://127.0.0.1:4100",
      pid,
      port: 4100,
      type: "ready",
      version: "0.1.1"
    });
  }

  startupFailed(message = "startup failed") {
    this.emit("message", { message, retryable: false, type: "startup-failed" });
  }
}

function asChildProcess(child: FakeChild) {
  return child as unknown as ChildProcess;
}

async function waitForRunning(supervisor: DaemonSupervisor) {
  while (supervisor.status.state !== "running") {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

test("daemon supervisor confirms readiness and performs an IPC-first graceful stop", async () => {
  const child = new FakeChild();
  const supervisor = new DaemonSupervisor({
    dataRootPath: "test-data",
    spawnChild: () => asChildProcess(child)
  });
  const starting = supervisor.start();

  child.ready(1234);
  await starting;
  assert.equal(supervisor.status.state, "running");
  assert.equal(supervisor.status.pid, 1234);

  const stopping = supervisor.stop();

  assert.deepEqual(child.sent.at(-1), { reason: "host-request", type: "shutdown" });

  child.stopped();
  child.exit();
  await stopping;

  assert.equal(supervisor.status.state, "stopped");
  assert.equal(supervisor.status.pid, null);
});

test("daemon supervisor coalesces concurrent starts on one child", async () => {
  const children: FakeChild[] = [];
  const supervisor = new DaemonSupervisor({
    dataRootPath: "test-data",
    spawnChild: () => {
      const child = new FakeChild();

      children.push(child);
      return asChildProcess(child);
    }
  });
  const firstStart = supervisor.start();
  const secondStart = supervisor.start();

  assert.equal(children.length, 1);
  children[0]!.ready(1235);
  await Promise.all([firstStart, secondStart]);

  assert.equal(supervisor.status.state, "running");
  const stopping = supervisor.stop();

  children[0]!.stopped();
  children[0]!.exit();
  await stopping;
});

test("daemon supervisor ignores late readiness after shutdown starts", async () => {
  const child = new FakeChild();
  const supervisor = new DaemonSupervisor({
    dataRootPath: "test-data",
    forceStopTimeoutMs: 5,
    spawnChild: () => asChildProcess(child),
    stopTimeoutMs: 5
  });
  const starting = supervisor.start();
  const stopping = supervisor.stop();

  child.ready(1236);
  child.stopped();
  child.exit();

  await assert.rejects(starting, /exited before readiness/u);
  await stopping;
  assert.equal(supervisor.status.state, "stopped");
});

test("daemon supervisor preserves stopping across a late startup failure", async () => {
  const child = new FakeChild();
  const supervisor = new DaemonSupervisor({
    dataRootPath: "test-data",
    forceStopTimeoutMs: 5,
    spawnChild: () => asChildProcess(child),
    stopTimeoutMs: 5
  });
  const starting = supervisor.start();
  const stopping = supervisor.stop();

  child.startupFailed("late startup failure");
  assert.equal(supervisor.status.state, "stopping");
  child.stopped();
  child.exit();

  await assert.rejects(starting, /late startup failure/u);
  await stopping;
  assert.equal(supervisor.status.state, "stopped");
});

test("daemon supervisor bounds startup-timeout termination and restarts only after exit", async () => {
  const children: FakeChild[] = [];
  const supervisor = new DaemonSupervisor({
    dataRootPath: "test-data",
    forceStopTimeoutMs: 5,
    restartDelaysMs: [1],
    spawnChild: () => {
      const child = new FakeChild(false);

      children.push(child);
      return asChildProcess(child);
    },
    stopTimeoutMs: 5,
    startTimeoutMs: 5
  });

  await assert.rejects(supervisor.start(), /startup timed out/u);
  const timedOutChild = children[0]!;

  assert.deepEqual(timedOutChild.sent.at(-1), { reason: "host-request", type: "shutdown" });
  assert.equal(supervisor.status.state, "stopping");

  timedOutChild.ready(1237);
  assert.equal(supervisor.status.state, "stopping");
  assert.equal(supervisor.status.pid, null);
  timedOutChild.startupFailed("late startup failure");
  assert.equal(supervisor.status.lastError, "DeskCue daemon startup timed out.");
  assert.equal(supervisor.status.state, "stopping");
  timedOutChild.fail(new Error("late child error"));
  assert.equal(supervisor.status.state, "stopping");
  assert.equal(supervisor.hasActiveChild, true);

  while (timedOutChild.killedWith.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }

  assert.deepEqual(timedOutChild.killedWith, ["SIGKILL"]);
  assert.equal(children.length, 1);
  assert.equal(supervisor.hasActiveChild, true);

  timedOutChild.signal("SIGKILL");
  while (children.length < 2) await new Promise((resolve) => setTimeout(resolve, 2));

  children[1]!.ready(1238);
  await waitForRunning(supervisor);

  const stopping = supervisor.stop();

  children[1]!.stopped();
  children[1]!.exit();
  await stopping;
});

test("daemon supervisor suppresses startup-timeout recovery after an explicit stop", async () => {
  const children: FakeChild[] = [];
  const supervisor = new DaemonSupervisor({
    dataRootPath: "test-data",
    forceStopTimeoutMs: 10,
    restartDelaysMs: [1],
    spawnChild: () => {
      const child = new FakeChild(false);

      children.push(child);
      return asChildProcess(child);
    },
    stopTimeoutMs: 5,
    startTimeoutMs: 5
  });

  await assert.rejects(supervisor.start(), /startup timed out/u);
  const timedOutChild = children[0]!;
  const stopping = supervisor.stop();

  while (timedOutChild.killedWith.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }

  timedOutChild.signal("SIGKILL");
  await assert.rejects(
    stopping,
    (error) => (error as { code?: string }).code === "daemon_stop_forced"
  );

  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(children.length, 1);
  assert.equal(supervisor.hasActiveChild, false);
});

test("daemon supervisor recovers when a timed-out spawn later reports a terminal error", async () => {
  const children: FakeChild[] = [];
  const supervisor = new DaemonSupervisor({
    dataRootPath: "test-data",
    restartDelaysMs: [1],
    spawnChild: () => {
      const child = new FakeChild(false);

      children.push(child);
      return asChildProcess(child);
    },
    startTimeoutMs: 5,
    stopTimeoutMs: 20
  });

  await assert.rejects(supervisor.start(), /startup timed out/u);
  children[0]!.fail(new Error("late spawn failure"));
  while (children.length < 2) await new Promise((resolve) => setTimeout(resolve, 2));

  assert.deepEqual(children[0]!.killedWith, []);
  children[1]!.ready(1239);
  await waitForRunning(supervisor);

  const stopping = supervisor.stop();

  children[1]!.stopped();
  children[1]!.exit();
  await stopping;
});

test("daemon supervisor correlates update readiness without exposing its release callback", async () => {
  const child = new FakeChild();
  const supervisor = new DaemonSupervisor({
    dataRootPath: "test-data",
    spawnChild: () => asChildProcess(child)
  });
  const starting = supervisor.start();

  child.ready(4321);
  await starting;
  const readiness = supervisor.prepareUpdate();
  const request = child.sent.at(-1) as { requestId: string; type: string };

  assert.equal(request.type, "prepare-update");
  child.emit("message", {
    backupPath: "backup.sqlite",
    blockers: [],
    ok: true,
    requestId: request.requestId,
    type: "update-readiness"
  });

  assert.deepEqual(await readiness, {
    backupPath: "backup.sqlite",
    blockers: [],
    ok: true
  });
  const stopping = supervisor.stop();

  child.stopped();
  child.exit();

  await stopping;
});

test("daemon supervisor rejects exits without both graceful acknowledgement and a clean code", async () => {
  for (const scenario of ["missing-ack", "nonzero", "signal"] as const) {
    const child = new FakeChild();
    const supervisor = new DaemonSupervisor({
      dataRootPath: "test-data",
      spawnChild: () => asChildProcess(child)
    });
    const starting = supervisor.start();

    child.ready(2345);
    await starting;
    const stopping = supervisor.stop();

    if (scenario !== "missing-ack") child.stopped();
    if (scenario === "signal") child.signal("SIGTERM");
    else child.exit(scenario === "nonzero" ? 1 : 0);

    await assert.rejects(
      stopping,
      (error) => (error as { code?: string }).code === "daemon_stop_unclean"
    );

    assert.equal(supervisor.status.state, "degraded");
  }
});

test("daemon supervisor reports a forced stop instead of presenting it as graceful", async () => {
  const child = new FakeChild();
  const supervisor = new DaemonSupervisor({
    dataRootPath: "test-data",
    forceStopTimeoutMs: 5,
    spawnChild: () => asChildProcess(child),
    stopTimeoutMs: 5
  });
  const starting = supervisor.start();

  child.ready(3456);
  await starting;

  await assert.rejects(
    supervisor.stop(),
    (error) => (error as { code?: string }).code === "daemon_stop_forced"
  );

  assert.deepEqual(child.killedWith, ["SIGKILL"]);
  assert.equal(supervisor.status.state, "degraded");
});

test("daemon supervisor can finish closing after a forced child exit arrives beyond the deadline", async () => {
  const child = new FakeChild(false);
  const supervisor = new DaemonSupervisor({
    dataRootPath: "test-data",
    forceStopTimeoutMs: 5,
    spawnChild: () => asChildProcess(child),
    stopTimeoutMs: 5
  });
  const starting = supervisor.start();

  child.ready(4567);
  await starting;

  await assert.rejects(
    supervisor.stop(),
    (error) => (error as { code?: string }).code === "daemon_stop_timeout"
  );

  assert.deepEqual(child.killedWith, ["SIGKILL"]);
  assert.equal(supervisor.status.pid, 4567);

  child.signal("SIGKILL");
  assert.equal(supervisor.status.pid, null);

  await supervisor.close();
  assert.equal(supervisor.status.state, "stopped");
});

test("daemon supervisor refuses a replacement while a timed-out child remains active", async () => {
  const children: FakeChild[] = [];
  const supervisor = new DaemonSupervisor({
    dataRootPath: "test-data",
    forceStopTimeoutMs: 5,
    spawnChild: () => {
      const child = new FakeChild(false);

      children.push(child);
      return asChildProcess(child);
    },
    stopTimeoutMs: 5
  });
  const starting = supervisor.start();

  children[0]!.ready(4568);
  await starting;
  await assert.rejects(
    supervisor.stop(),
    (error) => (error as { code?: string }).code === "daemon_stop_timeout"
  );

  await assert.rejects(supervisor.start(), /still active/u);
  assert.equal(children.length, 1);
  assert.equal(supervisor.status.pid, 4568);

  children[0]!.signal("SIGKILL");
  await supervisor.close();
});

test("daemon supervisor does not treat a child error as terminal process exit", async () => {
  const child = new FakeChild();
  const supervisor = new DaemonSupervisor({
    dataRootPath: "test-data",
    forceStopTimeoutMs: 5,
    spawnChild: () => asChildProcess(child),
    stopTimeoutMs: 5
  });
  const starting = supervisor.start();

  child.ready(4569);
  await starting;
  const stopping = supervisor.stop();

  child.fail(new Error("IPC send failed"));
  assert.equal(supervisor.status.state, "stopping");
  assert.equal(supervisor.status.pid, 4569);
  await assert.rejects(
    stopping,
    (error) => (error as { code?: string }).code === "daemon_stop_forced"
  );

  assert.deepEqual(child.killedWith, ["SIGKILL"]);
  await supervisor.close();
  assert.equal(supervisor.status.state, "stopped");
});

test("daemon supervisor preserves a forced attempt across a repeated stop", async () => {
  const child = new FakeChild(false);
  const supervisor = new DaemonSupervisor({
    dataRootPath: "test-data",
    forceStopTimeoutMs: 5,
    spawnChild: () => asChildProcess(child),
    stopTimeoutMs: 5
  });
  const starting = supervisor.start();

  child.ready(4570);
  await starting;
  await assert.rejects(
    supervisor.stop(),
    (error) => (error as { code?: string }).code === "daemon_stop_timeout"
  );

  const retry = supervisor.close();

  child.stopped();
  child.exit(0);
  await assert.rejects(
    retry,
    (error) => (error as { code?: string }).code === "daemon_stop_forced"
  );

  await supervisor.close();
  assert.equal(supervisor.status.state, "stopped");
});

test("daemon supervisor restarts after a timed-out update recovery child exits late", async () => {
  const children: FakeChild[] = [];
  const supervisor = new DaemonSupervisor({
    dataRootPath: "test-data",
    forceStopTimeoutMs: 5,
    restartDelaysMs: [1],
    spawnChild: () => {
      const child = new FakeChild(false);

      children.push(child);
      return asChildProcess(child);
    },
    stopTimeoutMs: 5
  });
  const starting = supervisor.start();

  children[0]!.ready(4571);
  await starting;
  await assert.rejects(
    supervisor.stopForUpdate(),
    (error) => (error as { code?: string }).code === "daemon_stop_timeout"
  );

  await assert.rejects(
    supervisor.stopForUpdate(),
    (error) => (error as { code?: string }).code === "daemon_stop_timeout"
  );

  await assert.rejects(supervisor.start(false), /still active/u);

  children[0]!.signal("SIGKILL");
  while (children.length < 2) await new Promise((resolve) => setTimeout(resolve, 2));

  children[1]!.ready(4572);
  await waitForRunning(supervisor);

  assert.equal(supervisor.status.pid, 4572);
  const stopping = supervisor.stop();

  children[1]!.stopped();
  children[1]!.exit();
  await stopping;
});

test("daemon supervisor does not restart after an unclean restart stop", async () => {
  const children: FakeChild[] = [];
  const supervisor = new DaemonSupervisor({
    dataRootPath: "test-data",
    spawnChild: () => {
      const child = new FakeChild();

      children.push(child);
      return asChildProcess(child);
    }
  });
  const starting = supervisor.start();

  children[0]!.ready(3678);
  await starting;
  const restarting = supervisor.restart();

  children[0]!.exit(0);
  await assert.rejects(
    restarting,
    (error) => (error as { code?: string }).code === "daemon_stop_unclean"
  );

  assert.equal(children.length, 1);
  assert.equal(supervisor.status.state, "degraded");
});

test("daemon supervisor recovers when child spawn emits error without exit", async () => {
  const children: FakeChild[] = [];
  const supervisor = new DaemonSupervisor({
    dataRootPath: "test-data",
    restartDelaysMs: [1],
    spawnChild: () => {
      const child = new FakeChild();

      children.push(child);
      return asChildProcess(child);
    }
  });
  const starting = supervisor.start();

  children[0]!.fail(new Error("spawn failed"));
  await assert.rejects(starting, /spawn failed/u);

  while (children.length < 2) await new Promise((resolve) => setTimeout(resolve, 2));
  children[1]!.ready(4567);

  await waitForRunning(supervisor);

  assert.equal(supervisor.status.pid, 4567);
  const stopping = supervisor.stop();

  children[1]!.stopped();
  children[1]!.exit();
  await stopping;
});
