import assert from "node:assert/strict";
import test from "node:test";

import {
  createExternalProcessForceStopControl,
  matchesExternalProcessTarget,
  requestExternalProcessForceStop
} from "./externalProcessControl.ts";
import type { ExternalProcessIdentity } from "./externalProcessIdentity.ts";
import type { ExternalProcessInventory } from "./externalProcessInventory.ts";

const PROCESS: ExternalProcessIdentity = {
  processId: 42,
  parentProcessId: null,
  createdAt: "2026-08-12T08:00:00.000Z",
  executablePath: "c:\\tools\\agent.exe",
  parentChain: [],
  argv: ["--resume", "session"]
};

const INVENTORY: ExternalProcessInventory = {
  async listProcesses() {
    return [];
  }
};

const PROCESS_CONTROL = createExternalProcessForceStopControl<"missing">({
  inventory: INVENTORY,
  async resolve() {
    return { kind: "resolved", process: PROCESS };
  },
  async validate(_sourceSessionId, process) {
    return process;
  }
});

test("matches a confirmed process only by PID and creation time", () => {
  assert.equal(matchesExternalProcessTarget(PROCESS, {
    processId: 42,
    processCreatedAt: PROCESS.createdAt
  }), true);
  assert.equal(matchesExternalProcessTarget(PROCESS, {
    processId: 42,
    processCreatedAt: "2026-08-12T08:00:01.000Z"
  }), false);
});

test("builds a typed force-stop capability from a provider process strategy", async (context) => {
  if (process.platform !== "win32") {
    context.skip("External process force stop is Windows-only.");
    return;
  }

  assert.deepEqual(await PROCESS_CONTROL.getCapability("source-1"), {
    kind: "available",
    processId: PROCESS.processId,
    processCreatedAt: PROCESS.createdAt
  });
});

test("revalidates the resolved identity before invoking the process terminator", async () => {
  const stopped: number[] = [];
  const result = await requestExternalProcessForceStop({
    expectedProcess: {
      processId: PROCESS.processId,
      processCreatedAt: PROCESS.createdAt
    },
    inventory: INVENTORY,
    async resolve() {
      return { kind: "resolved", process: PROCESS };
    },
    async validate(process) {
      return process;
    },
    async terminateProcessTree(processId) {
      stopped.push(processId);
    }
  });

  assert.deepEqual(result, { kind: "stop_requested", processId: 42 });
  assert.deepEqual(stopped, [42]);
});

test("does not terminate an unavailable, changed, or invalidated process", async () => {
  let stopCount = 0;
  const terminateProcessTree = async () => {
    stopCount += 1;
  };

  const unavailable = await requestExternalProcessForceStop({
    inventory: INVENTORY,
    async resolve() {
      return { kind: "unavailable", reason: "missing" };
    },
    async validate() {
      return PROCESS;
    },
    terminateProcessTree
  });
  const changed = await requestExternalProcessForceStop({
    expectedProcess: {
      processId: PROCESS.processId,
      processCreatedAt: "2026-08-12T08:00:01.000Z"
    },
    inventory: INVENTORY,
    async resolve() {
      return { kind: "resolved", process: PROCESS };
    },
    async validate() {
      return PROCESS;
    },
    terminateProcessTree
  });
  const invalidated = await requestExternalProcessForceStop({
    inventory: INVENTORY,
    async resolve() {
      return { kind: "resolved", process: PROCESS };
    },
    async validate() {
      return null;
    },
    terminateProcessTree
  });

  assert.deepEqual(unavailable, { kind: "control_unavailable", reason: "missing" });
  assert.deepEqual(changed, { kind: "process_identity_changed" });
  assert.deepEqual(invalidated, { kind: "process_identity_changed" });
  assert.equal(stopCount, 0);
});

test("returns a bounded failure result when the terminator rejects", async () => {
  const result = await requestExternalProcessForceStop({
    inventory: INVENTORY,
    async resolve() {
      return { kind: "resolved", process: PROCESS };
    },
    async validate(process) {
      return process;
    },
    async terminateProcessTree() {
      throw new Error("test failure");
    }
  });

  assert.deepEqual(result, { kind: "stop_failed", processId: 42 });
});
