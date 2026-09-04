import type {
  AgentSessionDetail,
  AgentTranscriptActivityGroup,
  AgentTranscriptEntry,
  AgentTranscriptViewItem,
  AgentTranscriptViewResponse
} from "@deskcue/protocol";
import {
  compactAgentTranscriptSourceRefs,
  doAgentTranscriptSourceRefsOverlap,
  expandAgentTranscriptSourceRanges
} from "@deskcue/protocol";

import {
  areAgentSessionSummariesEqual,
  areTranscriptTurnStatusesEqual,
  mergeTranscriptActivityGroup,
  mergeTranscriptActivityGroups,
  mergeTranscriptEntryReference
} from "./transcriptMergeIdentity";

function readTranscriptViewItemTimestamp(item: AgentTranscriptViewItem) {
  return item.type === "message" ? item.timestamp : item.activity.timestamp;
}

function compareTranscriptViewItems(
  left: AgentTranscriptViewItem,
  right: AgentTranscriptViewItem
) {
  const leftTime = new Date(readTranscriptViewItemTimestamp(left)).getTime();
  const rightTime = new Date(readTranscriptViewItemTimestamp(right)).getTime();

  if (leftTime !== rightTime && !Number.isNaN(leftTime) && !Number.isNaN(rightTime)) return leftTime - rightTime;

  return left.key.localeCompare(right.key);
}

function readProjectedActivities(items: AgentTranscriptViewItem[]) {
  const activities: AgentTranscriptActivityGroup[] = [];

  for (const item of items) {
    if (item.type === "activity") {
      activities.push(item.activity);
      continue;
    }

    activities.push(...item.activities, ...item.changeActivities);
  }

  return activities;
}

function doTranscriptActivitiesConnect(
  left: AgentTranscriptActivityGroup,
  right: AgentTranscriptActivityGroup
) {
  if (left.kind !== right.kind) return false;

  return left.id === right.id || doAgentTranscriptSourceRefsOverlap(left, right);
}

function readConnectedCurrentActivities(
  currentActivities: AgentTranscriptActivityGroup[],
  projectedActivities: AgentTranscriptActivityGroup[]
) {
  const connectedCurrentActivities = new Set<AgentTranscriptActivityGroup>();
  const pendingActivities = [...projectedActivities];

  for (let pendingIndex = 0; pendingIndex < pendingActivities.length; pendingIndex += 1) {
    const projectedActivity = pendingActivities[pendingIndex];

    for (const activity of currentActivities) {
      if (connectedCurrentActivities.has(activity)) continue;
      if (!doTranscriptActivitiesConnect(activity, projectedActivity)) continue;

      connectedCurrentActivities.add(activity);
      pendingActivities.push(activity);
    }
  }

  return currentActivities.filter((activity) => connectedCurrentActivities.has(activity));
}

function readExactActivitySourceEntryIds(activity: AgentTranscriptActivityGroup) {
  if (activity.sourceEntrySpans?.length) return null;

  const sourceEntryIds = [
    ...(activity.sourceEntryIds ?? []),
    ...expandAgentTranscriptSourceRanges(activity.sourceEntryRanges)
  ];

  return sourceEntryIds.length > 0 ? sourceEntryIds : null;
}

function mergeTranscriptActivityEntries(
  activities: AgentTranscriptActivityGroup[]
) {
  const entriesById = new Map<string, AgentTranscriptEntry>();

  for (const activity of activities) {
    for (const entry of activity.entries) {
      entriesById.set(
        entry.id,
        mergeTranscriptEntryReference(entriesById.get(entry.id), entry) ?? entry
      );
    }
  }

  return Array.from(entriesById.values());
}

function mergeSlidingTranscriptActivities(
  currentActivities: AgentTranscriptActivityGroup[],
  next: AgentTranscriptActivityGroup
) {
  if (next.kind !== "details" && next.kind !== "tools") return next;

  const overlappingActivities = readConnectedCurrentActivities(currentActivities, [next]);

  if (overlappingActivities.length === 0) return next;

  const activities = [...overlappingActivities, next];
  const sourceEntryIdGroups = activities.map(readExactActivitySourceEntryIds);

  if (sourceEntryIdGroups.some((sourceEntryIds) => sourceEntryIds === null)) return next;

  const exactSourceEntryIds = sourceEntryIdGroups.flatMap(
    (sourceEntryIds) => sourceEntryIds ?? []
  );

  const sourceRefs = compactAgentTranscriptSourceRefs(exactSourceEntryIds);
  const sourceEntryCount = sourceRefs.sourceEntryCount ?? 0;
  const labelPrefix = next.kind === "tools" ? "Tools" : "Details";

  return {
    ...next,
    entries: mergeTranscriptActivityEntries(activities),
    entryIds: Array.from(new Set(activities.flatMap((activity) => activity.entryIds))),
    label: `${labelPrefix} (${sourceEntryCount})`,
    sourceEntryCount,
    sourceEntryIds: sourceRefs.sourceEntryIds,
    sourceEntryRanges: sourceRefs.sourceEntryRanges,
    sourceEntrySpans: sourceRefs.sourceEntrySpans
  };
}

