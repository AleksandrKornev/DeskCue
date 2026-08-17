import assert from "node:assert/strict";
import test from "node:test";

import type { ExternalProcessSnapshot } from "#infrastructure/process/externalProcessIdentity";

import {
  resolveClaudeExternalProcess,
  validateClaudeExternalProcess
} from "./claudeExternalProcessResolver.ts";

const SESSION_ID = "019f956a-2a0e-72f2-97af-5b4c0c5638ab";

function processTree(overrides: Partial<ExternalProcessSnapshot> = {}): ExternalProcessSnapshot[] {
  return [
    {
      processId: 4,
      parentProcessId: null,
      createdAt: "2026-07-31T12:00:00.000Z",
      executablePath: "C:\\Windows\\System32\\services.exe",
      commandLine: "services.exe"
    },
    {
      processId: 400,
      parentProcessId: 4,
      createdAt: "2026-07-31T12:00:05.000Z",
      executablePath: "C:\\Windows\\System32\\cmd.exe",
      commandLine: "cmd.exe /d /c claude"
    },
    {
      processId: 410,
      parentProcessId: 400,
      createdAt: "2026-07-31T13:23:00.000Z",
      executablePath: "C:\\Tools\\claude.exe",
      commandLine: `"C:\\Tools\\claude.exe" --resume ${SESSION_ID}`,
      ...overrides
    }
  ];
}

test("resolves and revalidates one exact Claude resume process", () => {
  const processes = processTree();
  const resolution = resolveClaudeExternalProcess(SESSION_ID, processes);

  assert.equal(resolution.confidence, "exact_session_id_in_argv");
  assert.equal(resolution.process?.processId, 410);
  assert.deepEqual(resolution.process?.parentChain.map((entry) => entry.processId), [400, 4]);

  const validation = validateClaudeExternalProcess(SESSION_ID, resolution.process!, processes);
  assert.equal(validation.confidence, "validated");
});

test("requires the exact Claude session id immediately after --resume", () => {
  const processes = processTree({
    commandLine: `"C:\\Tools\\claude.exe" --resume ${SESSION_ID}-other`
  });

  assert.deepEqual(resolveClaudeExternalProcess(SESSION_ID, processes), {
    confidence: "none",
    reason: "no_exact_session_process",
    process: null
  });
});

test("accepts the exact interactive --session-id leaf but excludes its background PTY host", () => {
  const processes = processTree({
    commandLine: `"C:\\Tools\\claude.exe" --session-id ${SESSION_ID}`
  });
  processes.push({
    ...processes[2]!,
    processId: 411,
    commandLine: `"C:\\Tools\\claude.exe" --bg-pty-host pipe -- "C:\\Tools\\claude.exe" --session-id ${SESSION_ID}`
  });

  assert.equal(resolveClaudeExternalProcess(SESSION_ID, processes).process?.processId, 410);
});

test("refuses ambiguous Claude resume processes and changed identities", () => {
  const processes = processTree();
  processes.push({
    ...processes[2]!,
    processId: 411,
    createdAt: "2026-07-31T13:24:00.000Z"
  });
  assert.equal(
    resolveClaudeExternalProcess(SESSION_ID, processes).reason,
    "ambiguous_exact_session_process"
  );

  const expected = resolveClaudeExternalProcess(SESSION_ID, processTree()).process!;
  assert.equal(
    validateClaudeExternalProcess(
      SESSION_ID,
      expected,
      processTree({ createdAt: "2026-07-31T13:30:00.000Z" })
    ).reason,
    "process_identity_changed"
  );
  assert.equal(
    validateClaudeExternalProcess(
      SESSION_ID,
      expected,
      processTree({ commandLine: '"C:\\Tools\\claude.exe" --resume other-session' })
    ).reason,
    "command_no_longer_matches_session"
  );
});
