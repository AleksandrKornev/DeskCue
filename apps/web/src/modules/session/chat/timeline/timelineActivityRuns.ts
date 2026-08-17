import {
  buildAgentTranscriptSourceRefsKey,
  countAgentTranscriptSourceRefs
} from "@deskcue/protocol";
import type {
  ChatTranscriptEntry,
  ConversationActivity,
  ConversationTimelineItem
} from "@modules/session/types";

const activityKindOrder: Record<ConversationActivity["kind"], number> = {
  context: 0,
  model: 1,
  details: 2,
  tools: 3,
  changes: 4
};

type ActivityTimelineItem = Extract<ConversationTimelineItem, { type: "activity" }>;

function readTimestamp(value: string) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortConversationActivityRun(
  items: ActivityTimelineItem[]
) {
  return [...items].sort((left, right) => {
    const kindDelta =
      activityKindOrder[left.activity.kind] - activityKindOrder[right.activity.kind];
    if (kindDelta !== 0) {
      return kindDelta;
    }

    const timeDelta =
      readTimestamp(left.activity.timestamp) -
      readTimestamp(right.activity.timestamp);
    return timeDelta === 0 ? left.key.localeCompare(right.key) : timeDelta;
  });
}

function dedupeEntriesById(entries: ChatTranscriptEntry[]) {
  const entriesById = new Map<string, ChatTranscriptEntry>();
  for (const entry of entries) {
    entriesById.set(entry.id, entry);
  }

  return Array.from(entriesById.values()).sort(
    (left, right) => readTimestamp(left.timestamp) - readTimestamp(right.timestamp)
  );
}

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function readConversationActivitySourceEntryIds(activity: ConversationActivity) {
  if (activity.sourceEntryIds?.length) {
    return activity.sourceEntryIds;
  }

  if (activity.sourceEntryRanges?.length || activity.sourceEntrySpans?.length) {
    return [];
  }

  return activity.entries.flatMap((entry) =>
    entry.sourceEntryIds && entry.sourceEntryIds.length > 0
      ? entry.sourceEntryIds
      : [entry.id]
  );
}

function readActivityLabelCount(label: string) {
  const match = label.match(/\((\d+)\)$/);
  if (match) {
    return Number(match[1]);
  }

  return label === "Context compressed" || label === "Model changed" ? 1 : null;
}

function buildMergedActivityLabel(
  kind: ConversationActivity["kind"],
  activities: ConversationActivity[],
  sourceEntryCount: number
) {
  const labelCounts = activities
    .map((activity) => readActivityLabelCount(activity.label))
    .filter((count): count is number => count !== null);
  const count =
    labelCounts.length === activities.length
      ? labelCounts.reduce((sum, value) => sum + value, 0)
      : Math.max(1, sourceEntryCount);

  if (kind === "changes") {
    return count === 1 ? "Changes (1)" : `Changes (${count})`;
  }

  if (kind === "context") {
    return count === 1 ? "Context compressed" : `Context compressed (${count})`;
  }

  if (kind === "model") {
    return count === 1 ? "Model changed" : `Model changed (${count})`;
  }

  const labelPrefix = kind === "tools" ? "Tools" : "Details";
  return count === 1 ? `${labelPrefix} (1)` : `${labelPrefix} (${count})`;
}

function readLatestActivityTimestamp(activities: ConversationActivity[]) {
  const sortedActivities = [...activities].sort(
    (left, right) => readTimestamp(left.timestamp) - readTimestamp(right.timestamp)
  );
  return sortedActivities[sortedActivities.length - 1]?.timestamp ??
    activities[0]?.timestamp ??
    new Date(0).toISOString();
}

function mergeConversationActivityGroup(
  kind: ConversationActivity["kind"],
  activities: ConversationActivity[]
) {
  if (activities.length === 1) {
    return activities[0];
  }

  const entries = dedupeEntriesById(activities.flatMap((activity) => activity.entries));
  const entryIds = dedupeStrings(activities.flatMap((activity) => activity.entryIds ?? []));
  const sourceEntryIds = dedupeStrings(activities.flatMap(readConversationActivitySourceEntryIds));
  const sourceEntryRanges = activities.flatMap((activity) => activity.sourceEntryRanges ?? []);
  const sourceEntrySpans = activities.flatMap((activity) => activity.sourceEntrySpans ?? []);
  const sourceEntryCount = activities.reduce(
    (count, activity) => count + countAgentTranscriptSourceRefs(activity),
    0
  );
  const sourceKey = buildAgentTranscriptSourceRefsKey({
    sourceEntryIds,
    sourceEntryRanges,
    sourceEntrySpans
  }) || activities[0]?.id || kind;

  return {
    id: `merged:${kind}:${sourceKey}`,
    kind,
    label: buildMergedActivityLabel(kind, activities, sourceEntryCount),
    timestamp: readLatestActivityTimestamp(activities),
    entries,
    entryIds: entryIds.length > 0 ? entryIds : undefined,
    sourceEntryCount: sourceEntryCount > 0 ? sourceEntryCount : undefined,
    sourceEntryIds: sourceEntryIds.length > 0 ? sourceEntryIds : undefined,
    sourceEntryRanges: sourceEntryRanges.length > 0 ? sourceEntryRanges : undefined,
    sourceEntrySpans: sourceEntrySpans.length > 0 ? sourceEntrySpans : undefined
  } satisfies ConversationActivity;
}

function mergeConversationActivities(activities: ConversationActivity[]) {
  if (activities.length <= 1) {
    return activities;
  }

  const groups = new Map<ConversationActivity["kind"], ConversationActivity[]>();
  for (const activity of activities) {
    groups.set(activity.kind, [...(groups.get(activity.kind) ?? []), activity]);
  }

  return Array.from(groups.entries())
    .sort(([left], [right]) => activityKindOrder[left] - activityKindOrder[right])
    .map(([kind, groupActivities]) => mergeConversationActivityGroup(kind, groupActivities));
}

function mergeActivityTimelineRun(items: ActivityTimelineItem[]): ActivityTimelineItem[] {
  return mergeConversationActivities(items.map((item) => item.activity)).map((activity) => ({
    type: "activity",
    key: activity.id,
    activity
  }));
}

export function orderConversationActivityRuns(items: ConversationTimelineItem[]) {
  const orderedItems: ConversationTimelineItem[] = [];
  let activityRun: ActivityTimelineItem[] = [];

  const flushActivityRun = () => {
    if (activityRun.length === 0) {
      return;
    }

    orderedItems.push(...sortConversationActivityRun(mergeActivityTimelineRun(activityRun)));
    activityRun = [];
  };

  for (const item of items) {
    if (item.type === "activity") {
      activityRun.push(item);
      continue;
    }

    flushActivityRun();
    orderedItems.push(item);
  }

  flushActivityRun();
  return orderedItems;
}
