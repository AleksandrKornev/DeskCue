import { createHash } from "node:crypto";

import {
  compactAgentTranscriptSourceRefs,
  countAgentTranscriptSourceRefs,
  expandAgentTranscriptSourceRanges
} from "@deskcue/protocol";
import type {
  AgentTranscriptActivityGroup,
  AgentTranscriptActivityKind,
  AgentTranscriptEntry,
  AgentTranscriptViewItem,
  AgentTranscriptViewResponse
} from "@deskcue/protocol";

import {
  groupDiffPartsByFile,
  hasHiddenDiffPlaceholders,
  readDiffParts
} from "./agentTranscriptChanges.ts";

type ActivityTimelineItem = Extract<AgentTranscriptViewItem, { type: "activity" }>;

const activityKindOrder: Record<AgentTranscriptActivityKind, number> = {
  context: 0,
  model: 1,
  details: 2,
  tools: 3,
  changes: 4
};

function stripActivityEntrySourceEntryIds(entries: AgentTranscriptEntry[]) {
  return entries.map((entry) => {
    if (
      entry.sourceEntryIds?.length ||
      entry.sourceEntryRanges?.length ||
      entry.sourceEntrySpans?.length ||
      entry.sourceEntryCount !== undefined
    ) {
      const {
        sourceEntryCount: _sourceEntryCount,
        sourceEntryIds: _sourceEntryIds,
        sourceEntryRanges: _sourceEntryRanges,
        sourceEntrySpans: _sourceEntrySpans,
        ...strippedEntry
      } = entry;

      return strippedEntry;
    }

    return entry;
  });
}

function buildActivityGroupId(
  kind: AgentTranscriptActivityKind,
  sourceEntryIds: string[],
  fallback: string
) {
  // An activity group grows while an agent is working. Its display identity must
  // stay anchored to the first source event: the full list is mutable and using
  // it here remounts the group (and drops hydrated Changes) on every append.
  const sourceKey = sourceEntryIds[0] ?? fallback;
  const digest = createHash("sha1")
    .update(kind)
    .update("\0")
    .update(sourceKey)
    .digest("hex")
    .slice(0, 16);

  return `${kind}-${digest}`;
}

function countSourceTranscriptEntries(
  entries: AgentTranscriptEntry[],
  sourceEntryIds: string[] = []
) {
  if (sourceEntryIds.length > 0) {
    return sourceEntryIds.length;
  }

  return entries.reduce(
    (count, entry) => count + Math.max(1, countAgentTranscriptSourceRefs(entry)),
    0
  );
}

function buildConversationActivityLabel(
  kind: AgentTranscriptActivityKind,
  entries: AgentTranscriptEntry[],
  sourceEntryIds: string[]
) {
  const entryCount = countSourceTranscriptEntries(entries, sourceEntryIds);

  if (kind === "changes") {
    const diffParts = readDiffParts(entries);

    if (hasHiddenDiffPlaceholders(diffParts)) {
      return "Changes";
    }

    const diffCount = groupDiffPartsByFile(diffParts).length;

    return diffCount === 1 ? "Changes (1)" : `Changes (${diffCount})`;
  }

  if (kind === "context") {
    return entryCount === 1 ? "Context compressed" : `Context compressed (${entryCount})`;
  }

  if (kind === "model") {
    return entryCount === 1 ? "Model changed" : `Model changed (${entryCount})`;
  }

  if (kind === "tools") {
    return entryCount === 1 ? "Tools (1)" : `Tools (${entryCount})`;
  }

  return entryCount === 1 ? "Details (1)" : `Details (${entryCount})`;
}

function readEntrySourceEntryIds(entry: AgentTranscriptEntry) {
  if (entry.sourceEntryIds && entry.sourceEntryIds.length > 0) {
    return entry.sourceEntryIds;
  }

  if (entry.sourceEntryRanges && entry.sourceEntryRanges.length > 0) {
    return expandAgentTranscriptSourceRanges(entry.sourceEntryRanges);
  }

  if (entry.sourceEntrySpans && entry.sourceEntrySpans.length > 0) {
    return expandAgentTranscriptSourceRanges(entry.sourceEntrySpans);
  }

  return [entry.id];
}

function readActivitySourceEntryIds(entries: AgentTranscriptEntry[]) {
  return Array.from(new Set(entries.flatMap(readEntrySourceEntryIds)));
}

function conversationActivityKindForEntry(
  entry: AgentTranscriptEntry
): AgentTranscriptActivityKind {
  if (entry.parts?.some((part) => part.type === "diff")) {
    return "changes";
  }

  if (entry.phase === "context_compacted") {
    return "context";
  }

  if (entry.phase === "model_changed") {
    return "model";
  }

  return entry.role === "tool" ? "tools" : "details";
}

export function buildConversationActivityGroup(
  entries: AgentTranscriptEntry[],
  idPrefix: string,
  forcedKind?: AgentTranscriptActivityKind,
  sourceEntryIdsOverride?: string[]
): AgentTranscriptActivityGroup {
  const kind = forcedKind ?? conversationActivityKindForEntry(entries[0]);
  const sourceEntryIds = sourceEntryIdsOverride ?? readActivitySourceEntryIds(entries);
  const label = buildConversationActivityLabel(kind, entries, sourceEntryIds);

  return {
    id: buildActivityGroupId(kind, sourceEntryIds, idPrefix),
    kind,
    label,
    timestamp: entries[entries.length - 1]?.timestamp ?? entries[0].timestamp,
    entries: stripActivityEntrySourceEntryIds(entries),
    entryIds: entries.map((entry) => entry.id),
    sourceEntryIds
  };
}

