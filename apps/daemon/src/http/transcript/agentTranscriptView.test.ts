import assert from "node:assert/strict";
import test from "node:test";

import type { AgentSessionDetail, AgentTranscriptEntry } from "@deskcue/protocol";

import {
  buildAgentTranscriptChangesResponse,
  buildAgentTranscriptView
} from "./agentTranscriptView.ts";

function entry(
  id: string,
  role: AgentTranscriptEntry["role"],
  text: string,
  timestamp = "2026-08-05T01:00:00.000Z"
): AgentTranscriptEntry {
  return {
    id,
    timestamp,
    role,
    text,
    phase: null
  };
}

function agentSession(transcript: AgentTranscriptEntry[]): AgentSessionDetail {
  return {
    id: "codex:source-1",
    agentId: "codex",
    agentLabel: "Codex",
    sourceSessionId: "source-1",
    title: "Test",
    workspacePath: null,
    workspaceName: null,
    updatedAt: "2026-08-05T01:00:00.000Z",
    model: null,
    originator: null,
    cliVersion: null,
    source: null,
    filePath: "C:/test.jsonl",
    attachMode: "resume",
    attachModeReason: null,
    workState: "idle",
    transcript
  };
}

test("groups details, tools and changes without changing hydrated diff semantics", () => {
  const session = agentSession([
    entry("user-1", "user", "update the file", "2026-08-05T01:00:00.000Z"),
    entry("detail-1", "system", "Inspecting", "2026-08-05T01:00:01.000Z"),
    {
      ...entry("tool-1", "tool", "Read file", "2026-08-05T01:00:02.000Z"),
      parts: [{
        type: "tool_result",
        toolName: "read_file",
        status: "completed",
        text: "old content"
      }]
    },
    {
      ...entry("change-1", "tool", "Updated app.ts", "2026-08-05T01:00:03.000Z"),
      parts: [{
        type: "diff",
        title: "app.ts",
        text: "--- a/app.ts\n+++ b/app.ts\n-old\n+new",
        filePath: "app.ts",
        changeType: "update"
      }]
    },
    entry("assistant-1", "assistant", "Done", "2026-08-05T01:00:04.000Z")
  ]);

  const view = buildAgentTranscriptView(session);
  const assistant = view.items.find(
    (item) => item.type === "message" && item.entry.id === "assistant-1"
  );

  assert.equal(assistant?.type, "message");
  assert.deepEqual(assistant?.activities.map((activity) => activity.kind), [
    "details",
    "tools"
  ]);
  assert.deepEqual(assistant?.activities.map((activity) => activity.label), [
    "Details (1)",
    "Tools (1)"
  ]);
  assert.deepEqual(assistant?.changeActivities.map((activity) => activity.label), [
    "Changes (1)"
  ]);

  const changes = assistant?.changeActivities[0];
  const response = buildAgentTranscriptChangesResponse(session, changes?.id ?? "");

  assert.deepEqual(response?.files.map((file) => ({
    additions: file.additions,
    deletions: file.deletions,
    displayPath: file.displayPath
  })), [{ additions: 1, deletions: 1, displayPath: "app.ts" }]);
});

test("uses canonical source order when compact activity timestamps are skewed", () => {
  const compactToolEntry = {
    ...entry("compact-tools", "tool", "Tool summary", new Date(0).toISOString()),
    isCompact: true,
    parts: [{
      type: "tool_result" as const,
      toolName: "read_file",
      status: "completed" as const,
      text: "summary"
    }],
    sourceEntryCount: 5,
    sourceEntryRanges: [{ prefix: "source-", start: 110, end: 114 }]
  };

  const userEntry = entry("source-100", "user", "Inspect it", "2026-08-05T01:00:10.000Z");
  const assistantEntry = entry(
    "source-130",
    "assistant",
    "Done",
    "2026-08-05T01:00:30.000Z"
  );

  const view = buildAgentTranscriptView(agentSession([
    userEntry,
    compactToolEntry,
    assistantEntry
  ]));
  const assistant = view.items.find(
    (item) => item.type === "message" && item.entry.id === assistantEntry.id
  );

  assert.equal(assistant?.type, "message");
  assert.deepEqual(assistant?.activities.map((activity) => activity.label), ["Tools (5)"]);
  assert.equal(view.items.some((item) => item.type === "activity"), false);
});

