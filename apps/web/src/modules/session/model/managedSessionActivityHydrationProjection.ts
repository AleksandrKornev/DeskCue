import type {
  AgentTranscriptChangesResponse,
  AgentTranscriptSourceRefs
} from "@deskcue/protocol";
import { expandAgentTranscriptSourceRanges } from "@deskcue/protocol";
import type {
  ChatTranscriptEntry,
  ConversationActivity
} from "@modules/session/types";

import type { ActivityHydrationReader } from "./managedSessionActivityHydrationCache";
import { MAX_HYDRATED_ACTIVITY_CACHE_ENTRIES } from "./managedSessionActivityHydrationCache";

export function readActivityChangesSourceRefs(
  activity: ConversationActivity
): AgentTranscriptSourceRefs {
  return {
    sourceEntryCount: activity.sourceEntryCount,
    sourceEntryIds: activity.sourceEntryIds?.length
      ? activity.sourceEntryIds
      : activity.sourceEntryRanges?.length || activity.sourceEntrySpans?.length
        ? undefined
        : activity.entryIds,
    sourceEntryRanges: activity.sourceEntryRanges,
    sourceEntrySpans: activity.sourceEntrySpans
  };
}

function expandTailAgentTranscriptSourceRanges(
  ranges: NonNullable<ConversationActivity["sourceEntryRanges"]>,
  limit: number
) {
  if (limit <= 0 || ranges.length === 0) {
    return [];
  }

  const entryIds: string[] = [];
  for (let rangeIndex = ranges.length - 1; rangeIndex >= 0 && entryIds.length < limit; rangeIndex -= 1) {
    const range = ranges[rangeIndex];
    for (let lineIndex = range.end; lineIndex >= range.start && entryIds.length < limit; lineIndex -= 1) {
      entryIds.push(`${range.prefix}${lineIndex}`);
    }
  }

  return entryIds.reverse();
}

function readHydrationEntryIds(entry: ChatTranscriptEntry, limit: number) {
  if (!entry.isCompact) {
    return [];
  }

  return entry.sourceEntryIds?.length
    ? entry.sourceEntryIds.slice(-limit)
    : [
        ...expandTailAgentTranscriptSourceRanges(
          [...(entry.sourceEntryRanges ?? []), ...(entry.sourceEntrySpans ?? [])],
          limit
        ),
        ...(entry.sourceEntryRanges?.length || entry.sourceEntrySpans?.length ? [] : [entry.id])
      ].slice(-limit);
}

export function readActivityHydrationEntryIds(
  activity: ConversationActivity,
  limit = MAX_HYDRATED_ACTIVITY_CACHE_ENTRIES
) {
  if (limit <= 0) {
    return [];
  }

  const explicitSourceEntryIds = activity.sourceEntryIds ?? [];
  const rangedSourceEntryIds = expandTailAgentTranscriptSourceRanges(
    [
      ...(activity.sourceEntryRanges ?? []),
      ...(activity.sourceEntrySpans ?? [])
    ],
    limit
  );
  const sourceEntryIds = [
    ...explicitSourceEntryIds.slice(-Math.max(0, limit - rangedSourceEntryIds.length)),
    ...rangedSourceEntryIds
  ];

  return sourceEntryIds.length > 0
    ? Array.from(new Set(sourceEntryIds)).slice(-limit)
    : activity.entries.flatMap((entry) => readHydrationEntryIds(entry, limit)).slice(-limit);
}

function createActivityHydrationStatusEntry({
  activity,
  detail,
  label
}: {
  activity: Pick<ConversationActivity, "id" | "timestamp">;
  detail: string;
  label: string;
}): ChatTranscriptEntry {
  return {
    id: `${activity.id}:hydration-status`,
    timestamp: activity.timestamp,
    role: "system",
    text: `${label}\n${detail}`,
    phase: null,
    parts: [{ type: "status", label, detail }]
  };
}

function createChangesTranscriptEntry(
  activity: ConversationActivity,
  changes: AgentTranscriptChangesResponse
): ChatTranscriptEntry {
  const diffParts = changes.files.flatMap((file) => file.parts);
  if (diffParts.length === 0) {
    return createActivityHydrationStatusEntry({
      activity,
      detail: "No changed file details are available for this activity.",
      label: "No changed files"
    });
  }

  return {
    id: `${activity.id}:changes`,
    timestamp: activity.timestamp,
    role: "tool",
    text: diffParts.map((part) => part.text).join("\n\n"),
    phase: null,
    parts: diffParts
  };
}

