import type { TranscriptEntry, TimelineActivity, TranscriptEntryTimelineItem, TranscriptTimelineItem } from "./types";

function isPrimaryTranscriptEntry(entry: TranscriptEntry) {
  return entry.role === "user" || entry.role === "assistant";
}

function buildActivityMeta(entries: TranscriptEntry[]) {
  const toolCount = entries.filter((entry) => entry.role === "tool").length;

  if (toolCount > 0) {
    return {
      kind: "tools" as const,
      label: toolCount === 1 ? "Tools (1)" : `Tools (${toolCount})`
    };
  }

  return {
    kind: "details" as const,
    label: entries.length === 1 ? "Details (1)" : `Details (${entries.length})`
  };
}

function activityKindForEntry(entry: TranscriptEntry) {
  return entry.role === "tool" ? "tools" : "details";
}

function buildActivityGroups(entries: TranscriptEntry[], idPrefix: string) {
  if (entries.length === 0) {
    return [];
  }

  const groups: TranscriptEntry[][] = [];

  for (const entry of entries) {
    const previousGroup = groups[groups.length - 1];
    const previousEntry = previousGroup?.[previousGroup.length - 1];

    if (
      previousGroup &&
      previousEntry &&
      activityKindForEntry(previousEntry) === activityKindForEntry(entry)
    ) {
      previousGroup.push(entry);
      continue;
    }

    groups.push([entry]);
  }

  return groups.map((group, index) => {
    const meta = buildActivityMeta(group);

    return {
      id: `${idPrefix}:${index}:${group[0]?.id ?? index}`,
      kind: meta.kind,
      label: meta.label,
      timestamp: group[group.length - 1]?.timestamp ?? group[0].timestamp,
      entries: group
    } satisfies TimelineActivity;
  });
}

function buildActivityGroupsByKind(entries: TranscriptEntry[], idPrefix: string) {
  if (entries.length === 0) {
    return [];
  }

  const detailsEntries = entries.filter((entry) => activityKindForEntry(entry) === "details");
  const toolEntries = entries.filter((entry) => activityKindForEntry(entry) === "tools");

  return [detailsEntries, toolEntries]
    .filter((group) => group.length > 0)
    .map((group, index) => {
      const meta = buildActivityMeta(group);

      return {
        id: `${idPrefix}:${meta.kind}:${group[0]?.id ?? index}`,
        kind: meta.kind,
        label: meta.label,
        timestamp: group[group.length - 1]?.timestamp ?? group[0].timestamp,
        entries: group
      } satisfies TimelineActivity;
    });
}

