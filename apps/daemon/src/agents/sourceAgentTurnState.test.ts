import assert from "node:assert/strict";
import test from "node:test";

import type { AgentTranscriptEntry } from "@deskcue/protocol";

import { deriveSourceAgentTurnState } from "./sourceAgentTurnState.ts";

function lifecycleEntry(
  id: string,
  timestamp: string,
  label: "Turn started" | "Turn completed" | "Turn failed" | "Turn interrupted"
): AgentTranscriptEntry {
  return {
    id,
    parts: [
      {
        detail: null,
        label,
        type: "status"
      }
    ],
    phase: null,
    role: "system",
    text: label,
    timestamp
  };
}

function textEntry(
  id: string,
  timestamp: string,
  text: string,
  role: AgentTranscriptEntry["role"] = "assistant",
  phase: string | null = null
): AgentTranscriptEntry {
  return {
    id,
    phase,
    role,
    text,
    timestamp
  };
}

test("source agent turn state reports an active turn after latest turn start", () => {
  const startedAt = new Date(Date.now() - 5_000).toISOString();
  const activityAt = new Date(Date.now() - 1_000).toISOString();
  const state = deriveSourceAgentTurnState({
    transcript: [
      lifecycleEntry("start-1", startedAt, "Turn started"),
      textEntry("assistant-1", activityAt, "Working")
    ]
  });

  assert.equal(state.phase, "active");
  assert.equal(state.fingerprint, "start-1");
  assert.equal(state.evidence, "turn_lifecycle");
});

test("source agent turn state keeps a recent explicit turn active while it is quiet", () => {
  const startedAt = new Date(Date.now() - 90_000).toISOString();
  const state = deriveSourceAgentTurnState({
    transcript: [
      lifecycleEntry("start-1", startedAt, "Turn started"),
      textEntry("tool-1", new Date(Date.now() - 30_000).toISOString(), "Waiting", "tool")
    ]
  });

  assert.equal(state.phase, "active");
  assert.equal(state.fingerprint, "start-1");
  assert.equal(state.evidence, "turn_lifecycle");
});

test("source agent turn state releases a stale explicit turn without a terminal entry", () => {
  const state = deriveSourceAgentTurnState({
    transcript: [
      lifecycleEntry("start-1", "2026-07-09T08:00:00.000Z", "Turn started"),
      textEntry("tool-1", "2026-07-09T08:02:00.000Z", "Waiting", "tool")
    ]
  });

  assert.deepEqual(state, {
    evidence: "none",
    fingerprint: null,
    phase: "idle"
  });
});

test("source agent turn state reports completed terminal lifecycle entry", () => {
  const state = deriveSourceAgentTurnState({
    transcript: [
      lifecycleEntry("start-1", "2026-07-09T08:00:00.000Z", "Turn started"),
      lifecycleEntry("done-1", "2026-07-09T08:00:30.000Z", "Turn completed")
    ]
  });

  assert.deepEqual(state, {
    completedAt: "2026-07-09T08:00:30.000Z",
    evidence: "terminal_lifecycle",
    fingerprint: "done-1",
    phase: "completed",
    startedAt: "2026-07-09T08:00:00.000Z",
    turnStartFingerprint: "start-1"
  });
});

test("source agent turn state identifies a user entry as the turn start without explicit lifecycle", () => {
  const state = deriveSourceAgentTurnState({
    transcript: [
      textEntry("user-1", "2026-07-09T08:00:00.000Z", "Run it", "user"),
      lifecycleEntry("done-1", "2026-07-09T08:00:00.000Z", "Turn completed")
    ]
  });

  assert.equal(state.phase, "completed");
  if (state.phase === "completed") assert.equal(state.turnStartFingerprint, "user-1");
});

test("source agent turn state starts a new turn from a prompt after completion", () => {
  const promptedAt = new Date(Date.now() - 1_000).toISOString();
  const state = deriveSourceAgentTurnState({
    transcript: [
      lifecycleEntry("start-1", "2026-07-09T08:00:00.000Z", "Turn started"),
      lifecycleEntry("done-1", "2026-07-09T08:00:30.000Z", "Turn completed"),
      textEntry("user-2", promptedAt, "Continue with the next task", "user")
    ]
  });

  assert.deepEqual(state, {
    activityAt: promptedAt,
    evidence: "user_after_terminal",
    fingerprint: "user-2",
    phase: "active",
    startedAt: promptedAt
  });
});

test("source agent turn state keeps a stale unanswered user turn active without lifecycle", () => {
  const state = deriveSourceAgentTurnState({
    transcript: [
      textEntry("user-1", "2026-07-09T08:00:00.000Z", "Run a long sleep", "user"),
      textEntry("detail-1", "2026-07-09T08:02:00.000Z", "Working", "commentary"),
      textEntry("tool-1", "2026-07-09T08:05:00.000Z", "sleep 600", "tool")
    ]
  });

  assert.deepEqual(state, {
    activityAt: "2026-07-09T08:05:00.000Z",
    evidence: "unanswered_user_turn",
    fingerprint: "user-1",
    phase: "active",
    startedAt: "2026-07-09T08:00:00.000Z"
  });
});

