import assert from "node:assert/strict";
import test from "node:test";

import type {
  ExternalProcessSnapshot
} from "#infrastructure/process/externalProcessIdentity";
import type { ExternalProcessInventory } from "#infrastructure/process/externalProcessInventory";

import {
  matchesClaudeExternalProcessTarget,
  requestClaudeExternalProcessForceStop
} from "./claudeExternalProcessControl.ts";

const SESSION_ID = "019f956a-2a0e-72f2-97af-5b4c0c5638ab";

function processTree(): ExternalProcessSnapshot[] {
  return [{
    processId: 410,
    parentProcessId: null,
    createdAt: "2026-07-31T13:23:00.000Z",
    executablePath: "C:\\Tools\\claude.exe",
    commandLine: `"C:\\Tools\\claude.exe" --resume ${SESSION_ID}`
  }];
}

test("requires the Claude force-stop confirmation target to match PID and creation time", () => {
  const process = { processId: 410, createdAt: "2026-07-31T13:23:00.000Z" };

  assert.equal(matchesClaudeExternalProcessTarget(process, {
    processId: 410,
    processCreatedAt: "2026-07-31T13:23:00.000Z"
  }), true);
  assert.equal(matchesClaudeExternalProcessTarget(process, {
    processId: 410,
    processCreatedAt: "2026-07-31T13:22:59.000Z"
  }), false);
});

test("revalidates a Claude resume process before requesting tree termination", async (context) => {
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

  const result = await requestClaudeExternalProcessForceStop(SESSION_ID, {
    inventory,
    terminateProcessTree: async (processId) => {
      stopped.push(processId);
    }
  });

  assert.deepEqual(result, { kind: "stop_requested", processId: 410 });
  assert.deepEqual(stopped, [410]);
});
