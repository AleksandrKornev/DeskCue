import {
  buildAgentTranscriptSourceRefsKey,
  doAgentTranscriptSourceRefsOverlap
} from "@deskcue/protocol";
import {
  formatChatDay,
  getChatDayKey
} from "@lib/format";
import type { ConversationTimelineItem } from "@modules/session/types";

import { orderConversationActivityRuns } from "./timelineActivityRuns";

export const MAX_VISIBLE_CHAT_MESSAGES = 15;
export const CHAT_HISTORY_PAGE_SIZE = 5;

export function countConversationMessages(items: ConversationTimelineItem[]) {
  return items.reduce((count, item) => count + (item.type === "message" ? 1 : 0), 0);
}

function readSystemActivitySemanticEntryKeys(
  activity: Exclude<ConversationTimelineItem, { type: "day" | "message" }>["activity"]
) {
  if (activity.kind !== "context" && activity.kind !== "model") {
    return [];
  }

  return activity.entries.map((entry) => JSON.stringify({
    phase: entry.phase,
    text: entry.text.trim(),
    timestamp: entry.timestamp,
    statuses: entry.parts?.flatMap((part) =>
      part.type === "status"
        ? [{ detail: part.detail, label: part.label }]
        : []
    ) ?? []
  }));
}

function readSystemActivitySemanticSignature(
  activity: Exclude<ConversationTimelineItem, { type: "day" | "message" }>["activity"]
) {
  const entryKeys = readSystemActivitySemanticEntryKeys(activity);
  if (entryKeys.length === 0) {
    return null;
  }

  return [
    "activity",
    activity.kind,
    "semantic",
    JSON.stringify(entryKeys)
  ].join(":");
}

function readConversationActivitySourceRefs(
  activity: Exclude<ConversationTimelineItem, { type: "day" | "message" }>["activity"]
) {
  const sourceEntryIds = activity.sourceEntryIds?.length
    ? activity.sourceEntryIds
    : activity.sourceEntryRanges?.length || activity.sourceEntrySpans?.length
      ? []
    : activity.entries.flatMap((entry) =>
        entry.sourceEntryIds && entry.sourceEntryIds.length > 0
          ? entry.sourceEntryIds
          : [entry.id]
      );

  return {
    sourceEntryCount: activity.sourceEntryCount,
    sourceEntryIds: Array.from(new Set(sourceEntryIds)),
    sourceEntryRanges: activity.sourceEntryRanges,
    sourceEntrySpans: activity.sourceEntrySpans
  };
}

function readConversationActivitySourceKey(
  activity: Exclude<ConversationTimelineItem, { type: "day" | "message" }>["activity"]
) {
  return buildAgentTranscriptSourceRefsKey(readConversationActivitySourceRefs(activity)) || null;
}

function readConversationActivityContentSignature(
  activity: Exclude<ConversationTimelineItem, { type: "day" | "message" }>["activity"]
) {
  const semanticSignature = readSystemActivitySemanticSignature(activity);
  if (semanticSignature) {
    return semanticSignature;
  }

  const sourceKey = readConversationActivitySourceKey(activity);
  if (sourceKey) {
    return [
      "activity",
      activity.kind,
      sourceKey
    ].join(":");
  }

  const time = new Date(activity.timestamp).getTime();
  const minuteBucket = Number.isFinite(time) ? Math.floor(time / 60_000) : activity.timestamp;

  return [
    "activity",
    activity.kind,
    minuteBucket
  ].join(":");
}

function readConversationTimelineItemContentSignature(item: ConversationTimelineItem) {
  if (item.type === "day") {
    return null;
  }

  if (item.type === "activity") {
    return readConversationActivityContentSignature(item.activity);
  }

  return [
    "message",
    item.role,
    item.timestamp,
    item.entry.text.trim()
  ].join(":");
}

function readConversationTimelineItemSignatures(items: ConversationTimelineItem[]) {
  return items.flatMap((item) => {
    const signature = readConversationTimelineItemContentSignature(item);
    const nestedActivitySignatures =
      item.type === "message"
        ? [...item.activities, ...item.changeActivities].map(readConversationActivityContentSignature)
        : [];

    return [signature, ...nestedActivitySignatures].filter(
      (candidate): candidate is string => Boolean(candidate)
    );
  });
}

function isTransientConversationTimelineItem(item: ConversationTimelineItem) {
  return item.type === "message" && item.entry.phase === "in_progress";
}

function doConversationActivitiesOverlap(
  left: Exclude<ConversationTimelineItem, { type: "day" | "message" }>["activity"],
  right: Exclude<ConversationTimelineItem, { type: "day" | "message" }>["activity"]
) {
  if (left.kind !== right.kind) {
    return false;
  }

  if (doAgentTranscriptSourceRefsOverlap(
    readConversationActivitySourceRefs(left),
    readConversationActivitySourceRefs(right)
  )) {
    return true;
  }

  const rightSemanticEntryKeys = new Set(readSystemActivitySemanticEntryKeys(right));
  return readSystemActivitySemanticEntryKeys(left).some((entryKey) =>
    rightSemanticEntryKeys.has(entryKey)
  );
}

function isRetainedActivityAlreadyRendered(
  retainedItem: ConversationTimelineItem,
  currentItems: ConversationTimelineItem[]
) {
  if (retainedItem.type !== "activity") {
    return false;
  }

  return currentItems.some((currentItem) => {
    if (currentItem.type === "activity") {
      return doConversationActivitiesOverlap(retainedItem.activity, currentItem.activity);
    }

    if (currentItem.type !== "message") {
      return false;
    }

    return [...currentItem.activities, ...currentItem.changeActivities].some((activity) =>
      doConversationActivitiesOverlap(retainedItem.activity, activity)
    );
  });
}

