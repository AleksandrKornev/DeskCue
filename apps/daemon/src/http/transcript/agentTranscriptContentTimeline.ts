import type { AgentTranscriptActivityGroup, AgentTranscriptEntry } from "@deskcue/protocol";

import {
  buildConversationActivitiesByKind,
  buildConversationActivityGroup,
  mergeConversationActivities
} from "./agentTranscriptActivityGroups.ts";

export type ConversationContentItem =
  | {
      id: string;
      type: "entry";
      entry: AgentTranscriptEntry;
      activities: AgentTranscriptActivityGroup[];
    }
  | {
      id: string;
      type: "activity";
      activity: AgentTranscriptActivityGroup;
    };

type ConversationEntryItem = Extract<ConversationContentItem, { type: "entry" }>;

function readContentTimestamp(item: ConversationContentItem) {
  const value = item.type === "entry" ? item.entry.timestamp : item.activity.timestamp;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isChatMessageEntry(entry: AgentTranscriptEntry) {
  return entry.role === "user" || entry.role === "assistant";
}

function buildConversationContentTimelineEntries(entries: AgentTranscriptEntry[]) {
  const primaryIndexes = entries
    .map((entry, index) => (isChatMessageEntry(entry) ? index : -1))
    .filter((index) => index >= 0);
  if (primaryIndexes.length === 0) {
    return buildConversationActivitiesByKind(entries, "activity").map((activity) => ({
      id: activity.id,
      type: "activity" as const,
      activity
    }));
  }

  const timeline: ConversationEntryItem[] = primaryIndexes.map((primaryIndex) => ({
    id: entries[primaryIndex].id,
    type: "entry",
    entry: entries[primaryIndex],
    activities: []
  }));
  const leadingActivities: AgentTranscriptActivityGroup[] = [];
  const standaloneActivitiesByEntry = new Map<number, AgentTranscriptActivityGroup[]>();

  const attachActivities = (position: number, items: AgentTranscriptEntry[], prefix: string) => {
    if (position < 0 || position >= timeline.length || items.length === 0) return;
    timeline[position].activities.push(...buildConversationActivitiesByKind(items, prefix));
  };
  const appendActivities = (
    target: AgentTranscriptActivityGroup[],
    items: AgentTranscriptEntry[],
    prefix: string
  ) => {
    if (items.length > 0) target.push(...buildConversationActivitiesByKind(items, prefix));
  };
  const appendActivitiesAfter = (position: number, items: AgentTranscriptEntry[], prefix: string) => {
    if (position < 0 || position >= timeline.length || items.length === 0) return;
    const existing = standaloneActivitiesByEntry.get(position) ?? [];
    existing.push(...buildConversationActivitiesByKind(items, prefix));
    standaloneActivitiesByEntry.set(position, existing);
  };

  const leadingEntries = entries.slice(0, primaryIndexes[0]);
  if (timeline[0].entry.role === "assistant") {
    attachActivities(0, leadingEntries, `leading:${timeline[0].id}`);
  } else {
    appendActivities(leadingActivities, leadingEntries, `leading:${timeline[0].id}`);
  }

  for (let position = 0; position < primaryIndexes.length; position += 1) {
    const primaryIndex = primaryIndexes[position];
    const previousPrimaryIndex = primaryIndexes[position - 1] ?? -1;
    const nextPrimaryIndex = primaryIndexes[position + 1] ?? entries.length;
    const before = entries.slice(previousPrimaryIndex + 1, primaryIndex);
    const after = entries.slice(primaryIndex + 1, nextPrimaryIndex);

    if (position > 0 && before.length > 0) {
      if (timeline[position].entry.role === "assistant") {
        attachActivities(position, before, `between:${timeline[position].id}:${position}`);
      } else if (timeline[position - 1].entry.role === "assistant") {
        attachActivities(position - 1, before, `between:${timeline[position - 1].id}:${position}`);
      } else {
        appendActivitiesAfter(position - 1, before, `between:${timeline[position - 1].id}:${position}`);
      }
    }
    if (position === primaryIndexes.length - 1 && after.length > 0) {
      if (timeline[position].entry.role === "assistant") {
        attachActivities(position, after, `trailing:${timeline[position].id}`);
      } else {
        appendActivitiesAfter(position, after, `trailing:${timeline[position].id}`);
      }
    }
  }

  for (const item of timeline) item.activities = mergeConversationActivities(item.activities);
  const result: ConversationContentItem[] = leadingActivities.map((activity) => ({
    id: activity.id,
    type: "activity",
    activity
  }));
  timeline.forEach((item, index) => {
    result.push(item);
    for (const activity of mergeConversationActivities(standaloneActivitiesByEntry.get(index) ?? [])) {
      result.push({ id: activity.id, type: "activity", activity });
    }
  });
  return result;
}

export function isModelChangeEntry(entry: AgentTranscriptEntry) {
  return entry.phase === "model_changed";
}

export function isContextCompactionEntry(entry: AgentTranscriptEntry) {
  return entry.phase === "context_compacted";
}

export function isLifecycleStatusEntry(entry: AgentTranscriptEntry) {
  if (entry.role !== "system") return false;
  const statusPart = entry.parts?.find((part) => part.type === "status");
  const label = statusPart?.type === "status" ? statusPart.label : entry.text;
  return label === "Turn started" ||
    label === "Turn completed" ||
    label === "Turn interrupted" ||
    label === "Turn failed";
}

function isStandaloneLifecycleEntry(entry: AgentTranscriptEntry) {
  return isLifecycleStatusEntry(entry) ||
    isContextCompactionEntry(entry) ||
    isModelChangeEntry(entry);
}

export function buildConversationContentTimeline(entries: AgentTranscriptEntry[]) {
  const contextItems = entries.filter(isContextCompactionEntry).map((entry) => ({
    id: `context:${entry.id}`,
    type: "activity" as const,
    activity: buildConversationActivityGroup([entry], `context:${entry.id}`, "context")
  }));
  const modelItems = entries.filter(isModelChangeEntry).map((entry) => ({
    id: `model:${entry.id}`,
    type: "activity" as const,
    activity: buildConversationActivityGroup([entry], `model:${entry.id}`, "model")
  }));
  const visibleEntries = entries.filter((entry) => !isStandaloneLifecycleEntry(entry));
  const timelineItems = buildConversationContentTimelineEntries(visibleEntries);
  if (contextItems.length === 0 && modelItems.length === 0) return timelineItems;
  return [...timelineItems, ...contextItems, ...modelItems].sort(
    (left, right) => readContentTimestamp(left) - readContentTimestamp(right)
  );
}