function mergeTimelineActivities(activities: TimelineActivity[]) {
  if (activities.length <= 1) {
    return activities;
  }

  const detailsEntries = activities
    .filter((activity) => activity.kind === "details")
    .flatMap((activity) => activity.entries);

  const toolEntries = activities
    .filter((activity) => activity.kind === "tools")
    .flatMap((activity) => activity.entries);

  return buildActivityGroupsByKind(
    [...detailsEntries, ...toolEntries].sort(
      (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
    ),
    `merged:${activities[0]?.id ?? "activity"}`
  );
}

export function buildTranscriptTimeline(entries: TranscriptEntry[]) {
  const primaryIndexes = entries
    .map((entry, index) => (isPrimaryTranscriptEntry(entry) ? index : -1))
    .filter((index) => index >= 0);

  if (primaryIndexes.length === 0) {
    return buildActivityGroups(entries, "activity").map((activity) => ({
      id: activity.id,
      type: "activity" as const,
      activity
    }));
  }

  const timeline: TranscriptEntryTimelineItem[] = primaryIndexes.map((primaryIndex) => ({
    id: entries[primaryIndex].id,
    type: "entry",
    entry: entries[primaryIndex],
    activities: []
  }));

  const leadingActivities: TimelineActivity[] = [];
  const standaloneActivitiesByEntry = new Map<number, TimelineActivity[]>();

  const attachActivities = (entryPosition: number, entriesToAttach: TranscriptEntry[], idPrefix: string) => {
    if (entryPosition < 0 || entryPosition >= timeline.length || entriesToAttach.length === 0) {
      return;
    }

    timeline[entryPosition].activities.push(...buildActivityGroupsByKind(entriesToAttach, idPrefix));
  };

  const appendStandaloneActivities = (
    target: TimelineActivity[],
    entriesToAttach: TranscriptEntry[],
    idPrefix: string
  ) => {
    if (entriesToAttach.length === 0) {
      return;
    }

    target.push(...buildActivityGroupsByKind(entriesToAttach, idPrefix));
  };

  const appendStandaloneActivitiesToEntry = (
    entryPosition: number,
    entriesToAttach: TranscriptEntry[],
    idPrefix: string
  ) => {
    if (entryPosition < 0 || entryPosition >= timeline.length || entriesToAttach.length === 0) {
      return;
    }

    const existingActivities = standaloneActivitiesByEntry.get(entryPosition) ?? [];
    existingActivities.push(...buildActivityGroupsByKind(entriesToAttach, idPrefix));
    standaloneActivitiesByEntry.set(entryPosition, existingActivities);
  };

  const leadingEntries = entries.slice(0, primaryIndexes[0]);
  if (timeline[0].entry.role === "assistant") {
    attachActivities(0, leadingEntries, `leading:${timeline[0].id}`);
  } else {
    appendStandaloneActivities(leadingActivities, leadingEntries, `leading:${timeline[0].id}`);
  }

  for (let position = 0; position < primaryIndexes.length; position += 1) {
    const primaryIndex = primaryIndexes[position];
    const previousPrimaryIndex = primaryIndexes[position - 1] ?? -1;
    const nextPrimaryIndex = primaryIndexes[position + 1] ?? entries.length;
    const betweenPreviousAndCurrent = entries.slice(previousPrimaryIndex + 1, primaryIndex);
    const betweenCurrentAndNext = entries.slice(primaryIndex + 1, nextPrimaryIndex);

    if (position > 0 && betweenPreviousAndCurrent.length > 0) {
      if (timeline[position].entry.role === "assistant") {
        attachActivities(position, betweenPreviousAndCurrent, `between:${timeline[position].id}:${position}`);
      } else if (timeline[position - 1].entry.role === "assistant") {
        attachActivities(
          position - 1,
          betweenPreviousAndCurrent,
          `between:${timeline[position - 1].id}:${position}`
        );
      } else {
        appendStandaloneActivitiesToEntry(
          position - 1,
          betweenPreviousAndCurrent,
          `between:${timeline[position - 1].id}:${position}`
        );
      }
    }

    if (position === primaryIndexes.length - 1 && betweenCurrentAndNext.length > 0) {
      if (timeline[position].entry.role === "assistant") {
        attachActivities(position, betweenCurrentAndNext, `trailing:${timeline[position].id}`);
      } else {
        appendStandaloneActivitiesToEntry(position, betweenCurrentAndNext, `trailing:${timeline[position].id}`);
      }
    }
  }

  for (const item of timeline) {
    item.activities = mergeTimelineActivities(item.activities);
  }

  const timelineItems: TranscriptTimelineItem[] = leadingActivities.map((activity) => ({
    id: activity.id,
    type: "activity",
    activity
  }));

  timeline.forEach((item, index) => {
    timelineItems.push(item);
    const standaloneActivities = standaloneActivitiesByEntry.get(index);
    if (!standaloneActivities) {
      return;
    }

    mergeTimelineActivities(standaloneActivities).forEach((activity) => {
      timelineItems.push({
        id: activity.id,
        type: "activity",
        activity
      });
    });
  });

  return timelineItems;
}

export function getTextOnlyTranscriptEntryText(entry: TranscriptEntry) {
  const markdownText =
    entry.parts
      ?.filter((part) => part.type === "markdown")
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n\n") ?? "";

  return (markdownText || entry.text).trim();
}
