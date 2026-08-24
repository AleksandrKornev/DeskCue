import type { ConversationActivity } from "@modules/session/types";

function isEntryAtOrAfter(
  entry: ConversationActivity["entries"][number],
  since: string | null | undefined
) {
  if (!since) return true;

  const entryTime = new Date(entry.timestamp).getTime();
  const sinceTime = new Date(since).getTime();

  return Number.isFinite(entryTime) && Number.isFinite(sinceTime) && entryTime >= sinceTime;
}

function hasWaitingDetailText(entry: ConversationActivity["entries"][number]) {
  return entry.text.trim().length > 0;
}

export function selectBackendWaitingDetailEntry(
  backendEntry: ConversationActivity["entries"][number] | null,
  since: string | null | undefined
) {
  if (
    backendEntry?.role === "commentary" &&
    hasWaitingDetailText(backendEntry) &&
    isEntryAtOrAfter(backendEntry, since)
  ) {
    return backendEntry;
  }

  return null;
}
