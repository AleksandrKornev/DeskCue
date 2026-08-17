import assert from "node:assert/strict";
import test from "node:test";

import type { AgentTranscriptEntry } from "@deskcue/protocol";

import { pruneOverlappingCompactTranscriptEntries } from "./agentTranscriptSourceRefs.ts";

function compactEntry(
  id: string,
  sourceRefs: Pick<
    AgentTranscriptEntry,
    "sourceEntryIds" | "sourceEntryRanges" | "sourceEntrySpans"
  >
): AgentTranscriptEntry {
  return {
    id,
    isCompact: true,
    phase: null,
    role: "assistant",
    text: id,
    timestamp: "2026-08-05T00:00:00.000Z",
    ...sourceRefs
  };
}

test("keeps only the newest overlapping compact transcript projection", () => {
  const older = compactEntry("older", {
    sourceEntryRanges: [{ prefix: "line-", start: 1, end: 10 }]
  });
  const newer = compactEntry("newer", {
    sourceEntryRanges: [{ prefix: "line-", start: 8, end: 15 }]
  });

  assert.deepEqual(
    pruneOverlappingCompactTranscriptEntries([older, newer]).map((entry) => entry.id),
    ["newer"]
  );
});

test("detects overlap between explicit source ids and compact ranges", () => {
  const older = compactEntry("older", { sourceEntryIds: ["line-12"] });
  const newer = compactEntry("newer", {
    sourceEntrySpans: [{ prefix: "line-", start: 10, end: 20 }]
  });

  assert.deepEqual(
    pruneOverlappingCompactTranscriptEntries([older, newer]).map((entry) => entry.id),
    ["newer"]
  );
});

test("never removes a full transcript entry that shares compact sources", () => {
  const full = {
    ...compactEntry("full", { sourceEntryIds: ["line-12"] }),
    isCompact: false
  };
  const compact = compactEntry("compact", {
    sourceEntryRanges: [{ prefix: "line-", start: 10, end: 20 }]
  });

  assert.deepEqual(
    pruneOverlappingCompactTranscriptEntries([full, compact]).map((entry) => entry.id),
    ["full", "compact"]
  );
});
