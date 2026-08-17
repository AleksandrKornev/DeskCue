import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ManualCommandCapacityError, ManualCommandRunner } from "./manualCommandRunner.ts";

class FakeManualCommandChild extends EventEmitter {
  pid = 4242;
  killCalled = false;

  kill() {
    this.killCalled = true;
    return true;
  }
}

async function createTempDirectory() {
  return mkdtemp(join(tmpdir(), "deskcue-manual-command-"));
}

async function removeTempDirectory(path: string) {
  await rm(path, {
    force: true,
    recursive: true
  });
}

function runManualCommand(
  command: string,
  cwd: string,
  options: ConstructorParameters<typeof ManualCommandRunner>[0] = {}
) {
  return new ManualCommandRunner(options).run(command, cwd);
}

test("reports a quick successful manual command as finished", async () => {
  const cwd = await createTempDirectory();
  const child = new FakeManualCommandChild();

  try {
    const resultPromise = runManualCommand("echo ok", cwd, {
      now: () => 100,
      spawnCommand: () => {
        queueMicrotask(() => child.emit("exit", 0, null));
        return child;
      },
      startGraceMs: 10
    });

    const result = await resultPromise;

    assert.equal(result.status, "finished");
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.equal(result.pid, 4242);
    assert.equal(result.stderr, "");
  } finally {
    await removeTempDirectory(cwd);
  }
});

test("reports spawn errors as finished failures", async () => {
  const cwd = await createTempDirectory();
  const child = new FakeManualCommandChild();

  try {
    const resultPromise = runManualCommand("missing-command", cwd, {
      now: () => 100,
      spawnCommand: () => {
        queueMicrotask(() => child.emit("error", new Error("spawn failed")));
        return child;
      },
      startGraceMs: 10
    });

    const result = await resultPromise;

    assert.equal(result.status, "finished");
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, null);
    assert.equal(result.pid, 4242);
    assert.equal(result.stderr, "spawn failed");
  } finally {
    await removeTempDirectory(cwd);
  }
});

test("returns started for a long-running manual command after the grace window", async () => {
  const cwd = await createTempDirectory();
  const child = new FakeManualCommandChild();

  try {
    const result = await runManualCommand("long-running", cwd, {
      now: () => 100,
      spawnCommand: () => child,
      startGraceMs: 1
    });

    assert.equal(result.status, "started");
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, null);
    assert.equal(result.pid, 4242);
    assert.equal(child.killCalled, false);
  } finally {
    await removeTempDirectory(cwd);
  }
});

test("close terminates a long-running command owned by the runner", async () => {
  const cwd = await createTempDirectory();
  const child = new FakeManualCommandChild();
  let terminatedPid: number | null = null;
  let terminationFinished = false;
  const runner = new ManualCommandRunner({
    spawnCommand: () => child,
    startGraceMs: 1,
    terminateProcessTree: async (command) => {
      terminatedPid = command.pid;
      queueMicrotask(() => child.emit("exit", null, "SIGTERM"));
      await command.exited;
      terminationFinished = true;
    }
  });

  try {
    const result = await runner.run("long-running", cwd);
    assert.equal(result.status, "started");

    await runner.close();

    assert.equal(terminatedPid, 4242);
    assert.equal(terminationFinished, true);
    await assert.rejects(runner.run("after-close", cwd), /closed/);
  } finally {
    await runner.close();
    await removeTempDirectory(cwd);
  }
});

test("close is idempotent and shares one bounded drain", async () => {
  const cwd = await createTempDirectory();
  const child = new FakeManualCommandChild();
  let terminationCalls = 0;
  const runner = new ManualCommandRunner({
    spawnCommand: () => child,
    startGraceMs: 1,
    terminateProcessTree: async (command) => {
      terminationCalls += 1;
      queueMicrotask(() => child.emit("exit", null, "SIGTERM"));
      await command.exited;
    }
  });

  try {
    await runner.run("long-running", cwd);

    const firstClose = runner.close();
    const secondClose = runner.close();

    assert.equal(firstClose, secondClose);
    await firstClose;
    assert.equal(terminationCalls, 1);
  } finally {
    await runner.close();
    await removeTempDirectory(cwd);
  }
});

test("close rejects after its bounded drain deadline", async () => {
  const cwd = await createTempDirectory();
  const child = new FakeManualCommandChild();
  const runner = new ManualCommandRunner({
    closeTimeoutMs: 5,
    spawnCommand: () => child,
    startGraceMs: 1,
    terminateProcessTree: () => new Promise(() => {})
  });

  try {
    await runner.run("long-running", cwd);

    await assert.rejects(runner.close(), (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.errors[0]?.message ?? "", /Timed out/);
      return true;
    });
  } finally {
    child.emit("exit", null, "SIGKILL");
    await removeTempDirectory(cwd);
  }
});

test("close prevents a command from spawning after delayed working-directory validation", async () => {
  let resolveValidation!: (error: string | null) => void;
  let spawned = false;
  const validation = new Promise<string | null>((resolve) => {
    resolveValidation = resolve;
  });
  const runner = new ManualCommandRunner({
    spawnCommand: () => {
      spawned = true;
      return new FakeManualCommandChild();
    },
    validateWorkingDirectory: () => validation
  });

  const runPromise = runner.run("late-command", "D:\\work");
  const runRejection = assert.rejects(runPromise, /closed/);

  await runner.close();
  resolveValidation(null);

  await runRejection;
  assert.equal(spawned, false);
});

test("rejects commands above the active admission limit and releases capacity on exit", async () => {
  const cwd = await createTempDirectory();
  const firstChild = new FakeManualCommandChild();
  const secondChild = new FakeManualCommandChild();
  const children = [firstChild, secondChild];
  const runner = new ManualCommandRunner({
    maxActiveCommands: 1,
    spawnCommand: () => children.shift() ?? secondChild,
    startGraceMs: 1
  });

  try {
    const first = await runner.run("first", cwd);
    assert.equal(first.status, "started");
    await assert.rejects(
      runner.run("overflow", cwd),
      (error: unknown) => error instanceof ManualCommandCapacityError
    );

    firstChild.emit("exit", 0, null);
    const second = await runner.run("second", cwd);
    assert.equal(second.status, "started");
    secondChild.emit("exit", 0, null);
  } finally {
    await runner.close();
    await removeTempDirectory(cwd);
  }
});

test("rejects missing manual command working directories before spawning", async () => {
  let spawned = false;

  const result = await runManualCommand("echo ok", join(tmpdir(), "deskcue-missing-cwd"), {
    spawnCommand: () => {
      spawned = true;
      return new FakeManualCommandChild();
    }
  });

  assert.equal(spawned, false);
  assert.equal(result.status, "finished");
  assert.equal(result.ok, false);
  assert.match(result.stderr, /Working directory is not available/);
});

test("rejects file paths as manual command working directories", async () => {
  const cwd = await createTempDirectory();
  const filePath = join(cwd, "not-a-directory.txt");

  try {
    await writeFile(filePath, "not a directory", "utf8");

    const result = await runManualCommand("echo ok", filePath);

    assert.equal(result.status, "finished");
    assert.equal(result.ok, false);
    assert.match(result.stderr, /Working directory is not a directory/);
  } finally {
    await removeTempDirectory(cwd);
  }
});
