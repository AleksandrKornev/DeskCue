import type { AgentTranscriptViewResponse } from "@deskcue/protocol";
import { formatChatDay, getChatDayKey } from "@lib/format";
import type { ConversationTimelineItem } from "@modules/session/types";

export function buildConversationTimelineFromView(view: AgentTranscriptViewResponse) {
  const items: ConversationTimelineItem[] = [];
  let lastDayKey: string | null = null;
  let lastMessageRole: "user" | "assistant" | null = null;

  for (const item of view.items) {
    const timestamp = item.type === "message" ? item.timestamp : item.activity.timestamp;
    const dayKey = getChatDayKey(timestamp);

    if (dayKey !== lastDayKey) {
      items.push({
        type: "day",
        key: dayKey,
        label: formatChatDay(timestamp)
      });
      lastDayKey = dayKey;
      lastMessageRole = null;
    }

    if (item.type === "message") {
      items.push({
        type: "message",
        key: item.key,
        role: item.role,
        timestamp: item.timestamp,
        // Consecutive user entries are separate prompts and must retain the
        // `User` label. Only assistant chunks may share a message header.
        continued: item.role === "assistant" && lastMessageRole === item.role,
        entry: item.entry,
        activities: item.activities,
        changeActivities: item.changeActivities,
        turnStatus: item.turnStatus
      });
      lastMessageRole = item.role;
      continue;
    }

    items.push({
      type: "activity",
      key: item.key,
      activity: item.activity
    });
    lastMessageRole = null;
  }

  return items;
}
