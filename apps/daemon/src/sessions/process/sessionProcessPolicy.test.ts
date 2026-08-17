import assert from "node:assert/strict";
import test from "node:test";

import {
  createSessionProcessAutomation,
  formatSessionProcessInput,
  getSessionProcessExitStatusOverride,
  isInteractiveSessionProcess
} from "./sessionProcessPolicy.ts";

test("routes process capabilities by adapter without leaking provider branches to the session lifecycle", () => {
  assert.equal(isInteractiveSessionProcess("codex", "custom-command"), true);
  assert.equal(isInteractiveSessionProcess("generic-cli", "claude --resume chat"), true);
  assert.equal(isInteractiveSessionProcess("generic-cli", "npm test"), false);

  assert.equal(
    formatSessionProcessInput(
      {
        adapterId: "codex",
        command: "custom-command",
        sourceSessionId: "source-session"
      },
      "first line\nsecond line"
    ),
    "first line second line\t"
  );

  assert.equal(
    getSessionProcessExitStatusOverride(
      {
        adapterId: "claude-code",
        command: "claude --resume source-session --print continue",
        sourceSessionId: "source-session",
        status: "running"
      },
      0
    ),
    "read_only"
  );
});

test("installs startup automation only for matching Codex processes", () => {
  const written: string[] = [];
  const logs: string[] = [];
  const automation = createSessionProcessAutomation({
    adapterId: "codex",
    child: { write: (value) => written.push(value) },
    command: "custom-command",
    onAutomationLog: (text) => logs.push(text)
  });

  automation?.handleChunk("Update available! Press enter to continue");
  automation?.handleChunk("Update available! Press enter to continue");

  assert.deepEqual(written, ["\u001b[B\u001b[B\r"]);
  assert.deepEqual(logs, ["DeskCue auto-dismissed the Codex update prompt.\n"]);
  assert.equal(
    createSessionProcessAutomation({
      adapterId: "generic-cli",
      child: { write: () => {} },
      command: "npm test",
      onAutomationLog: () => {}
    }),
    null
  );
});
