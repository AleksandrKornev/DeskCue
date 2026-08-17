import type {
  AgentTranscriptEntry,
  AgentTranscriptSourceRange,
  AgentTranscriptSourceRefs
} from "@deskcue/protocol";

type ParsedSourceEntryId = {
  id: string;
  index: number;
  prefix: string;
};

type CompiledSourceRefs = {
  entryIds: string[];
  entryIdSet: Set<string> | null;
  parsedEntryIds: ParsedSourceEntryId[];
  ranges: AgentTranscriptSourceRange[];
};

function areSourceRangesOverlapping(
  leftRanges: AgentTranscriptSourceRange[],
  rightRanges: AgentTranscriptSourceRange[]
) {
  return leftRanges.some((leftRange) => rightRanges.some((rightRange) =>
    leftRange.prefix === rightRange.prefix &&
    leftRange.start <= rightRange.end &&
    rightRange.start <= leftRange.end
  ));
}

function isAnySourceEntryIdInRanges(
  entryIds: ParsedSourceEntryId[],
  ranges: AgentTranscriptSourceRange[]
) {
  return entryIds.some((entryId) => ranges.some((range) =>
    range.prefix === entryId.prefix &&
    entryId.index >= range.start &&
    entryId.index <= range.end
  ));
}

function doCompiledSourceRefsOverlap(left: CompiledSourceRefs, right: CompiledSourceRefs) {
  if (left.entryIds.length > 0 && right.entryIdSet) {
    for (const entryId of left.entryIds) {
      if (right.entryIdSet.has(entryId)) return true;
    }
  }

  return (
    isAnySourceEntryIdInRanges(left.parsedEntryIds, right.ranges) ||
    isAnySourceEntryIdInRanges(right.parsedEntryIds, left.ranges) ||
    areSourceRangesOverlapping(left.ranges, right.ranges)
  );
}

function parseSourceEntryId(entryId: string): ParsedSourceEntryId | null {
  const separatorIndex = entryId.lastIndexOf("-");
  if (separatorIndex < 0) return null;
  const prefix = entryId.slice(0, separatorIndex + 1);
  const index = Number(entryId.slice(separatorIndex + 1));
  if (!prefix || !Number.isInteger(index) || index < 0) return null;
  return { id: entryId, index, prefix };
}

function isValidSourceRange(range: AgentTranscriptSourceRange) {
  return (
    typeof range.prefix === "string" &&
    range.prefix.length > 0 &&
    Number.isInteger(range.start) &&
    Number.isInteger(range.end) &&
    range.start >= 0 &&
    range.end >= range.start
  );
}

function readValidSourceRanges(sourceRanges: AgentTranscriptSourceRange[] | undefined) {
  return sourceRanges?.filter(isValidSourceRange) ?? [];
}

function compileSourceRefs(sourceRefs: AgentTranscriptSourceRefs): CompiledSourceRefs {
  const entryIds = sourceRefs.sourceEntryIds ?? [];
  const ranges = [
    ...readValidSourceRanges(sourceRefs.sourceEntryRanges),
    ...readValidSourceRanges(sourceRefs.sourceEntrySpans)
  ];

  return {
    entryIds,
    entryIdSet: entryIds.length > 0 ? new Set(entryIds) : null,
    parsedEntryIds: entryIds
      .map(parseSourceEntryId)
      .filter((entryId): entryId is ParsedSourceEntryId => entryId !== null),
    ranges
  };
}

function readCompiledSourceRefs(
  sourceRefs: AgentTranscriptEntry,
  cache: WeakMap<AgentTranscriptEntry, CompiledSourceRefs>
) {
  const cached = cache.get(sourceRefs);
  if (cached) return cached;
  const compiled = compileSourceRefs(sourceRefs);
  cache.set(sourceRefs, compiled);
  return compiled;
}

function isCompactEntryWithSources(entry: AgentTranscriptEntry) {
  return entry.isCompact === true && Boolean(
    entry.sourceEntryIds?.length ||
    entry.sourceEntryRanges?.length ||
    entry.sourceEntrySpans?.length
  );
}

function pruneCoveredCompactEntries(
  entries: AgentTranscriptEntry[],
  nextEntry: AgentTranscriptEntry,
  sourceRefCache: WeakMap<AgentTranscriptEntry, CompiledSourceRefs>
) {
  const nextRefs = readCompiledSourceRefs(nextEntry, sourceRefCache);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const currentEntry = entries[index];
    if (
      currentEntry.id !== nextEntry.id &&
      isCompactEntryWithSources(currentEntry) &&
      doCompiledSourceRefsOverlap(
        readCompiledSourceRefs(currentEntry, sourceRefCache),
        nextRefs
      )
    ) {
      entries.splice(index, 1);
    }
  }
}

export function pruneOverlappingCompactTranscriptEntries(
  entries: AgentTranscriptEntry[]
) {
  const prunedEntries: AgentTranscriptEntry[] = [];
  const sourceRefCache = new WeakMap<AgentTranscriptEntry, CompiledSourceRefs>();

  for (const entry of entries) {
    if (isCompactEntryWithSources(entry)) {
      pruneCoveredCompactEntries(prunedEntries, entry, sourceRefCache);
    }
    prunedEntries.push(entry);
  }

  return prunedEntries;
}