function mergeSlidingTranscriptActivityItems(
  currentItems: AgentTranscriptViewItem[],
  nextItems: AgentTranscriptViewItem[]
) {
  const currentActivities = currentItems.flatMap((item) =>
    item.type === "activity" ? [item.activity] : []
  );

  return nextItems.map((item) => {
    if (item.type !== "activity") return item;

    const activity = mergeSlidingTranscriptActivities(currentActivities, item.activity);

    return activity === item.activity ? item : { ...item, activity };
  });
}

function readReplacedStandaloneActivities(
  currentItems: AgentTranscriptViewItem[],
  projectedActivities: AgentTranscriptActivityGroup[]
) {
  const currentActivities = currentItems.flatMap((item) =>
    item.type === "activity" ? [item.activity] : []
  );

  return new Set(readConnectedCurrentActivities(currentActivities, projectedActivities));
}

function shouldRetainTranscriptViewItem(
  item: AgentTranscriptViewItem,
  replacedActivities: Set<AgentTranscriptActivityGroup>
) {
  return item.type !== "activity" || !replacedActivities.has(item.activity);
}

function mergeTranscriptViewItem(
  current: AgentTranscriptViewItem | undefined,
  next: AgentTranscriptViewItem
): AgentTranscriptViewItem {
  if (!current || current.type !== next.type || current.key !== next.key) return next;

  if (next.type === "activity") {
    if (current.type !== "activity") return next;

    const activity = mergeTranscriptActivityGroup(current.activity, next.activity);

    return activity === current.activity ? current : { ...next, activity };
  }

  if (current.type !== "message") return next;

  const entry = mergeTranscriptEntryReference(current.entry, next.entry);
  const activities = mergeTranscriptActivityGroups(current.activities, next.activities);
  const changeActivities = mergeTranscriptActivityGroups(
    current.changeActivities,
    next.changeActivities
  );
  const turnStatus = areTranscriptTurnStatusesEqual(current.turnStatus, next.turnStatus)
    ? current.turnStatus
    : next.turnStatus;

  if (
    current.role === next.role &&
    current.timestamp === next.timestamp &&
    entry === current.entry &&
    activities === current.activities &&
    changeActivities === current.changeActivities &&
    turnStatus === current.turnStatus
  ) {
    return current;
  }

  return {
    ...next,
    entry,
    activities,
    changeActivities,
    turnStatus
  };
}

export function mergeAgentTranscriptViewPage(
  current: AgentSessionDetail["transcriptView"],
  page: AgentTranscriptViewResponse | undefined
) {
  if (!page || page.items.length === 0) return current;
  if (!current || current.sessionId !== page.sessionId) return page;

  const currentItemsByKey = new Map(current.items.map((item) => [item.key, item]));
  const pageItems = mergeSlidingTranscriptActivityItems(current.items, page.items);
  const pageItemKeys = new Set(pageItems.map((item) => item.key));
  const pageProjectedActivities = readProjectedActivities(pageItems);
  const replacedActivities = readReplacedStandaloneActivities(
    current.items,
    pageProjectedActivities
  );
  const retainedCurrentItems = current.items.filter(
    (item) =>
      !pageItemKeys.has(item.key) &&
      shouldRetainTranscriptViewItem(item, replacedActivities)
  );
  const refreshedPageItems = pageItems.map((item) =>
    mergeTranscriptViewItem(currentItemsByKey.get(item.key), item)
  );

  return {
    ...current,
    items: [...retainedCurrentItems, ...refreshedPageItems].sort(compareTranscriptViewItems)
  };
}

export function mergeAgentTranscriptView(
  current: AgentSessionDetail["transcriptView"],
  next: AgentTranscriptViewResponse
) {
  if (!current || current.sessionId !== next.sessionId) return next;

  const currentItemsByKey = new Map(
    current.items.map((item) => [item.key, item])
  );
  const sessionUnchanged = areAgentSessionSummariesEqual(current.session, next.session);
  const nextItems = mergeSlidingTranscriptActivityItems(current.items, next.items);
  const nextItemKeys = new Set(nextItems.map((item) => item.key));
  const nextProjectedActivities = readProjectedActivities(nextItems);
  const replacedActivities = readReplacedStandaloneActivities(
    current.items,
    nextProjectedActivities
  );
  const retainedHistory = current.items.filter(
    (item) =>
      !nextItemKeys.has(item.key) &&
      shouldRetainTranscriptViewItem(item, replacedActivities)
  );
  const refreshedItems = nextItems.map((item) => {
    const mergedItem = mergeTranscriptViewItem(currentItemsByKey.get(item.key), item);

    return mergedItem;
  });
  const items = [...retainedHistory, ...refreshedItems].sort(compareTranscriptViewItems);
  let hasChanges =
    current.updatedAt !== next.updatedAt ||
    !sessionUnchanged ||
    items.length !== current.items.length ||
    items.some((item, index) => item !== current.items[index]);
  const latestWaitingDetailEntry = mergeTranscriptEntryReference(
    current.latestWaitingDetailEntry,
    next.latestWaitingDetailEntry
  );

  if (latestWaitingDetailEntry !== current.latestWaitingDetailEntry) hasChanges = true;

  return hasChanges
    ? {
        ...next,
        session: sessionUnchanged ? current.session : next.session,
        items,
        latestWaitingDetailEntry
      }
    : current;
}
