import assert from "node:assert/strict";
import test from "node:test";

import { terminateOwnedProcessTree } from "./ownedProcessTree.ts";
import type { ProcessTreeTerminationRuntime } from "./ownedProcessTree.ts";

function terminationOptions(runtime?: ProcessTreeTerminationRuntime) {
  return {
    processDidNotExitMessage: () => "process did not exit",
    processGroupDidNotTerminateMessage: () => "process group did not terminate",
    runtime,
    terminateGraceMs: 5,
    timeoutMs: 20
  };
}

test("owned process-tree termination bounds a child without a usable pid", async () => {
  let killed = false;
  await assert.rejects(
    terminateOwnedProcessTree({
      child: { kill: () => (killed = true) },
      exited: new Promise<void>(() => {}),
      hasExited: () => false,
      pid: null
    }, {
      ...terminationOptions(),
      timeoutMs: 5
    }),
    /process did not exit/
  );
  assert.equal(killed, true);
});

function fakeRuntime(
  overrides: Partial<ProcessTreeTerminationRuntime> = {}
): ProcessTreeTerminationRuntime {
  return {
    isProcessGroupAlive: () => false,
    now: Date.now,
    platform: "linux",
    signalProcessGroup: () => {},
    terminateWindowsProcessTree: async () => {},
    wait: async () => {},
    ...overrides
  };
}

test("owned process-tree termination escalates a Unix process group", async () => {
  const signals: NodeJS.Signals[] = [];
  let alive = true;
  let exited = false;
  let now = 0;
  let resolveExited!: () => void;
  const exitedPromise = new Promise<void>((resolve) => {
    resolveExited = resolve;
  });
  const runtime = fakeRuntime({
    isProcessGroupAlive: () => alive,
    now: () => now,
    signalProcessGroup: (_pid, signal) => {
      signals.push(signal);
      if (signal === "SIGKILL") {
        alive = false;
        exited = true;
        resolveExited();
      }
    },
    wait: async (durationMs) => {
      now += durationMs;
    }
  });

  await terminateOwnedProcessTree({
    child: { kill: () => true },
    exited: exitedPromise,
    hasExited: () => exited,
    pid: 42
  }, terminationOptions(runtime));

  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("owned process-tree termination ignores a benign taskkill exit race", async () => {
  let exited = false;
  let resolveExited!: () => void;
  const exitedPromise = new Promise<void>((resolve) => {
    resolveExited = resolve;
  });
  const runtime = fakeRuntime({
    platform: "win32",
    terminateWindowsProcessTree: async () => {
      exited = true;
      resolveExited();
      throw new Error("process already exited");
    }
  });

  await terminateOwnedProcessTree({
    child: { kill: () => true },
    exited: exitedPromise,
    hasExited: () => exited,
    pid: 42
  }, terminationOptions(runtime));
});
