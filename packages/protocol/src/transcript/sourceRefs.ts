export interface AgentTranscriptSourceRange {
  prefix: string;
  start: number;
  end: number;
}

export interface AgentTranscriptSourceRefs {
  sourceEntryIds?: string[];
  sourceEntryRanges?: AgentTranscriptSourceRange[];
  sourceEntrySpans?: AgentTranscriptSourceRange[];
  sourceEntryCount?: number;
}

const DEFAULT_SOURCE_REF_COMPACT_MIN_COUNT = 8;

type ParsedSourceEntryId = { index: number; prefix: string };

export function compactAgentTranscriptSourceRefs(
  sourceEntryIds: string[],
  options: { allowSpans?: boolean; maxSpanEntryCount?: number; minCount?: number } = {}
): AgentTranscriptSourceRefs {
  const uniqueSourceEntryIds = Array.from(new Set(sourceEntryIds.filter(Boolean)));
  const sourceEntryCount = uniqueSourceEntryIds.length;
  if (sourceEntryCount === 0) return { sourceEntryCount: 0 };

  const parsedEntryIds = uniqueSourceEntryIds.map(parseSourceEntryId);
  if (
    sourceEntryCount < (options.minCount ?? DEFAULT_SOURCE_REF_COMPACT_MIN_COUNT) ||
    parsedEntryIds.some((entryId) => entryId === null)
  ) {
    return { sourceEntryIds: uniqueSourceEntryIds, sourceEntryCount };
  }

  const parsed = parsedEntryIds as ParsedSourceEntryId[];
  const sourceEntryRanges = buildSourceRanges(parsed);
  const sourceEntryIdsJsonLength = JSON.stringify(uniqueSourceEntryIds).length;
  if (JSON.stringify(sourceEntryRanges).length < sourceEntryIdsJsonLength) {
    return { sourceEntryRanges, sourceEntryCount };
  }

  if (options.allowSpans) {
    const sourceEntrySpans = buildSourceSpans(parsed);
    const spanEntryCount = sourceEntrySpans.reduce((count, span) => count + countRangeEntries(span), 0);
    if (
      spanEntryCount <= (options.maxSpanEntryCount ?? Number.MAX_SAFE_INTEGER) &&
      JSON.stringify(sourceEntrySpans).length < sourceEntryIdsJsonLength
    ) {
      return { sourceEntrySpans, sourceEntryCount };
    }
  }

  return { sourceEntryIds: uniqueSourceEntryIds, sourceEntryCount };
}

export function expandAgentTranscriptSourceRanges(
  sourceEntryRanges: AgentTranscriptSourceRange[] | undefined,
  maxEntryCount = Number.MAX_SAFE_INTEGER
) {
  if (!sourceEntryRanges?.length || maxEntryCount <= 0) return [];
  const entryIds: string[] = [];
  for (const range of sourceEntryRanges) {
    if (!isValidRange(range)) continue;
    for (let index = range.start; index <= range.end; index += 1) {
      entryIds.push(`${range.prefix}${index}`);
      if (entryIds.length >= maxEntryCount) return entryIds;
    }
  }
  return entryIds;
}

export function countAgentTranscriptSourceRefs(sourceRefs: AgentTranscriptSourceRefs) {
  if (typeof sourceRefs.sourceEntryCount === "number" && sourceRefs.sourceEntryCount >= 0) {
    return sourceRefs.sourceEntryCount;
  }
  return (
    (sourceRefs.sourceEntryIds?.length ?? 0) +
    (sourceRefs.sourceEntryRanges ?? []).reduce((count, range) => count + countRangeEntries(range), 0) +
    (sourceRefs.sourceEntrySpans ?? []).reduce((count, span) => count + countRangeEntries(span), 0)
  );
}

export function buildAgentTranscriptSourceRefsKey(sourceRefs: AgentTranscriptSourceRefs) {
  const idKey = sourceRefs.sourceEntryIds?.length ? [...sourceRefs.sourceEntryIds].sort().join(",") : "";
  const rangeKey = buildRangeKey(sourceRefs.sourceEntryRanges, "");
  const spanKey = buildRangeKey(sourceRefs.sourceEntrySpans, "span:");
  return [idKey, rangeKey, spanKey].filter(Boolean).join(",");
}

