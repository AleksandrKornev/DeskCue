import assert from "node:assert/strict";
import test from "node:test";

import type { AgentSessionDetail, AgentTranscriptEntry } from "@deskcue/protocol";

import {
  buildCodexTranscriptWindowSessionId,
  parseTranscript,
  readCodexTranscriptEntryRefs,
  readCodexTranscriptWindowEntryRef,
  trimIncrementalTranscript
} from "./codexTranscriptProjection.ts";
import { buildAgentTranscriptView } from "../../../../../http/transcript/agentTranscriptView.ts";

function transcriptEntry(id: string, role: AgentTranscriptEntry["role"]): AgentTranscriptEntry {
  return {
    id,
    phase: null,
    role,
    text: id,
    timestamp: "2026-08-05T00:00:00.000Z"
  };
}

test("round-trips stable byte-window transcript ids", () => {
  const windowSessionId = buildCodexTranscriptWindowSessionId("session", 1024, 2048);

  assert.equal(windowSessionId, "session@1024~2048");

  assert.deepEqual(
    readCodexTranscriptWindowEntryRef("session", `${windowSessionId}-17`),
    {
      byteOffset: 1024,
      endByteOffset: 2048,
      lineIndex: 17,
      windowSessionId
    }
  );

  const refs = readCodexTranscriptEntryRefs("session", [
    "session-9",
    `${windowSessionId}-17`,
    "another-session-3",
    "session@invalid-4"
  ]);

  assert.deepEqual([...refs.exactLineIndexes], [9]);
  assert.deepEqual([...refs.windowLineIndexesByByteOffset.get(1024) ?? []], [17]);
});

test("keeps source-line continuity when trimming to the newest chat messages", () => {
  const transcript = [
    transcriptEntry("session-1", "user"),
    transcriptEntry("session-2", "tool"),
    transcriptEntry("session-3", "assistant"),
    transcriptEntry("session-4", "system"),
    transcriptEntry("session-5", "user"),
    transcriptEntry("session-6", "tool")
  ];

  assert.deepEqual(
    trimIncrementalTranscript(transcript, { chatMessageTail: 2 }).map((entry) => entry.id),
    ["session-3", "session-4", "session-5", "session-6"]
  );
});

test("keeps compact activity crossing a bounded raw window attached to its final reply", () => {
  const compactToolEntry = (
    id: string,
    start: number,
    end: number,
    sourceEntryCount: number
  ): AgentTranscriptEntry => ({
    id,
    isCompact: true,
    parts: [{
      type: "tool_result",
      toolName: "read_file",
      status: "completed",
      text: id
    }],
    phase: null,
    role: "tool",
    sourceEntryCount,
    sourceEntryRanges: [{ prefix: "session-", start, end }],
    text: id,
    timestamp: "2026-08-05T00:00:00.000Z"
  });
  const assistantLine = JSON.stringify({
    payload: {
      content: [{ text: "Done", type: "output_text" }],
      phase: "final_answer",
      role: "assistant",
      type: "message"
    },
    timestamp: "2026-08-05T00:00:10.000Z",
    type: "response_item"
  });
  const raw = [
    ...Array.from({ length: 10 }, () => "{}"),
    assistantLine
  ].join("\n");
  const transcript = parseTranscript({
    entries: [
      compactToolEntry("stale", 90, 99, 10),
      compactToolEntry("crossing", 98, 102, 5),
      compactToolEntry("current-a", 103, 105, 3),
      compactToolEntry("current-b", 106, 109, 4)
    ],
    lineIndexOffset: 100,
    raw
  }, "session", { transcriptTail: 1 });
  const session = {
    agentId: "codex",
    agentLabel: "Codex",
    attachMode: "resume",
    attachModeReason: null,
    cliVersion: null,
    filePath: "C:/session.jsonl",
    id: "codex:session",
    model: null,
    originator: null,
    source: null,
    sourceSessionId: "session",
    title: "Session",
    transcript,
    updatedAt: "2026-08-05T00:00:10.000Z",
    workState: "idle",
    workspaceName: null,
    workspacePath: null
  } as AgentSessionDetail;
  const view = buildAgentTranscriptView(session);
  const assistant = view.items.find((item) => item.type === "message");

  assert.deepEqual(transcript.map((entry) => entry.id), [
    "crossing",
    "current-a",
    "current-b",
    "session-110"
  ]);
  assert.equal(assistant?.type, "message");
  assert.deepEqual(assistant?.activities.map((activity) => activity.label), ["Tools (12)"]);
  assert.equal(view.items.some((item) => item.type === "activity"), false);
});
