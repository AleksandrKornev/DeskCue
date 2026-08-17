import assert from "node:assert/strict";
import test from "node:test";

import type { ExternalProcessSnapshot } from "#infrastructure/process/externalProcessIdentity";
import type { ExternalProcessInventory } from "#infrastructure/process/externalProcessInventory";

import {
  getCodexExternalForceStopCapability,
  matchesCodexExternalProcessTarget,
  requestCodexExternalProcessForceStop
} from "./codexExternalProcessControl.ts";

const THREAD_ID = "019f956a-2a0e-72f2-97af-5b4c0c5638ab";

function processTree(): ExternalProcessSnapshot[] {
  return [
    {
      processId: 4,
      parentProcessId: null,
      createdAt: "2026-07-30T12:00:00.000Z",
      executablePath: "C:\\Windows\\System32\\services.exe",
      commandLine: "services.exe"
    },
    {
      processId: 300,
      parentProcessId: 4,
      createdAt: "2026-07-30T12:00:05.000Z",
      executablePath: "C:\\Windows\\System32\\cmd.exe",
      commandLine: "cmd.exe /d /c start"
    },
    {
      processId: 310,
      parentProcessId: 300,
      createdAt: "2026-07-30T13:23:00.000Z",
      executablePath: "C:\\Tools\\codex.exe",
      commandLine: `"C:\\Tools\\codex.exe" exec resume ${THREAD_ID} --json`
    }
  ];
}

test("does not expose an external force stop outside Windows", async (context) => {
  if (process.platform === "win32") {
    context.skip("Platform guard is covered by the non-Windows test environment.");
    return;
  }

  assert.deepEqual(await getCodexExternalForceStopCapability(THREAD_ID), {
    kind: "unavailable",
    reason: "platform_unsupported"
  });
});

test("requires the confirmation target to match both PID and creation time", () => {
  const process = {
    processId: 310,
    createdAt: "2026-07-30T13:23:00.000Z"
  };

  assert.equal(matchesCodexExternalProcessTarget(process, {
    processId: 310,
    processCreatedAt: "2026-07-30T13:23:00.000Z"
  }), true);
  assert.equal(matchesCodexExternalProcessTarget(process, {
    processId: 310,
    processCreatedAt: "2026-07-30T13:22:59.000Z"
  }), false);
  assert.equal(matchesCodexExternalProcessTarget(process, {
    processId: 311,
    processCreatedAt: "2026-07-30T13:23:00.000Z"
  }), false);
});

test("revalidates an exact Codex resume process before requesting its tree termination", async (context) => {
  if (process.platform !== "win32") {
    context.skip("Force stop execution is Windows-only.");
    return;
  }

  const snapshots = [processTree(), processTree()];
  const inventory: ExternalProcessInventory = {
    async listProcesses() {
      return snapshots.shift() ?? [];
    }
  };
  const stopped: number[] = [];

  const result = await requestCodexExternalProcessForceStop(THREAD_ID, {
    inventory,
    terminateProcessTree: async (processId) => {
      stopped.push(processId);
    }
  });

  assert.deepEqual(result, {
    kind: "stop_requested",
    processId: 310
  });
  assert.deepEqual(stopped, [310]);
});

test("refuses a process that changed after the confirmation capability was read", async (context) => {
  if (process.platform !== "win32") {
    context.skip("Force stop execution is Windows-only.");
    return;
  }

  const inventory: ExternalProcessInventory = {
    async listProcesses() {
      return processTree();
    }
  };
  const stopped: number[] = [];

  const result = await requestCodexExternalProcessForceStop(THREAD_ID, {
    expectedProcess: {
      processId: 310,
      processCreatedAt: "2026-07-30T13:22:59.000Z"
    },
    inventory,
    terminateProcessTree: async (processId) => {
      stopped.push(processId);
    }
  });

  assert.deepEqual(result, { kind: "process_identity_changed" });
  assert.deepEqual(stopped, []);
});
