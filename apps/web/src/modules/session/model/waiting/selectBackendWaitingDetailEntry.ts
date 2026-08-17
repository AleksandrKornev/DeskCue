import type { ConversationActivity } from "@modules/session/types";

function isEntryAtOrAfter(
  entry: ConversationActivity["entries"][number],
  since: string | null | undefined
) {
  if (!since) {
    return true;
  }

  const entryTime = new Date(entry.timestamp).getTime();
  const sinceTime = new Date(since).getTime();
  return Number.isFinite(entryTime) && Number.isFinite(sinceTime) && entryTime >= sinceTime;
}

export function selectBackendWaitingDetailEntry(
  backendEntry: ConversationActivity["entries"][number] | null,
  since: string | null | undefined
) {
  if (
    backendEntry?.role === "commentary" &&
    isEntryAtOrAfter(backendEntry, since)
  ) {
    return backendEntry;
  }

  return null;
}