export function doAgentTranscriptSourceRefsOverlap(
  left: AgentTranscriptSourceRefs,
  right: AgentTranscriptSourceRefs
) {
  const leftEntryIds = left.sourceEntryIds ?? [];
  const rightEntryIds = right.sourceEntryIds ?? [];
  if (leftEntryIds.length > 0 && rightEntryIds.length > 0) {
    const smaller = leftEntryIds.length <= rightEntryIds.length ? leftEntryIds : rightEntryIds;
    const larger = smaller === leftEntryIds ? rightEntryIds : leftEntryIds;
    const smallerSet = new Set(smaller);
    if (larger.some((entryId) => smallerSet.has(entryId))) return true;
  }
  return idsOverlapRanges(leftEntryIds, right) || idsOverlapRanges(rightEntryIds, left) || refsRangesOverlap(left, right);
}

function buildRangeKey(ranges: AgentTranscriptSourceRange[] | undefined, prefix: string) {
  if (!ranges?.length) return "";
  return [...ranges]
    .filter(isValidRange)
    .sort((left, right) => left.prefix.localeCompare(right.prefix) || left.start - right.start)
    .map((range) => `${prefix}${range.prefix}${range.start}..${range.end}`)
    .join(",");
}

function parseSourceEntryId(entryId: string): ParsedSourceEntryId | null {
  const separatorIndex = entryId.lastIndexOf("-");
  if (separatorIndex < 0) return null;
  const prefix = entryId.slice(0, separatorIndex + 1);
  const index = Number(entryId.slice(separatorIndex + 1));
  return prefix && Number.isInteger(index) && index >= 0 ? { index, prefix } : null;
}

function buildSourceRanges(entries: ParsedSourceEntryId[]) {
  const sorted = [...entries].sort((left, right) => left.prefix.localeCompare(right.prefix) || left.index - right.index);
  const ranges: AgentTranscriptSourceRange[] = [];
  for (const entry of sorted) {
    const last = ranges[ranges.length - 1];
    if (last?.prefix === entry.prefix && last.end + 1 >= entry.index) {
      last.end = Math.max(last.end, entry.index);
    } else {
      ranges.push({ prefix: entry.prefix, start: entry.index, end: entry.index });
    }
  }
  return ranges;
}

function buildSourceSpans(entries: ParsedSourceEntryId[]) {
  const spans = new Map<string, AgentTranscriptSourceRange>();
  for (const entry of entries) {
    const span = spans.get(entry.prefix);
    if (!span) spans.set(entry.prefix, { prefix: entry.prefix, start: entry.index, end: entry.index });
    else {
      span.start = Math.min(span.start, entry.index);
      span.end = Math.max(span.end, entry.index);
    }
  }
  return Array.from(spans.values()).sort((left, right) => left.prefix.localeCompare(right.prefix) || left.start - right.start);
}

function isValidRange(range: AgentTranscriptSourceRange) {
  return typeof range.prefix === "string" && range.prefix.length > 0 &&
    Number.isInteger(range.start) && Number.isInteger(range.end) && range.start >= 0 && range.end >= range.start;
}

function countRangeEntries(range: AgentTranscriptSourceRange) {
  return isValidRange(range) ? range.end - range.start + 1 : 0;
}

function isEntryIdInRanges(entryId: string, ranges: AgentTranscriptSourceRange[]) {
  const parsed = parseSourceEntryId(entryId);
  return parsed !== null && ranges.some((range) => isValidRange(range) && range.prefix === parsed.prefix && parsed.index >= range.start && parsed.index <= range.end);
}

function idsOverlapRanges(entryIds: string[], refs: AgentTranscriptSourceRefs) {
  return entryIds.some((entryId) => isEntryIdInRanges(entryId, refs.sourceEntryRanges ?? []) || isEntryIdInRanges(entryId, refs.sourceEntrySpans ?? []));
}

function refsRangesOverlap(left: AgentTranscriptSourceRefs, right: AgentTranscriptSourceRefs) {
  return rangeListsOverlap(left.sourceEntryRanges, right.sourceEntryRanges) ||
    rangeListsOverlap(left.sourceEntryRanges, right.sourceEntrySpans) ||
    rangeListsOverlap(left.sourceEntrySpans, right.sourceEntryRanges) ||
    rangeListsOverlap(left.sourceEntrySpans, right.sourceEntrySpans);
}

function rangeListsOverlap(
  leftRanges: AgentTranscriptSourceRange[] | undefined,
  rightRanges: AgentTranscriptSourceRange[] | undefined
) {
  if (!leftRanges?.length || !rightRanges?.length) return false;
  return leftRanges.some((left) => isValidRange(left) && rightRanges.some((right) =>
    isValidRange(right) && left.prefix === right.prefix && left.start <= right.end && right.start <= left.end
  ));
}
