import type {
  AgentTranscriptEntry,
  AgentTranscriptViewItem,
  AgentTranscriptViewResponse
} from "@deskcue/protocol";

const MAX_LIVE_TRANSCRIPT_ENTRIES = 512;
const MAX_LIVE_TRANSCRIPT_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_LIVE_TRANSCRIPT_VIEW_ITEMS = 512;
const MAX_LIVE_TRANSCRIPT_VIEW_BYTES = 8 * 1024 * 1024;
const MAX_HISTORY_TRANSCRIPT_ENTRIES = 512;
const MAX_HISTORY_TRANSCRIPT_BYTES = 8 * 1024 * 1024;

export type AgentTranscriptHistoryProtection = {
  entryIds: ReadonlySet<string>;
  viewItemKeys: ReadonlySet<string>;
};

function estimateWireBytes(value: unknown) {
  try {
    return JSON.stringify(value).length * 2;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function retainNewestWithinBudget<T extends AgentTranscriptEntry | AgentTranscriptViewItem>(
  records: T[],
  maxCount: number,
  maxBytes: number
) {
  if (records.length <= maxCount && estimateWireBytes(records) <= maxBytes) {
    return records;
  }
  const retained: T[] = [];
  let retainedBytes = 2;
  for (let index = records.length - 1; index >= 0 && retained.length < maxCount; index -= 1) {
    const record = records[index];
    const recordBytes = estimateWireBytes(record) + 2;
    if (recordBytes > maxBytes || retainedBytes + recordBytes > maxBytes) {
      continue;
    }
    retained.push(record);
    retainedBytes += recordBytes;
  }
  return retained.reverse();
}

function retainLiveAndHistoryWithinBudget<
  T extends AgentTranscriptEntry | AgentTranscriptViewItem
>(
  records: T[],
  isHistory: (record: T) => boolean,
  maxLiveCount: number,
  maxLiveBytes: number
) {
  const history = retainNewestWithinBudget(
    records.filter(isHistory),
    MAX_HISTORY_TRANSCRIPT_ENTRIES,
    MAX_HISTORY_TRANSCRIPT_BYTES
  );
  const live = retainNewestWithinBudget(
    records.filter((record) => !isHistory(record)),
    maxLiveCount,
    maxLiveBytes
  );
  if (history.length + live.length === records.length) return records;
  const retained = new Set([...history, ...live]);
  return records.filter((record) => retained.has(record));
}

export function boundLiveTranscriptEntries(entries: AgentTranscriptEntry[]) {
  return retainNewestWithinBudget(
    entries,
    MAX_LIVE_TRANSCRIPT_ENTRIES,
    MAX_LIVE_TRANSCRIPT_ENTRY_BYTES
  );
}

export function boundLiveTranscriptView(
  view: AgentTranscriptViewResponse | undefined
): AgentTranscriptViewResponse | undefined {
  if (!view) {
    return view;
  }
  const items = retainNewestWithinBudget(
    view.items,
    MAX_LIVE_TRANSCRIPT_VIEW_ITEMS,
    MAX_LIVE_TRANSCRIPT_VIEW_BYTES
  );
  return items === view.items ? view : { ...view, items };
}

export function boundTranscriptEntriesWithHistory(
  entries: AgentTranscriptEntry[],
  protectedIds: ReadonlySet<string>
) {
  return retainLiveAndHistoryWithinBudget(
    entries,
    (entry) => protectedIds.has(entry.id),
    MAX_LIVE_TRANSCRIPT_ENTRIES,
    MAX_LIVE_TRANSCRIPT_ENTRY_BYTES
  );
}

export function boundTranscriptViewWithHistory(
  view: AgentTranscriptViewResponse | undefined,
  protectedKeys: ReadonlySet<string>
) {
  if (!view) return view;
  const items = retainLiveAndHistoryWithinBudget(
    view.items,
    (item) => protectedKeys.has(item.key),
    MAX_LIVE_TRANSCRIPT_VIEW_ITEMS,
    MAX_LIVE_TRANSCRIPT_VIEW_BYTES
  );
  return items === view.items ? view : { ...view, items };
}
