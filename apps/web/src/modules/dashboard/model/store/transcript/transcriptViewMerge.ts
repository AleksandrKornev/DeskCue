import type {
  AgentSessionDetail,
  AgentTranscriptViewItem,
  AgentTranscriptViewResponse
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

function readEmbeddedActivityIds(items: AgentTranscriptViewItem[]) {
  const activityIds = new Set<string>();

  for (const item of items) {
    if (item.type !== "message") continue;

    for (const activity of [...item.activities, ...item.changeActivities]) {
      activityIds.add(activity.id);
    }
  }

  return activityIds;
}

function shouldRetainTranscriptViewItem(
  item: AgentTranscriptViewItem,
  embeddedActivityIds: Set<string>
) {
  return item.type !== "activity" || !embeddedActivityIds.has(item.activity.id);
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
  const pageItemKeys = new Set(page.items.map((item) => item.key));
  const pageEmbeddedActivityIds = readEmbeddedActivityIds(page.items);
  const retainedCurrentItems = current.items.filter(
    (item) =>
      !pageItemKeys.has(item.key) &&
      shouldRetainTranscriptViewItem(item, pageEmbeddedActivityIds)
  );
  const refreshedPageItems = page.items.map((item) =>
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
  const nextItemKeys = new Set(next.items.map((item) => item.key));
  const nextEmbeddedActivityIds = readEmbeddedActivityIds(next.items);
  const retainedHistory = current.items.filter(
    (item) =>
      !nextItemKeys.has(item.key) &&
      shouldRetainTranscriptViewItem(item, nextEmbeddedActivityIds)
  );
  const refreshedItems = next.items.map((item) => {
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
