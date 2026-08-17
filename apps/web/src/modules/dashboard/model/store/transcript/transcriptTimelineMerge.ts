import type { AgentSessionDetail, AgentTranscriptEntry } from "@deskcue/protocol";
import { doAgentTranscriptSourceRefsOverlap } from "@deskcue/protocol";
import { pruneOverlappingCompactTranscriptEntries } from "@models/transcriptEntries";

import {
  areAgentTranscriptEntriesEqual,
  areSameTranscriptEntryReferences
} from "./transcriptMergeIdentity";

function compareTranscriptEntries(
  left: AgentSessionDetail["transcript"][number],
  right: AgentSessionDetail["transcript"][number]
) {
  const leftTime = new Date(left.timestamp).getTime();
  const rightTime = new Date(right.timestamp).getTime();
  if (leftTime !== rightTime && !Number.isNaN(leftTime) && !Number.isNaN(rightTime)) {
    return leftTime - rightTime;
  }

  return left.id.localeCompare(right.id);
}

function getDedupableChatEntryPartsKey(entry: AgentTranscriptEntry) {
  return (entry.parts ?? [])
    .filter((part) => part.type === "attachment")
    .map((part) => [part.kind, part.path, part.url, part.label].join(":"))
    .sort()
    .join("|");
}

function getDedupableChatEntryKey(entry: AgentTranscriptEntry) {
  return `${entry.role}:${entry.text.trim()}:${getDedupableChatEntryPartsKey(entry)}`;
}

function haveDuplicateChatContent(
  previousEntry: AgentTranscriptEntry,
  nextEntry: AgentTranscriptEntry
) {
  const previousText = previousEntry.text.trim();
  const nextText = nextEntry.text.trim();
  if (!previousText || previousEntry.role !== nextEntry.role || previousText !== nextText) {
    return false;
  }

  if (getDedupableChatEntryPartsKey(previousEntry) !== getDedupableChatEntryPartsKey(nextEntry)) {
    return false;
  }

  const previousTimestamp = Date.parse(previousEntry.timestamp);
  const nextTimestamp = Date.parse(nextEntry.timestamp);
  if (!Number.isFinite(previousTimestamp) || !Number.isFinite(nextTimestamp)) {
    return false;
  }

  return Math.abs(nextTimestamp - previousTimestamp) <= 5000;
}

function isDedupableChatEntry(entry: AgentTranscriptEntry) {
  return entry.role === "user" || entry.role === "assistant";
}

function findDuplicateChatEntryIndex(
  indexesByKey: Map<string, number>,
  entries: AgentTranscriptEntry[],
  nextEntry: AgentTranscriptEntry
) {
  if (!isDedupableChatEntry(nextEntry)) {
    return null;
  }

  const duplicateIndex = indexesByKey.get(getDedupableChatEntryKey(nextEntry));
  if (duplicateIndex === undefined) {
    return null;
  }

  const duplicateEntry = entries[duplicateIndex];
  return duplicateEntry && haveDuplicateChatContent(duplicateEntry, nextEntry)
    ? duplicateIndex
    : null;
}

function mergeAgentTranscriptParts(
  leftParts: AgentTranscriptEntry["parts"],
  rightParts: AgentTranscriptEntry["parts"]
) {
  const merged: NonNullable<AgentTranscriptEntry["parts"]> = [];
  const seen = new Set<string>();

  for (const part of [...(leftParts ?? []), ...(rightParts ?? [])]) {
    const key = JSON.stringify(part);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(part);
  }

  return merged.length > 0 ? merged : undefined;
}

function mergeDuplicateAgentTranscriptEntries(
  previousEntry: AgentTranscriptEntry,
  nextEntry: AgentTranscriptEntry
) {
  return {
    ...previousEntry,
    text: nextEntry.text.length > previousEntry.text.length
      ? nextEntry.text
      : previousEntry.text,
    parts: mergeAgentTranscriptParts(previousEntry.parts, nextEntry.parts)
  };
}