function readConversationTimelineItemTime(item: ConversationTimelineItem) {
  if (item.type === "day") {
    return Number.NEGATIVE_INFINITY;
  }

  const timestamp = item.type === "message" ? item.timestamp : item.activity.timestamp;
  const time = new Date(timestamp).getTime();
  return Number.isFinite(time) ? time : 0;
}

function shouldPreferConversationTimelineItem(
  nextItem: Exclude<ConversationTimelineItem, { type: "day" }>,
  currentItem: Exclude<ConversationTimelineItem, { type: "day" }>
) {
  if (nextItem.type !== "activity" || currentItem.type !== "activity") {
    return true;
  }

  if (nextItem.activity.entries.length !== currentItem.activity.entries.length) {
    return nextItem.activity.entries.length > currentItem.activity.entries.length;
  }

  return readConversationTimelineItemTime(nextItem) >= readConversationTimelineItemTime(currentItem);
}

export function mergeRetainedConversationTimeline(
  retainedItems: ConversationTimelineItem[],
  currentItems: ConversationTimelineItem[]
) {
  if (retainedItems.length === 0) {
    return currentItems;
  }

  const currentKeys = new Set(currentItems.map((item) => item.key));
  const currentContentSignatures = new Set(readConversationTimelineItemSignatures(currentItems));
  const retainedOnlyItems = retainedItems.filter((item) => {
    // Streaming bubbles are projections of in-memory deltas. A later snapshot
    // intentionally omits them once it contains the durable assistant message;
    // retaining the old bubble would render a ghost partial response.
    if (isTransientConversationTimelineItem(item)) {
      return false;
    }

    if (currentKeys.has(item.key)) {
      return false;
    }

    if (isRetainedActivityAlreadyRendered(item, currentItems)) {
      return false;
    }

    const signature = readConversationTimelineItemContentSignature(item);
    return !signature || !currentContentSignatures.has(signature);
  });
  const mergedContentItemsBySignature = new Map<
    string,
    {
      item: Exclude<ConversationTimelineItem, { type: "day" }>;
      index: number;
    }
  >();
  const passthroughMergedContentItems: Array<{
    item: Exclude<ConversationTimelineItem, { type: "day" }>;
    index: number;
  }> = [];

  [...retainedOnlyItems, ...currentItems]
    .map((item, index) => ({ item, index }))
    .filter(
      (
        value
      ): value is {
        item: Exclude<ConversationTimelineItem, { type: "day" }>;
        index: number;
      } => value.item.type !== "day"
    )
    .forEach(({ item, index }) => {
      const signature = readConversationTimelineItemContentSignature(item);
      if (!signature) {
        passthroughMergedContentItems.push({ item, index });
        return;
      }

      const existing = mergedContentItemsBySignature.get(signature);
      if (!existing || shouldPreferConversationTimelineItem(item, existing.item)) {
        mergedContentItemsBySignature.set(signature, { item, index });
      }
    });

  const mergedContentItems = [
    ...passthroughMergedContentItems,
    ...mergedContentItemsBySignature.values()
  ]
    .sort((left, right) => {
      const timeDelta = readConversationTimelineItemTime(left.item) - readConversationTimelineItemTime(right.item);
      return timeDelta === 0 ? left.index - right.index : timeDelta;
    });

  const mergedItems: ConversationTimelineItem[] = [];
  let lastDayKey: string | null = null;
  let lastMessageRole: "user" | "assistant" | null = null;

  for (const { item } of mergedContentItems) {
    const timestamp =
      item.type === "message"
        ? item.timestamp
        : item.activity.timestamp;
    const dayKey = getChatDayKey(timestamp);

    if (dayKey !== lastDayKey) {
      mergedItems.push({
        type: "day",
        key: dayKey,
        label: formatChatDay(timestamp)
      });
      lastDayKey = dayKey;
      lastMessageRole = null;
    }

    if (item.type === "message") {
      mergedItems.push({
        ...item,
        // A user message always begins a distinct prompt. Keep its author
        // metadata visible even if a retained window places it next to another
        // user message after an interrupted turn.
        continued: item.role === "assistant" && lastMessageRole === item.role
      });
      lastMessageRole = item.role;
      continue;
    }

    mergedItems.push(item);
    lastMessageRole = null;
  }

  return orderConversationActivityRuns(mergedItems);
}

export function buildVisibleConversationTimeline(items: ConversationTimelineItem[], messageLimit: number) {
  const messageIndexes = items
    .map((item, index) => (item.type === "message" ? index : -1))
    .filter((index) => index >= 0);

  if (messageIndexes.length <= messageLimit) {
    return {
      visibleItems: items,
      hiddenCount: 0
    };
  }

  const startMessagePosition = Math.max(0, messageIndexes.length - messageLimit);
  const startIndex = messageIndexes[startMessagePosition];
  const visibleItems = items.slice(startIndex);
  const hiddenCount = startMessagePosition;
  const firstVisibleItem = visibleItems[0];

  if (firstVisibleItem && firstVisibleItem.type !== "day") {
    const timestamp =
      firstVisibleItem.type === "message"
        ? firstVisibleItem.timestamp
        : firstVisibleItem.activity.timestamp;

    const dayKey = getChatDayKey(timestamp);

    return {
      visibleItems: [
        {
          type: "day" as const,
          key: `visible-day:${dayKey}`,
          label: formatChatDay(timestamp)
        },
        ...visibleItems
      ],
      hiddenCount
    };
  }

  return {
    visibleItems,
    hiddenCount
  };
}