test("source agent turn state reports idle after a final assistant reply to the latest user turn", () => {
  const state = deriveSourceAgentTurnState({
    transcript: [
      textEntry("user-1", "2026-07-09T08:00:00.000Z", "Run a task", "user"),
      textEntry("detail-1", "2026-07-09T08:02:00.000Z", "Working", "commentary"),
      textEntry("assistant-1", "2026-07-09T08:05:00.000Z", "Done")
    ]
  });

  assert.deepEqual(state, {
    evidence: "none",
    fingerprint: null,
    phase: "idle"
  });
});

test("source agent turn state does not treat a non-final assistant preamble as a reply", () => {
  const promptedAt = new Date(Date.now() - 2_000).toISOString();
  const activityAt = new Date(Date.now() - 1_000).toISOString();
  const state = deriveSourceAgentTurnState({
    transcript: [
      textEntry("user-1", promptedAt, "Run a task", "user"),
      textEntry("assistant-1", activityAt, "I will inspect the file", "assistant", "non_final")
    ]
  });

  assert.deepEqual(state, {
    activityAt,
    evidence: "unanswered_user_turn",
    fingerprint: "user-1",
    phase: "active",
    startedAt: promptedAt
  });
});

test("source agent turn state treats a fresh non-final assistant preamble as activity", () => {
  const activityAt = new Date(Date.now() - 1_000).toISOString();
  const state = deriveSourceAgentTurnState({
    transcript: [
      textEntry("assistant-1", activityAt, "I will inspect the file", "assistant", "non_final")
    ]
  });

  assert.deepEqual(state, {
    activityAt,
    evidence: "recent_non_final_activity",
    fingerprint: "assistant-1",
    phase: "active",
    startedAt: activityAt
  });
});

test("source agent turn state keeps a stale prompt after terminal active when work follows it", () => {
  const state = deriveSourceAgentTurnState({
    transcript: [
      lifecycleEntry("start-1", "2026-07-09T08:00:00.000Z", "Turn started"),
      lifecycleEntry("done-1", "2026-07-09T08:00:30.000Z", "Turn completed"),
      textEntry("user-2", "2026-07-09T08:01:00.000Z", "Continue with the next task", "user"),
      textEntry("tool-2", "2026-07-09T08:05:00.000Z", "Tool output", "tool")
    ]
  });

  assert.deepEqual(state, {
    activityAt: "2026-07-09T08:05:00.000Z",
    evidence: "unanswered_user_turn",
    fingerprint: "user-2",
    phase: "active",
    startedAt: "2026-07-09T08:01:00.000Z"
  });
});

test("source agent turn state reports interrupted terminal lifecycle entry", () => {
  const state = deriveSourceAgentTurnState({
    transcript: [
      lifecycleEntry("start-1", "2026-07-09T08:00:00.000Z", "Turn started"),
      lifecycleEntry("stop-1", "2026-07-09T08:00:30.000Z", "Turn interrupted")
    ]
  });

  assert.deepEqual(state, {
    completedAt: "2026-07-09T08:00:30.000Z",
    evidence: "terminal_lifecycle",
    fingerprint: "stop-1",
    phase: "interrupted",
    startedAt: "2026-07-09T08:00:00.000Z",
    turnStartFingerprint: "start-1"
  });
});

test("source agent turn state reports failed terminal lifecycle entry", () => {
  const state = deriveSourceAgentTurnState({
    transcript: [
      lifecycleEntry("start-1", "2026-07-09T08:00:00.000Z", "Turn started"),
      lifecycleEntry("failed-1", "2026-07-09T08:00:30.000Z", "Turn failed")
    ]
  });

  assert.deepEqual(state, {
    completedAt: "2026-07-09T08:00:30.000Z",
    evidence: "terminal_lifecycle",
    fingerprint: "failed-1",
    phase: "failed",
    startedAt: "2026-07-09T08:00:00.000Z",
    turnStartFingerprint: "start-1"
  });
});

test("source agent turn state treats fresh tool activity without lifecycle as active", () => {
  const activityAt = new Date(Date.now() - 1_000).toISOString();
  const state = deriveSourceAgentTurnState({
    transcript: [
      textEntry("assistant-1", "2026-07-09T08:00:00.000Z", "Working"),
      textEntry("tool-1", activityAt, "Tool output", "tool")
    ]
  });

  assert.equal(state.phase, "active");
  assert.equal(state.fingerprint, "tool-1");
  assert.equal(state.evidence, "recent_non_final_activity");
});

test("source agent turn state does not treat fresh assistant text without lifecycle as active", () => {
  const activityAt = new Date(Date.now() - 1_000).toISOString();
  const state = deriveSourceAgentTurnState({
    transcript: [
      textEntry("assistant-1", activityAt, "Final reply")
    ]
  });

  assert.deepEqual(state, {
    evidence: "none",
    fingerprint: null,
    phase: "idle"
  });
});
