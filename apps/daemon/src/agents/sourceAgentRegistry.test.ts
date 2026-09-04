import assert from "node:assert/strict";
import test from "node:test";

import type { CodexSessionSummary } from "@deskcue/protocol";

import { getSourceAgentDescriptor, toCodexAgentSessionSummary } from "./sourceAgentRegistry.ts";

const codexSummary = {
  id: "session-a",
  threadName: "Active Codex chat",
  workspacePath: "D:\\work\\repo",
  workspaceName: "repo",
  updatedAt: "2026-07-03T10:00:00.000Z",
  model: "gpt-5",
  originator: "codex_cli_rs",
  cliVersion: "0.1.0",
  source: "codex",
  filePath: "C:\\Users\\example\\.codex\\sessions\\session-a.jsonl",
  contextCompactionCount: 3,
  approvalPolicy: "on-request",
  sandboxMode: "workspace-write"
} satisfies CodexSessionSummary;

test("preserves Codex attach state when projecting list summaries", () => {
  const projected = toCodexAgentSessionSummary(codexSummary, {
    mode: "read_only",
    reason: "This Codex thread is active in another client right now.",
    turnState: {
      activityAt: "2026-07-03T10:00:01.000Z",
      evidence: "turn_lifecycle",
      fingerprint: "turn-started",
      phase: "active",
      startedAt: "2026-07-03T10:00:00.000Z"
    }
  });

  assert.equal(projected.attachMode, "read_only");
  assert.equal(projected.workState, "running");
  assert.deepEqual(projected.turnState, {
    activityAt: "2026-07-03T10:00:01.000Z",
    completedAt: null,
    evidence: "turn_lifecycle",
    fingerprint: "turn-started",
    phase: "active",
    startedAt: "2026-07-03T10:00:00.000Z"
  });

  assert.equal(projected.contextCompactionCount, 3);
  assert.equal(projected.approvalPolicy, "on-request");
  assert.equal(projected.sandboxMode, "workspace-write");
  assert.equal(
    projected.attachModeReason,
    "This Codex thread is active in another client right now."
  );
});

test("defaults Codex list summaries to resumable when no attach state is available", () => {
  const projected = toCodexAgentSessionSummary(codexSummary);

  assert.equal(projected.attachMode, "resume");
  assert.equal(projected.attachModeReason, null);
  assert.equal(projected.workState, "idle");
  assert.deepEqual(projected.turnState, {
    activityAt: null,
    completedAt: null,
    evidence: "none",
    fingerprint: null,
    phase: "idle",
    startedAt: null
  });
});

test("projects Codex subagent identity without exposing raw hierarchy parsing to clients", () => {
  const projected = toCodexAgentSessionSummary({
    ...codexSummary,
    source: {
      subagent: {
        thread_spawn: {
          agent_nickname: "Scout",
          agent_role: "adversarial reviewer",
          depth: 1,
          parent_thread_id: "parent-thread"
        }
      }
    } as unknown as string
  });

  assert.deepEqual(projected.subagent, {
    depth: 1,
    nickname: "Scout",
    parentSessionId: "codex:parent-thread",
    role: "adversarial reviewer"
  });

  assert.equal(projected.source, null);
});

test("keeps malformed self-parent Codex metadata in the root session list", () => {
  const projected = toCodexAgentSessionSummary({
    ...codexSummary,
    source: {
      subagent: {
        thread_spawn: {
          depth: 1,
          parent_thread_id: codexSummary.id
        }
      }
    } as unknown as string
  });

  assert.equal(projected.subagent, undefined);
  assert.equal(projected.source, null);
});

test("advertises transcript random-access only for providers that implement it", () => {
  assert.ok(getSourceAgentDescriptor("codex")?.transcript);
  const claudeTranscript = getSourceAgentDescriptor("claude-code")?.transcript;

  assert.ok(claudeTranscript?.getEntries);

  assert.ok(claudeTranscript?.getWindow);
  assert.ok(claudeTranscript?.getTailWindow);
  assert.ok(claudeTranscript?.getPreviousWindow);
  assert.equal(getSourceAgentDescriptor("aider"), null);
});
