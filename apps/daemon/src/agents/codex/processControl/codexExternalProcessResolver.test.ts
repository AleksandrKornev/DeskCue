import assert from "node:assert/strict";
import test from "node:test";

import { parseWindowsCommandLine } from "#infrastructure/process/externalProcessIdentity";
import type { ExternalProcessSnapshot } from "#infrastructure/process/externalProcessIdentity";
import { parseWindowsProcessInventory } from "#infrastructure/process/externalProcessInventory";

import {
  resolveCodexExternalProcess,
  validateCodexExternalProcess
} from "./codexExternalProcessResolver.ts";

const THREAD_ID = "019f956a-2a0e-72f2-97af-5b4c0c5638ab";

function processTree(overrides: Partial<ExternalProcessSnapshot> = {}) {
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
      commandLine: `"C:\\Tools\\codex.exe" exec resume ${THREAD_ID} --json`,
      ...overrides
    }
  ];
}

test("resolves one exact Codex resume process and validates the same process snapshot", () => {
  const processes = processTree();
  const resolution = resolveCodexExternalProcess(THREAD_ID, processes);

  assert.equal(resolution.confidence, "exact_thread_id_in_argv");
  assert.equal(resolution.process?.processId, 310);
  assert.deepEqual(resolution.process?.parentChain.map((entry) => entry.processId), [300, 4]);

  const validation = validateCodexExternalProcess(THREAD_ID, resolution.process!, processes);
  assert.equal(validation.confidence, "validated");
  assert.equal(validation.process?.processId, 310);
});

test("requires the exact thread id directly after resume instead of a substring or workspace hint", () => {
  const processes = processTree({
    commandLine: `"C:\\Tools\\codex.exe" exec resume ${THREAD_ID}-other --cwd C:\\projects\\ExampleWorkspace\\DeskCue`
  });

  const resolution = resolveCodexExternalProcess(THREAD_ID, processes);
  assert.deepEqual(resolution, {
    confidence: "none",
    reason: "no_exact_thread_process",
    process: null
  });
});

test("rejects ambiguous exact Codex resume candidates", () => {
  const processes = processTree();
  processes.push({
    ...processes[2]!,
    processId: 311,
    createdAt: "2026-07-30T13:24:05.000Z"
  });

  assert.deepEqual(resolveCodexExternalProcess(THREAD_ID, processes), {
    confidence: "none",
    reason: "ambiguous_exact_thread_process",
    process: null
  });
});

test("keeps an exact resume match when the short-lived launcher has already exited", () => {
  const processes = processTree().filter((process) => process.processId === 310);
  const resolution = resolveCodexExternalProcess(THREAD_ID, processes);

  assert.equal(resolution.confidence, "exact_thread_id_in_argv");
  assert.equal(resolution.process?.parentProcessId, 300);
  assert.deepEqual(resolution.process?.parentChain, []);

  const validation = validateCodexExternalProcess(THREAD_ID, resolution.process!, processes);
  assert.equal(validation.confidence, "validated");
});

test("revalidation rejects PID reuse, executable and argv changes, and a parent-chain change", () => {
  const processes = processTree();
  const resolution = resolveCodexExternalProcess(THREAD_ID, processes);
  assert.ok(resolution.process);

  const reused = processTree({ createdAt: "2026-07-30T13:30:00.000Z" });
  assert.equal(
    validateCodexExternalProcess(THREAD_ID, resolution.process, reused).reason,
    "process_identity_changed"
  );

  const changedExecutable = processTree({ executablePath: "C:\\Other\\codex.exe" });
  assert.equal(
    validateCodexExternalProcess(THREAD_ID, resolution.process, changedExecutable).reason,
    "process_identity_changed"
  );

  const changedCommand = processTree({ commandLine: '"C:\\Tools\\codex.exe" exec resume other-thread' });
  assert.equal(
    validateCodexExternalProcess(THREAD_ID, resolution.process, changedCommand).reason,
    "command_no_longer_matches_thread"
  );

  const changedParent = processTree();
  changedParent[1] = { ...changedParent[1]!, createdAt: "2026-07-30T12:01:05.000Z" };
  assert.equal(
    validateCodexExternalProcess(THREAD_ID, resolution.process, changedParent).reason,
    "parent_chain_changed"
  );

  const missingParent = processTree().filter((process) => process.processId !== 300);
  assert.equal(
    validateCodexExternalProcess(THREAD_ID, resolution.process, missingParent).reason,
    "parent_chain_changed"
  );

  assert.equal(
    validateCodexExternalProcess(THREAD_ID, resolution.process, []).reason,
    "process_not_found"
  );
});

test("parses quoted Windows argv and CIM inventory without accepting incomplete entries", () => {
  assert.deepEqual(
    parseWindowsCommandLine(`"C:\\Program Files\\Codex\\codex.exe" -c "a=b" resume "${THREAD_ID}"`),
    ["C:\\Program Files\\Codex\\codex.exe", "-c", "a=b", "resume", THREAD_ID]
  );

  assert.deepEqual(
    parseWindowsProcessInventory(JSON.stringify([
      {
        ProcessId: 42,
        ParentProcessId: 1,
        CreationDate: "2026-07-30T13:23:00.000Z",
        ExecutablePath: "C:\\Tools\\codex.exe",
        CommandLine: '"C:\\Tools\\codex.exe" resume thread'
      },
      { ProcessId: 43, ParentProcessId: 1 }
    ])),
    [{
      processId: 42,
      parentProcessId: 1,
      createdAt: "2026-07-30T13:23:00.000Z",
      executablePath: "C:\\Tools\\codex.exe",
      commandLine: '"C:\\Tools\\codex.exe" resume thread'
    }]
  );
});
