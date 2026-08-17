import type { AgentTranscriptEntry, TranscriptPart } from "@deskcue/protocol";

import type { IndexedTranscriptActivityKind } from "../index/codexTranscriptLineIndex.ts";

function readEntryKind(entry: AgentTranscriptEntry): IndexedTranscriptActivityKind {
  if (entry.parts?.some((part) => part.type === "diff")) return "changes";
  return entry.role === "tool" ? "tools" : "details";
}

function canMergeEntries(left: AgentTranscriptEntry, right: AgentTranscriptEntry) {
  const leftRange = left.sourceEntryRanges?.[0];
  const rightRange = right.sourceEntryRanges?.[0];
  return Boolean(
    leftRange &&
    rightRange &&
    left.role === right.role &&
    leftRange.prefix === rightRange.prefix &&
    leftRange.end + 1 === rightRange.start &&
    readEntryKind(left) === readEntryKind(right)
  );
}

function buildEntryId(sessionId: string, startLineIndex: number, endLineIndex: number) {
  const startEntryId = `${sessionId}-${startLineIndex}`;
  const endEntryId = `${sessionId}-${endLineIndex}`;
  return startLineIndex === endLineIndex
    ? `${startEntryId}:compact`
    : `${startEntryId}:compact:${endEntryId}`;
}

export function createCompactIndexedTranscriptEntry({
  kind,
  lineIndex,
  sessionId,
  timestamp
}: {
  kind: IndexedTranscriptActivityKind;
  lineIndex: number;
  sessionId: string;
  timestamp: string;
}): AgentTranscriptEntry {
  const sourceEntryRanges = [{ end: lineIndex, prefix: `${sessionId}-`, start: lineIndex }];
  if (kind === "changes") {
    return {
      id: buildEntryId(sessionId, lineIndex, lineIndex),
      timestamp,
      role: "tool",
      text: "Changes hidden in live view",
      phase: null,
      isCompact: true,
      sourceEntryCount: 1,
      sourceEntryRanges,
      parts: [{
        type: "diff",
        title: "Changes",
        text: "[diff hidden in live view]",
        filePath: null,
        changeType: "unknown",
        additions: 0,
        deletions: 0
      }]
    };
  }
  const label = kind === "tools" ? "Tool events" : "Details";
  return {
    id: buildEntryId(sessionId, lineIndex, lineIndex),
    timestamp,
    role: kind === "tools" ? "tool" : "system",
    text: kind === "tools" ? "Tool entry hidden in live view" : "Detail hidden in live view",
    phase: null,
    isCompact: true,
    sourceEntryCount: 1,
    sourceEntryRanges,
    parts: [{
      type: "status",
      label,
      detail: kind === "tools"
        ? "1 tool entry loads when this activity is opened"
        : "1 detail entry loads when this activity is opened"
    }]
  };
}

export function createCompactIndexedTranscriptEntryRange({
  endLineIndex,
  kind,
  sessionId,
  startLineIndex,
  timestamp
}: {
  endLineIndex: number;
  kind: IndexedTranscriptActivityKind;
  sessionId: string;
  startLineIndex: number;
  timestamp: string;
}) {
  if (startLineIndex === endLineIndex) {
    return createCompactIndexedTranscriptEntry({ kind, lineIndex: startLineIndex, sessionId, timestamp });
  }
  const sourceEntryCount = endLineIndex - startLineIndex + 1;
  const sourceEntryRanges = [{ end: endLineIndex, prefix: `${sessionId}-`, start: startLineIndex }];
  if (kind === "changes") {
    return {
      id: buildEntryId(sessionId, startLineIndex, endLineIndex),
      timestamp,
      role: "tool" as const,
      text: `${sourceEntryCount} changes hidden in live view`,
      phase: null,
      isCompact: true,
      sourceEntryCount,
      sourceEntryRanges,
      parts: [{
        type: "diff" as const,
        title: "Changes",
        text: "[diff hidden in live view]",
        filePath: null,
        changeType: "unknown" as const,
        additions: 0,
        deletions: 0
      }]
    };
  }
  const label = kind === "tools" ? "Tool events" : "Details";
  return {
    id: buildEntryId(sessionId, startLineIndex, endLineIndex),
    timestamp,
    role: kind === "tools" ? "tool" as const : "system" as const,
    text: kind === "tools"
      ? `${sourceEntryCount} tool entries hidden in live view`
      : `${sourceEntryCount} detail entries hidden in live view`,
    phase: null,
    isCompact: true,
    sourceEntryCount,
    sourceEntryRanges,
    parts: [{
      type: "status" as const,
      label,
      detail: kind === "tools"
        ? `${sourceEntryCount} tool entries load when this activity is opened`
        : `${sourceEntryCount} detail entries load when this activity is opened`
    }]
  };
}

export function upsertCompactIndexedTranscriptEntry(
  entries: AgentTranscriptEntry[],
  entry: AgentTranscriptEntry
) {
  const previousEntry = entries[entries.length - 1];
  if (!previousEntry || !canMergeEntries(previousEntry, entry)) {
    entries.push(entry);
    return;
  }
  const previousRange = previousEntry.sourceEntryRanges?.[0];
  const nextRange = entry.sourceEntryRanges?.[0];
  if (!previousRange || !nextRange) {
    entries.push(entry);
    return;
  }
  const sourceEntryCount = previousRange.end - previousRange.start + 2;
  const label = previousEntry.parts?.find((part) => part.type === "status")?.label;
  const parts = previousEntry.parts?.map((part): TranscriptPart => {
    if (part.type === "status") {
      return { ...part, detail: `${sourceEntryCount} entries load when this activity is opened` };
    }
    return part;
  });
  entries[entries.length - 1] = {
    ...previousEntry,
    id: buildEntryId(previousRange.prefix.slice(0, -1), previousRange.start, nextRange.end),
    timestamp: entry.timestamp,
    text: label === "Tool events"
      ? `${sourceEntryCount} tool entries hidden in live view`
      : label === "Details"
        ? `${sourceEntryCount} detail entries hidden in live view`
        : `${sourceEntryCount} changes hidden in live view`,
    sourceEntryCount,
    sourceEntryRanges: [{ ...previousRange, end: nextRange.end }],
    parts
  };
}
