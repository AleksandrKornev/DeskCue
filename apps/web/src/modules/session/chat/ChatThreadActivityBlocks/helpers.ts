import type { ConversationActivity } from "@modules/session/types";

export function labelForActivityKind(kind: ConversationActivity["kind"]) {
  if (kind === "changes") {
    return "CHANGES";
  }

  if (kind === "context") {
    return "CONTEXT";
  }

  if (kind === "model") {
    return "MODEL";
  }

  if (kind === "tools") {
    return "TOOLS";
  }

  return "DETAILS";
}

export function shouldHydrateActivityOnExpand(activity: ConversationActivity) {
  return activity.entries.some((entry) => entry.isCompact === true);
}

export function buildMessageActivityElementIds(messageEntryId: string, activityId: string) {
  const identity = encodeURIComponent(`${messageEntryId}:${activityId}`);

  return {
    contentId: `message-activity-content-${identity}`,
    triggerId: `message-activity-trigger-${identity}`
  };
}
