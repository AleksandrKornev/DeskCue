import type { AgentSessionDetail } from "@deskcue/protocol";
import { filterHumanVisibleTranscriptEntries } from "@models/transcriptEntries";
import type { ConversationActivity } from "@modules/session/types";

import { emptyTranscriptEntries } from "./constants";

function createLegacyActivityGroup(
  entry: AgentSessionDetail["transcript"][number]
): ConversationActivity {
  const kind = entry.parts?.some((part) => part.type === "diff")
    ? "changes"
    : entry.role === "tool"
      ? "tools"
      : "details";
  const label = kind === "changes"
    ? "Changes (1)"
    : kind === "tools"
      ? "Tools (1)"
      : "Details (1)";

  return {
    entries: [entry],
    entryIds: [entry.id],
    id: `legacy:${entry.id}`,
    kind,
    label,
    sourceEntryIds: [entry.id],
    timestamp: entry.timestamp
  };
}

export function readManagedSessionActivityGroups(
  view: NonNullable<AgentSessionDetail["transcriptView"]> | null,
  transcriptEntries: AgentSessionDetail["transcript"]
): ConversationActivity[] {
  if (view) {
    const seenActivityIds = new Set<string>();
    const groups: ConversationActivity[] = [];

    for (const item of view.items) {
      const itemActivities = item.type === "message"
        ? [...item.activities, ...item.changeActivities]
        : [item.activity];

      for (const activity of itemActivities) {
        if (seenActivityIds.has(activity.id)) {
          continue;
        }

        seenActivityIds.add(activity.id);
        groups.push(activity);
      }
    }

    return groups;
  }

  return filterHumanVisibleTranscriptEntries(transcriptEntries)
    .filter((entry) => entry.role !== "user" && entry.role !== "assistant")
    .map((entry) => createLegacyActivityGroup(entry));
}

export function readTranscriptViewChatEntries(
  view: NonNullable<AgentSessionDetail["transcriptView"]> | null
) {
  if (!view) {
    return emptyTranscriptEntries;
  }

  return view.items.flatMap((item) =>
    item.type === "message" ? [item.entry] : []
  );
}