test("uses one timestamp order when transcript source coordinate families are mixed", () => {
  const compactToolEntry = {
    ...entry("compact-tools", "tool", "Tool summary", "2026-08-05T01:00:20.000Z"),
    isCompact: true,
    parts: [{
      type: "tool_result" as const,
      toolName: "read_file",
      status: "completed" as const,
      text: "summary"
    }],
    sourceEntryCount: 5,
    sourceEntryRanges: [{ prefix: "window-", start: 110, end: 114 }]
  };

  const view = buildAgentTranscriptView(agentSession([
    entry("source-100", "user", "Inspect it", "2026-08-05T01:00:10.000Z"),
    compactToolEntry,
    entry("source-130", "assistant", "Done", "2026-08-05T01:00:30.000Z")
  ]));
  const assistant = view.items.find(
    (item) => item.type === "message" && item.entry.id === "source-130"
  );

  assert.equal(assistant?.type, "message");
  assert.deepEqual(assistant?.activities.map((activity) => activity.label), ["Tools (5)"]);
  assert.equal(view.items.some((item) => item.type === "activity"), false);
});

test("keeps mixed compact changes honest and excludes hidden placeholders from files", () => {
  const session = agentSession([
    entry("user-1", "user", "update the file", "2026-08-05T01:00:00.000Z"),
    {
      ...entry("change-compact", "tool", "Changes hidden", "2026-08-05T01:00:01.000Z"),
      isCompact: true,
      parts: [{
        type: "diff",
        title: "Changes",
        text: "[diff hidden in live view]",
        filePath: null,
        changeType: "unknown"
      }]
    },
    {
      ...entry("change-exact", "tool", "Updated app.ts", "2026-08-05T01:00:02.000Z"),
      parts: [{
        type: "diff",
        title: "app.ts",
        text: "--- a/app.ts\n+++ b/app.ts\n-old\n+new",
        filePath: "app.ts",
        changeType: "update"
      }]
    },
    entry("assistant-1", "assistant", "Done", "2026-08-05T01:00:03.000Z")
  ]);
  const view = buildAgentTranscriptView(session);
  const assistant = view.items.find(
    (item) => item.type === "message" && item.entry.id === "assistant-1"
  );

  assert.equal(assistant?.type, "message");
  assert.equal(assistant?.changeActivities[0]?.label, "Changes");

  const response = buildAgentTranscriptChangesResponse(
    session,
    assistant?.changeActivities[0]?.id ?? ""
  );

  assert.deepEqual(response?.files.map((file) => file.displayPath), ["app.ts"]);
});

test("keeps duplicate change source events while avoiding doubled hydrated diff stats", () => {
  const diffPart = {
    type: "diff" as const,
    title: "app.ts",
    text: "--- a/app.ts\n+++ b/app.ts\n-old\n+new",
    filePath: "app.ts",
    changeType: "update" as const
  };

  const session = agentSession([
    entry("user-1", "user", "update", "2026-08-05T01:00:00.000Z"),
    { ...entry("change-legacy", "tool", "Updated app.ts", "2026-08-05T01:00:01.000Z"), parts: [diffPart] },
    { ...entry("change-modern", "tool", "Updated app.ts", "2026-08-05T01:00:02.000Z"), parts: [diffPart] },
    entry("assistant-1", "assistant", "Done", "2026-08-05T01:00:03.000Z")
  ]);
  const view = buildAgentTranscriptView(session);
  const assistant = view.items.find(
    (item) => item.type === "message" && item.entry.id === "assistant-1"
  );

  assert.equal(assistant?.type, "message");
  assert.equal(assistant?.changeActivities[0]?.sourceEntryIds?.length, 2);

  const response = buildAgentTranscriptChangesResponse(
    session,
    assistant?.changeActivities[0]?.id ?? ""
  );

  assert.equal(response?.files[0]?.parts.length, 1);
  assert.equal(response?.files[0]?.additions, 1);
  assert.equal(response?.files[0]?.deletions, 1);
});

test("keeps the latest full detail available to the waiting block", () => {
  const view = buildAgentTranscriptView(agentSession([
    entry("user-1", "user", "work", "2026-08-05T01:00:00.000Z"),
    {
      ...entry("detail-compact", "system", "compact", "2026-08-05T01:00:01.000Z"),
      isCompact: true,
      sourceEntryIds: ["source-1"]
    },
    entry("detail-full", "system", "Still working", "2026-08-05T01:00:02.000Z")
  ]), { waitingSince: "2026-08-05T01:00:00.500Z" });

  assert.equal(view.latestWaitingDetailEntry?.id, "detail-full");
  assert.equal(view.latestWaitingDetailEntry?.text, "Still working");
});

