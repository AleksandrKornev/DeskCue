import assert from "node:assert/strict";
import test from "node:test";

import type { AgentTranscriptEntry } from "@deskcue/protocol";

import {
  buildCodexTranscriptWindowSessionId,
  readCodexTranscriptEntryRefs,
  readCodexTranscriptWindowEntryRef,
  trimIncrementalTranscript
} from "./codexTranscriptProjection.ts";

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
