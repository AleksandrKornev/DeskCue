import type {
  AgentTranscriptActivityGroup,
  AgentTranscriptEntry,
  AgentTranscriptSourceRange,
  AgentTranscriptViewItem
} from "@deskcue/protocol";

function readTranscriptSourceEntryLineRef(sourceEntryId: string) {
  const separatorIndex = sourceEntryId.lastIndexOf("-");
  if (separatorIndex < 0 || separatorIndex === sourceEntryId.length - 1) {
    return null;
  }

  const lineIndex = Number(sourceEntryId.slice(separatorIndex + 1));
  return Number.isInteger(lineIndex) && lineIndex >= 0
    ? {
        lineIndex,
        prefix: sourceEntryId.slice(0, separatorIndex + 1)
      }
    : null;
}

function isTranscriptSourceEntryIdInRanges(
  sourceEntryId: string,
  ranges: AgentTranscriptSourceRange[] | undefined
) {
  const parsed = readTranscriptSourceEntryLineRef(sourceEntryId);
  if (!parsed || !ranges?.length) {
    return false;
  }

  return ranges.some((range) =>
    range.prefix === parsed.prefix &&
    parsed.lineIndex >= range.start &&
    parsed.lineIndex <= range.end
  );
}

function doesTranscriptSourceRefsReferenceEntry(
  sourceRefs: Pick<
    AgentTranscriptActivityGroup | AgentTranscriptEntry,
    "sourceEntryIds" | "sourceEntryRanges" | "sourceEntrySpans"
  >,
  sourceEntryId: string
) {
  return sourceRefs.sourceEntryIds?.includes(sourceEntryId) === true ||
    isTranscriptSourceEntryIdInRanges(sourceEntryId, sourceRefs.sourceEntryRanges) ||
    isTranscriptSourceEntryIdInRanges(sourceEntryId, sourceRefs.sourceEntrySpans);
}

export function doesTranscriptWindowReferenceSourceEntry(
  entries: AgentTranscriptEntry[],
  sourceEntryId: string
) {
  return entries.some((entry) =>
    entry.id === sourceEntryId ||
    doesTranscriptSourceRefsReferenceEntry(entry, sourceEntryId)
  );
}

function doesTranscriptActivityReferenceSourceEntry(
  activity: AgentTranscriptActivityGroup,
  sourceEntryId: string
) {
  return activity.entryIds.includes(sourceEntryId) ||
    doesTranscriptSourceRefsReferenceEntry(activity, sourceEntryId);
}

export function doesTranscriptViewItemReferenceSourceEntry(
  item: AgentTranscriptViewItem,
  sourceEntryId: string
) {
  if (item.type === "activity") {
    return doesTranscriptActivityReferenceSourceEntry(item.activity, sourceEntryId);
  }

  return item.entry.id === sourceEntryId ||
    doesTranscriptSourceRefsReferenceEntry(item.entry, sourceEntryId) ||
    item.activities.some((activity) =>
      doesTranscriptActivityReferenceSourceEntry(activity, sourceEntryId)
    ) ||
    item.changeActivities.some((activity) =>
      doesTranscriptActivityReferenceSourceEntry(activity, sourceEntryId)
    );
}