function rememberDedupedChatEntry(
  indexesByKey: Map<string, number>,
  entry: AgentTranscriptEntry,
  index: number
) {
  if (isDedupableChatEntry(entry)) {
    indexesByKey.set(getDedupableChatEntryKey(entry), index);
  }
}

function shouldMergeDuplicateAgentTranscriptEntries(
  previousEntry: AgentTranscriptEntry | undefined,
  nextEntry: AgentTranscriptEntry
) {
  if (!previousEntry || !isDedupableChatEntry(previousEntry) || !isDedupableChatEntry(nextEntry)) {
    return false;
  }

  return haveDuplicateChatContent(previousEntry, nextEntry);
}

function dedupeMergedAgentTranscriptEntries(entries: AgentTranscriptEntry[]) {
  const deduped: AgentTranscriptEntry[] = [];
  const recentChatEntryIndexesByKey = new Map<string, number>();

  for (const entry of entries) {
    const previousEntry = deduped[deduped.length - 1];
    if (shouldMergeDuplicateAgentTranscriptEntries(previousEntry, entry)) {
      deduped[deduped.length - 1] = mergeDuplicateAgentTranscriptEntries(previousEntry, entry);
      rememberDedupedChatEntry(
        recentChatEntryIndexesByKey,
        deduped[deduped.length - 1],
        deduped.length - 1
      );
      continue;
    }

    const duplicateIndex = findDuplicateChatEntryIndex(
      recentChatEntryIndexesByKey,
      deduped,
      entry
    );
    if (duplicateIndex !== null) {
      deduped[duplicateIndex] = mergeDuplicateAgentTranscriptEntries(
        deduped[duplicateIndex],
        entry
      );
      rememberDedupedChatEntry(
        recentChatEntryIndexesByKey,
        deduped[duplicateIndex],
        duplicateIndex
      );
      continue;
    }

    deduped.push(entry);
    rememberDedupedChatEntry(recentChatEntryIndexesByKey, entry, deduped.length - 1);
  }

  return deduped;
}

function pruneOverlappingCompactEntriesById(
  entriesById: Map<string, AgentTranscriptEntry>,
  nextEntry: AgentTranscriptEntry
) {
  if (
    !nextEntry.isCompact ||
    (
      !nextEntry.sourceEntryIds?.length &&
      !nextEntry.sourceEntryRanges?.length &&
      !nextEntry.sourceEntrySpans?.length
    )
  ) {
    return false;
  }

  let pruned = false;
  for (const [entryId, entry] of entriesById) {
    if (
      entryId !== nextEntry.id &&
      entry.isCompact &&
      doAgentTranscriptSourceRefsOverlap(entry, nextEntry)
    ) {
      entriesById.delete(entryId);
      pruned = true;
    }
  }

  return pruned;
}

export function mergeAgentTranscriptEntries(
  current: AgentTranscriptEntry[],
  next: AgentTranscriptEntry[]
) {
  if (current.length === 0 || current === next) {
    return next;
  }

  if (next.length === 0) {
    return current;
  }

  const entriesById = new Map<string, AgentSessionDetail["transcript"][number]>();
  for (const entry of current) {
    entriesById.set(entry.id, entry);
  }

  let hasChanges = false;
  for (const entry of next) {
    hasChanges = pruneOverlappingCompactEntriesById(entriesById, entry) || hasChanges;

    const currentEntry = entriesById.get(entry.id);
    const mergedEntry =
      currentEntry && areAgentTranscriptEntriesEqual(currentEntry, entry)
        ? currentEntry
        : entry;

    if (mergedEntry !== currentEntry) {
      hasChanges = true;
    }

    entriesById.set(entry.id, mergedEntry);
  }

  const mergedEntries = dedupeMergedAgentTranscriptEntries(
    pruneOverlappingCompactTranscriptEntries(
      Array.from(entriesById.values()).sort(compareTranscriptEntries)
    )
  );

  return !hasChanges && areSameTranscriptEntryReferences(current, mergedEntries)
    ? current
    : mergedEntries;
}
