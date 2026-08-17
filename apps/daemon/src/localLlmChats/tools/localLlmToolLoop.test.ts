import assert from "node:assert/strict";
import test from "node:test";

import { isAllowedLocalLlmReadOnlyTool, resolveLocalLlmToolLoopPlan } from "./localLlmToolLoop.ts";

test("local LLM tool loop stays disabled without an attached workspace", () => {
  const plan = resolveLocalLlmToolLoopPlan({
    hasWorkspace: false,
    modelSupportsToolCalls: true,
    runtimeId: "ollama"
  });

  assert.equal(plan.mode, "disabled");
  assert.equal(plan.tools.length, 0);
  assert.match(plan.reason ?? "", /Attach a DeskCue workspace/);
});

test("local LLM tool loop requires a positive model capability probe", () => {
  const plan = resolveLocalLlmToolLoopPlan({
    hasWorkspace: true,
    modelSupportsToolCalls: false,
    runtimeId: "lm-studio"
  });

  assert.equal(plan.mode, "disabled");
  assert.match(plan.reason ?? "", /does not advertise tool calling/);
});

test("local LLM tool loop exposes only bounded read-only tools", () => {
  const plan = resolveLocalLlmToolLoopPlan({
    hasWorkspace: true,
    modelSupportsToolCalls: true,
    runtimeId: "ollama"
  });

  assert.equal(plan.mode, "read_only");
  assert.equal(plan.maxRounds, 4);
  assert.equal(plan.maxCallsPerRound, 4);
  assert.equal(plan.maxResultBytes, 64 * 1024);
  assert.deepEqual(plan.tools.map((tool) => tool.function.name), [
    "list_workspace_files",
    "read_workspace_file",
    "search_workspace_text",
    "get_workspace_git_status"
  ]);
  assert.equal(isAllowedLocalLlmReadOnlyTool("read_workspace_file"), true);
  assert.equal(isAllowedLocalLlmReadOnlyTool("run_shell"), false);
});