function createUnavailableEntry(
  activity: Pick<ConversationActivity, "id" | "timestamp">,
  subject: string
) {
  return createActivityHydrationStatusEntry({
    activity,
    detail: `DeskCue could not load ${subject}. Check the host connection and retry.`,
    label: "Details unavailable"
  });
}

function dedupeTranscriptEntriesById(entries: ChatTranscriptEntry[]) {
  if (entries.length <= 1) {
    return entries;
  }

  const seenEntryIds = new Set<string>();
  return entries.filter((entry) => {
    if (seenEntryIds.has(entry.id)) {
      return false;
    }
    seenEntryIds.add(entry.id);
    return true;
  });
}

function readEntrySourceEntryIds(entry: ChatTranscriptEntry) {
  return entry.sourceEntryIds?.length
    ? entry.sourceEntryIds
    : expandAgentTranscriptSourceRanges(entry.sourceEntryRanges, MAX_HYDRATED_ACTIVITY_CACHE_ENTRIES);
}

function hasDiffPart(entry: ChatTranscriptEntry) {
  return entry.parts?.some((part) => part.type === "diff") ?? false;
}

function readHydratedActivityEntry(
  entry: ChatTranscriptEntry,
  hydrationReader: ActivityHydrationReader
): ChatTranscriptEntry[] {
  const sourceEntryIds = readEntrySourceEntryIds(entry);
  if (sourceEntryIds.length === 0) {
    const hydratedEntry = hydrationReader.readEntry(entry.id);
    if (hydratedEntry) {
      return [hydratedEntry];
    }

    return hydrationReader.hasFailedEntry(entry.id)
      ? [createUnavailableEntry(entry, "this activity entry")]
      : [entry];
  }

  const hydratedEntries = hydrationReader.readEntries(sourceEntryIds);
  if (hydratedEntries.length === 0) {
    return sourceEntryIds.every((entryId) => hydrationReader.hasFailedEntry(entryId))
      ? [createUnavailableEntry(entry, "these activity entries")]
      : [entry];
  }

  if (hasDiffPart(entry) && hydratedEntries.some(hasDiffPart)) {
    return hydratedEntries;
  }

  return hydratedEntries.length === sourceEntryIds.length
    ? hydratedEntries
    : [...hydratedEntries, entry];
}

export function readHydratedActivityEntries(
  activity: ConversationActivity,
  hydrationReader: ActivityHydrationReader
) {
  if (activity.kind === "changes") {
    const changes = hydrationReader.readChanges(
      activity.id,
      readActivityChangesSourceRefs(activity)
    );
    return changes ? [createChangesTranscriptEntry(activity, changes)] : activity.entries;
  }

  const activitySourceEntryIds = readActivityHydrationEntryIds(activity);
  if (activitySourceEntryIds.length > 0) {
    const hydratedEntries = hydrationReader.readEntries(activitySourceEntryIds);
    if (hydratedEntries.length === 0) {
      return hydrationReader.hasFailedEntries(activitySourceEntryIds)
        ? [createUnavailableEntry(activity, "these activity entries")]
        : activity.entries;
    }

    return dedupeTranscriptEntriesById([...hydratedEntries, ...activity.entries]);
  }

  return dedupeTranscriptEntriesById(
    activity.entries.flatMap((entry) => readHydratedActivityEntry(entry, hydrationReader))
  );
}

function isEntryHydrationFailed(
  entry: ChatTranscriptEntry,
  hydrationReader: ActivityHydrationReader
) {
  const sourceEntryIds = readEntrySourceEntryIds(entry);
  return sourceEntryIds.length > 0
    ? sourceEntryIds.every((entryId) => hydrationReader.hasFailedEntry(entryId))
    : hydrationReader.hasFailedEntry(entry.id);
}

function isActivityHydrationFailed(
  activity: ConversationActivity,
  hydrationReader: ActivityHydrationReader
) {
  const sourceEntryIds = readActivityHydrationEntryIds(activity);
  if (sourceEntryIds.length > 0) {
    return hydrationReader.hasFailedEntries(sourceEntryIds);
  }

  return activity.entries.some((entry) => isEntryHydrationFailed(entry, hydrationReader));
}

export function readActivityHydrationErrorLabel(
  activity: ConversationActivity,
  hydrationReader: ActivityHydrationReader
) {
  if (activity.kind === "changes") {
    return hydrationReader.hasFailedChanges(
      activity.id,
      readActivityChangesSourceRefs(activity)
    )
      ? "Changes unavailable. Check the host connection, then collapse and open this block again."
      : null;
  }

  return isActivityHydrationFailed(activity, hydrationReader)
    ? "Activity details unavailable. Check the host connection, then collapse and open this block again."
    : null;
}
