import assert from "node:assert/strict";
import test from "node:test";

import { buildCodexResumeInvocation } from "./codexResumeInvocation.ts";

test("builds an interactive Codex resume argv with runtime flags", () => {
  const invocation = buildCodexResumeInvocation({
    executable: "codex",
    model: "gpt-5",
    runtimeContext: {
      approvalPolicy: "on-request",
      model: null,
      sandboxMode: "workspace-write"
    },
    sessionId: "abc"
  });

  assert.deepEqual(invocation.args, [
    "-c",
    "check_for_update_on_startup=false",
    "-a",
    "on-request",
    "-s",
    "workspace-write",
    "-m",
    "gpt-5",
    "resume",
    "abc"
  ]);
  assert.match(invocation.command, / -a "on-request" -s "workspace-write" resume /);
});

test("builds a non-interactive exec resume argv when DeskCue has a prompt", () => {
  const invocation = buildCodexResumeInvocation({
    executable: "C:/Program Files/Codex/codex.exe",
    model: "gpt-5",
    prompt: "continue from DeskCue",
    runtimeContext: {
      approvalPolicy: "on-request",
      model: null,
      sandboxMode: "workspace-write"
    },
    sessionId: "abc"
  });

  assert.deepEqual(invocation.args, [
    "-c",
    "check_for_update_on_startup=false",
    "-m",
    "gpt-5",
    "exec",
    "resume",
    "abc",
    "continue from DeskCue"
  ]);
  assert.match(invocation.command, /\sexec resume\s/);
  assert.doesNotMatch(invocation.command, /-a| -s /);
});