test("marks a prompt superseded when the next user prompt arrives first", () => {
  const view = buildAgentTranscriptView(agentSession([
    entry("user-1", "user", "first", "2026-08-05T01:00:00.000Z"),
    entry("detail-1", "system", "thinking", "2026-08-05T01:00:01.000Z"),
    entry("user-2", "user", "replacement", "2026-08-05T01:00:02.000Z")
  ]));

  const first = view.items.find(
    (item) => item.type === "message" && item.entry.id === "user-1"
  );
  const replacement = view.items.find(
    (item) => item.type === "message" && item.entry.id === "user-2"
  );

  assert.equal(first?.type, "message");
  assert.equal(first?.turnStatus?.kind, "superseded");
  assert.equal(first?.turnStatus?.label, "Interrupted by next prompt");
  assert.equal(replacement?.type, "message");
  assert.equal(replacement?.turnStatus, null);
});

function statusEntry(
  id: string,
  label: "Turn started" | "Turn interrupted",
  timestamp: string
): AgentTranscriptEntry {
  return {
    ...entry(id, "system", label, timestamp),
    parts: [{ type: "status", label, detail: null }]
  };
}

test("marks a user prompt interrupted even when the agent produced a partial reply", () => {
  const view = buildAgentTranscriptView(agentSession([
    entry("user-1", "user", "write 300 lines", "2026-08-05T01:00:00.000Z"),
    entry("assistant-1", "assistant", "line 1\nline 2", "2026-08-05T01:00:01.000Z"),
    statusEntry("interrupted-1", "Turn interrupted", "2026-08-05T01:00:02.000Z")
  ]));

  const userMessage = view.items.find(
    (item) => item.type === "message" && item.entry.id === "user-1"
  );

  assert.equal(userMessage?.type, "message");
  assert.equal(userMessage?.turnStatus?.kind, "interrupted");
});

test("marks a verified externally stopped user turn as interrupted without a source terminal entry", () => {
  const view = buildAgentTranscriptView({
    ...agentSession([
      entry("user-1", "user", "long prompt", "2026-08-05T01:00:00.000Z"),
      entry("assistant-1", "assistant", "partial reply", "2026-08-05T01:00:01.000Z")
    ]),
    interruptLifecycle: {
      phase: "confirmed",
      requestedAt: "2026-08-05T01:00:00.000Z",
      confirmedAt: "2026-08-05T01:00:01.000Z",
      turnFingerprint: "user-1",
      confirmation: "verified_process",
      outcome: "interrupted"
    }
  });

  const userMessage = view.items.find(
    (item) => item.type === "message" && item.entry.id === "user-1"
  );

  assert.equal(userMessage?.type, "message");
  assert.equal(userMessage?.turnStatus?.label, "Interrupted");
});

test("marks a DeskCue-managed transport stop as interrupted without a source terminal entry", () => {
  const view = buildAgentTranscriptView({
    ...agentSession([
      entry("user-1", "user", "long prompt", "2026-08-05T01:00:00.000Z"),
      statusEntry("turn-started", "Turn started", "2026-08-05T01:00:01.000Z"),
      entry("assistant-1", "assistant", "partial reply", "2026-08-05T01:00:02.000Z")
    ]),
    interruptLifecycle: {
      phase: "unresolved",
      requestedAt: "2026-08-05T01:00:03.000Z",
      confirmedAt: "2026-08-05T01:00:04.000Z",
      turnFingerprint: "turn-started",
      confirmation: "managed_transport",
      outcome: null
    }
  });

  const userMessage = view.items.find(
    (item) => item.type === "message" && item.entry.id === "user-1"
  );

  assert.equal(userMessage?.type, "message");
  assert.equal(userMessage?.turnStatus?.kind, "interrupted");
});

test("does not mark the previous user prompt when a managed stop identifies the current user entry", () => {
  const view = buildAgentTranscriptView({
    ...agentSession([
      entry("user-previous", "user", "previous prompt", "2026-08-05T01:00:00.000Z"),
      statusEntry("turn-previous", "Turn started", "2026-08-05T01:00:01.000Z"),
      entry("assistant-previous", "assistant", "done", "2026-08-05T01:00:02.000Z"),
      entry("user-current", "user", "current prompt", "2026-08-05T01:01:00.000Z"),
      statusEntry("turn-current", "Turn started", "2026-08-05T01:01:01.000Z")
    ]),
    interruptLifecycle: {
      phase: "confirmed",
      requestedAt: "2026-08-05T01:01:02.000Z",
      confirmedAt: "2026-08-05T01:01:03.000Z",
      turnFingerprint: "user-current",
      confirmation: "verified_process",
      outcome: "interrupted"
    }
  });

  const messages = view.items.filter((item) => item.type === "message");
  const previous = messages.find((item) => item.type === "message" && item.entry.id === "user-previous");
  const current = messages.find((item) => item.type === "message" && item.entry.id === "user-current");

  assert.equal(previous?.type, "message");
  assert.equal(previous?.turnStatus, null);
  assert.equal(current?.type, "message");
  assert.equal(current?.turnStatus?.kind, "interrupted");
});