export function buildConversationActivitiesByKind(
  entries: AgentTranscriptEntry[],
  idPrefix: string
) {
  if (entries.length === 0) {
    return [];
  }

  const groupedEntries = new Map<AgentTranscriptActivityKind, AgentTranscriptEntry[]>();

  for (const entry of entries) {
    const kind = conversationActivityKindForEntry(entry);
    const groupEntries = groupedEntries.get(kind);

    if (groupEntries) {
      groupEntries.push(entry);
    } else {
      groupedEntries.set(kind, [entry]);
    }
  }

  return Array.from(groupedEntries.entries())
    .sort(([left], [right]) => activityKindOrder[left] - activityKindOrder[right])
    .map(([kind, groupEntries]) =>
      buildConversationActivityGroup(groupEntries, idPrefix, kind)
    );
}

function compactActivityGroupSourceRefs(
  activity: AgentTranscriptActivityGroup
): AgentTranscriptActivityGroup {
  const {
    sourceEntryCount: _sourceEntryCount,
    sourceEntryIds,
    sourceEntryRanges: _sourceEntryRanges,
    sourceEntrySpans: _sourceEntrySpans,
    ...baseActivity
  } = activity;
  const sourceRefs = compactAgentTranscriptSourceRefs(sourceEntryIds ?? [], {
    allowSpans: activity.kind === "changes",
    maxSpanEntryCount: 2000
  });

  return {
    ...baseActivity,
    ...sourceRefs
  };
}

export function compactTranscriptViewSourceRefs(
  view: AgentTranscriptViewResponse
): AgentTranscriptViewResponse {
  return {
    ...view,
    items: view.items.map((item) => {
      if (item.type === "activity") {
        return {
          ...item,
          activity: compactActivityGroupSourceRefs(item.activity)
        };
      }

      return {
        ...item,
        activities: item.activities.map(compactActivityGroupSourceRefs),
        changeActivities: item.changeActivities.map(compactActivityGroupSourceRefs)
      };
    })
  };
}

function readTimestamp(value: string) {
  const parsed = new Date(value).getTime();

  return Number.isFinite(parsed) ? parsed : 0;
}

function sortConversationEntries(entries: AgentTranscriptEntry[]) {
  return [...entries].sort((left, right) => {
    const timeDelta = readTimestamp(left.timestamp) - readTimestamp(right.timestamp);

    return timeDelta === 0 ? left.id.localeCompare(right.id) : timeDelta;
  });
}

function readConversationActivitySourceEntryIds(activity: AgentTranscriptActivityGroup) {
  return [
    ...(activity.sourceEntryIds ?? []),
    ...expandAgentTranscriptSourceRanges(activity.sourceEntryRanges),
    ...expandAgentTranscriptSourceRanges(activity.sourceEntrySpans)
  ];
}

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function mergeConversationActivities(
  activities: AgentTranscriptActivityGroup[]
) {
  if (activities.length <= 1) {
    return activities;
  }

  const groupedActivities = new Map<
    AgentTranscriptActivityKind,
    AgentTranscriptActivityGroup[]
  >();

  for (const activity of activities) {
    const groupedKindActivities = groupedActivities.get(activity.kind);

    if (groupedKindActivities) {
      groupedKindActivities.push(activity);
    } else {
      groupedActivities.set(activity.kind, [activity]);
    }
  }

  return Array.from(groupedActivities.entries())
    .sort(([left], [right]) => activityKindOrder[left] - activityKindOrder[right])
    .map(([kind, groupedKindActivities]) => {
      const sourceEntryIds = dedupeStrings(
        groupedKindActivities.flatMap(readConversationActivitySourceEntryIds)
      );

      return buildConversationActivityGroup(
        sortConversationEntries(
          groupedKindActivities.flatMap((activity) => activity.entries)
        ),
        `merged:${activities[0]?.id ?? "activity"}`,
        kind,
        sourceEntryIds
      );
    });
}

function mergeActivityTimelineRun(items: ActivityTimelineItem[]): ActivityTimelineItem[] {
  return mergeConversationActivities(items.map((item) => item.activity)).map((activity) => ({
    type: "activity",
    key: activity.id,
    activity
  }));
}

function sortConversationActivityRun(items: ActivityTimelineItem[]) {
  return [...items].sort((left, right) => {
    const kindDelta =
      activityKindOrder[left.activity.kind] - activityKindOrder[right.activity.kind];
    if (kindDelta !== 0) {
      return kindDelta;
    }

    const timeDelta =
      readTimestamp(left.activity.timestamp) - readTimestamp(right.activity.timestamp);
    return timeDelta === 0 ? left.key.localeCompare(right.key) : timeDelta;
  });
}

function appendMergedActivityTimelineRun(
  orderedItems: AgentTranscriptViewItem[],
  activityRun: ActivityTimelineItem[]
) {
  if (activityRun.length === 0) return;

  orderedItems.push(...sortConversationActivityRun(mergeActivityTimelineRun(activityRun)));
}

export function orderConversationActivityRuns(items: AgentTranscriptViewItem[]) {
  const orderedItems: AgentTranscriptViewItem[] = [];
  let activityRun: ActivityTimelineItem[] = [];

  for (const item of items) {
    if (item.type === "activity") {
      activityRun.push(item);
      continue;
    }

    appendMergedActivityTimelineRun(orderedItems, activityRun);
    activityRun = [];
    orderedItems.push(item);
  }

  appendMergedActivityTimelineRun(orderedItems, activityRun);
  return orderedItems;
}
