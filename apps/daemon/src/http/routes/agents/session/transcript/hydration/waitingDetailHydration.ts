import type {
  AgentSessionSourceVersion,
  AgentTranscriptEntry,
  AgentTranscriptViewResponse
} from "@deskcue/protocol";
import { expandAgentTranscriptSourceRanges } from "@deskcue/protocol";
import type { SourceAgentSessionService } from "#application/sourceAgentSessionService";

import type { AgentTranscriptHttpCache } from "../../../../../transcript/agentTranscriptHttpCache.ts";
import { isChatTranscriptEntry } from "../page.ts";

const MAX_WAITING_DETAIL_EXACT_ENTRY_IDS = 12;

function hasWaitingDetailContent(entry: AgentTranscriptEntry) {
  if (entry.text.trim().length > 0) {
    return true;
  }

  return (entry.parts ?? []).some((part) => {
    if (part.type === "markdown") return part.text.trim().length > 0;
    if (part.type === "status") return Boolean(part.label || part.detail);
    if (part.type === "tool_call") return Boolean(part.toolName || part.argumentsText);
    if (part.type === "tool_result") return Boolean(part.status || part.text);
    if (part.type === "diff") return Boolean(part.title || part.text || part.filePath);
    if (part.type === "attachment") return Boolean(part.label || part.path || part.url);
    return true;
  });
}

function isLifecycleStatusEntry(entry: AgentTranscriptEntry) {
  if (entry.role !== "system") {
    return false;
  }

  const statusPart = entry.parts?.find((part) => part.type === "status");
  const label = statusPart?.type === "status" ? statusPart.label : entry.text;
  return (
    label === "Turn started" ||
    label === "Turn completed" ||
    label === "Turn interrupted" ||
    label === "Turn failed"
  );
}

function isVisibleWaitingDetailEntry(entry: AgentTranscriptEntry) {
  if (
    entry.isCompact ||
    isChatTranscriptEntry(entry) ||
    entry.role === "tool" ||
    entry.phase === "context_compacted" ||
    entry.phase === "model_changed" ||
    isLifecycleStatusEntry(entry)
  ) {
    return false;
  }

  return hasWaitingDetailContent(entry);
}

function selectExactWaitingDetailEntry(
  entries: AgentTranscriptEntry[],
  requestedEntryIds: string[]
) {
  const requestedOrder = new Map(requestedEntryIds.map((entryId, index) => [entryId, index]));
  const orderedEntries = [...entries].sort((left, right) =>
    (requestedOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
    (requestedOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)
  );
  return orderedEntries.filter(isVisibleWaitingDetailEntry).at(-1) ?? null;
}

function readTrailingWaitingDetailSourceEntryIds(entry: AgentTranscriptEntry) {
  const entryIds = [
    ...(entry.sourceEntryIds ?? []),
    ...expandAgentTranscriptSourceRanges(entry.sourceEntryRanges ?? []),
    ...expandAgentTranscriptSourceRanges(entry.sourceEntrySpans ?? [])
  ];
  return Array.from(new Set(entryIds)).filter(Boolean).slice(-MAX_WAITING_DETAIL_EXACT_ENTRY_IDS);
}

function isCompactWaitingDetailPlaceholder(entry: AgentTranscriptEntry) {
  return (
    entry.role !== "tool" &&
    entry.phase !== "context_compacted" &&
    entry.phase !== "model_changed" &&
    entry.parts?.some((part) => part.type === "status" && part.label === "Details") === true
  );
}

export async function hydrateTranscriptViewWaitingDetailEntry({
  agentSessionId,
  sourceAgentSessions,
  sourceVersion,
  transcriptHttpCache,
  transcriptView
}: {
  agentSessionId: string;
  sourceAgentSessions: SourceAgentSessionService;
  sourceVersion: AgentSessionSourceVersion | null;
  transcriptHttpCache: AgentTranscriptHttpCache;
  transcriptView: AgentTranscriptViewResponse;
}): Promise<AgentTranscriptViewResponse> {
  const waitingEntry = transcriptView.latestWaitingDetailEntry;
  if (!waitingEntry?.isCompact) {
    return transcriptView;
  }

  if (!isCompactWaitingDetailPlaceholder(waitingEntry)) {
    return { ...transcriptView, latestWaitingDetailEntry: null };
  }

  const entryIds = readTrailingWaitingDetailSourceEntryIds(waitingEntry);
  if (entryIds.length === 0) {
    return { ...transcriptView, latestWaitingDetailEntry: null };
  }

  const exactRead = await transcriptHttpCache.readEntries(
    sourceAgentSessions,
    agentSessionId,
    entryIds,
    sourceVersion
  );
  const exactWaitingEntry = selectExactWaitingDetailEntry(exactRead.entries, entryIds);
  if (!exactWaitingEntry) {
    return { ...transcriptView, latestWaitingDetailEntry: null };
  }

  return { ...transcriptView, latestWaitingDetailEntry: exactWaitingEntry };
}
