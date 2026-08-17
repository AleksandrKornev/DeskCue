import type { ConversationActivity } from "@modules/session/types";

export function readManagedSessionActivityExpansionKey(
  activity: ConversationActivity
) {
  const sourceRange = activity.sourceEntryRanges?.[0] ?? activity.sourceEntrySpans?.[0];
  if (sourceRange) {
    return `${activity.kind}:range:${sourceRange.prefix}:${sourceRange.start}`;
  }

  const sourceEntryId = activity.sourceEntryIds?.[0] ?? activity.entryIds?.[0];
  if (sourceEntryId) {
    return `${activity.kind}:entry:${sourceEntryId}`;
  }

  return `${activity.kind}:id:${activity.id}`;
}
