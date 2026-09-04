import {
  COMPACT_DIFF_PLACEHOLDER_TEXT,
  compactAgentTranscriptSourceRefs,
  countAgentTranscriptSourceRefs
} from "@deskcue/protocol";
import type { AgentSessionDetail, AgentTranscriptEntry, TranscriptPart } from "@deskcue/protocol";

const ENTRY_TEXT_LIMIT = 160;
const MARKDOWN_TEXT_LIMIT = 260;
const STATUS_DETAIL_LIMIT = 160;
const TOOL_RESULT_SUMMARY = "[tool result hidden in live view]";
const compactActivityKindOrder: Record<CompactActivityKind, number> = {
  details: 0,
  tools: 1,
  changes: 2
};

type CompactActivityKind = "changes" | "details" | "tools";
type DiffPart = Extract<TranscriptPart, { type: "diff" }>;

function isStandaloneTranscriptEntry(entry: AgentTranscriptEntry) {
  if (entry.phase === "context_compacted" || entry.phase === "model_changed") {
    return true;
  }

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

function canCoalesceCompactTranscriptEntry(entry: AgentTranscriptEntry) {
  if (
    !entry.isCompact ||
    entry.role === "user" ||
    entry.role === "assistant" ||
    isStandaloneTranscriptEntry(entry)
  ) {
    return false;
  }

  return true;
}

function readCompactDiffParts(entries: AgentTranscriptEntry[]) {
  const partsByDisplayPath = new Map<string, DiffPart>();

  for (const part of entries.flatMap((entry) => entry.parts ?? [])) {
    if (part.type !== "diff") {
      continue;
    }

    const displayPath = part.filePath ?? part.title;
    const currentPart = partsByDisplayPath.get(displayPath);

    if (!currentPart) {
      partsByDisplayPath.set(displayPath, part);
      continue;
    }

    partsByDisplayPath.set(displayPath, {
      ...currentPart,
      additions: (currentPart.additions ?? 0) + (part.additions ?? 0),
      deletions: (currentPart.deletions ?? 0) + (part.deletions ?? 0)
    });
  }

  return Array.from(partsByDisplayPath.values());
}

function getCompactGroupKey(entry: AgentTranscriptEntry): CompactActivityKind {
  if (entry.parts?.some((part) => part.type === "diff")) {
    return "changes";
  }

  return entry.role === "tool" ? "tools" : "details";
}

function buildCompactGroupEntry(entries: AgentTranscriptEntry[]): AgentTranscriptEntry {
  if (entries.length === 1) {
    return entries[0];
  }

  const firstEntry = entries[0];
  const lastEntry = entries[entries.length - 1];
  const sourceEntryIds: string[] = [];
  const existingSourceEntryRanges: NonNullable<AgentTranscriptEntry["sourceEntryRanges"]> = [];
  const existingSourceEntrySpans: NonNullable<AgentTranscriptEntry["sourceEntrySpans"]> = [];

  for (const entry of entries) {
    if (entry.sourceEntryIds) {
      sourceEntryIds.push(...entry.sourceEntryIds);
    } else if (!entry.sourceEntryRanges?.length && !entry.sourceEntrySpans?.length) {
      sourceEntryIds.push(entry.id);
    }

    if (entry.sourceEntryRanges) {
      existingSourceEntryRanges.push(...entry.sourceEntryRanges);
    }

    if (entry.sourceEntrySpans) {
      existingSourceEntrySpans.push(...entry.sourceEntrySpans);
    }
  }

  const sourceRefs = compactAgentTranscriptSourceRefs(sourceEntryIds);
  const sourceEntryRanges = [
    ...(sourceRefs.sourceEntryRanges ?? []),
    ...existingSourceEntryRanges
  ];
  const sourceEntrySpans = [
    ...(sourceRefs.sourceEntrySpans ?? []),
    ...existingSourceEntrySpans
  ];
  const mergedSourceRefs = {
    ...sourceRefs,
    sourceEntryRanges: sourceEntryRanges.length > 0 ? sourceEntryRanges : undefined,
    sourceEntrySpans: sourceEntrySpans.length > 0 ? sourceEntrySpans : undefined
  };

  const sourceEntryCount = countAgentTranscriptSourceRefs(mergedSourceRefs);
  const groupKey = getCompactGroupKey(firstEntry);
  const label = groupKey === "changes"
    ? "Changes"
    : groupKey === "tools"
      ? "Tool events"
      : "Details";
  const diffParts = groupKey === "changes" ? readCompactDiffParts(entries) : [];
  const statusParts: TranscriptPart[] = groupKey === "changes"
    ? []
    : [
        {
          type: "status",
          label,
          detail: `${sourceEntryCount} entries load when this activity is opened`
        }
      ];

  return {
    id: `${firstEntry.id}:compact:${lastEntry.id}`,
    timestamp: lastEntry.timestamp,
    role: firstEntry.role,
    text: `${entries.length} entries hidden in live view`,
    phase: null,
    isCompact: true,
    ...mergedSourceRefs,
    sourceEntryCount,
    parts: [
      ...diffParts,
      ...statusParts
    ]
  };
}

function buildCompactGroupEntries(entries: AgentTranscriptEntry[]): AgentTranscriptEntry[] {
  if (entries.length === 1) {
    return entries;
  }

  const groups = new Map<CompactActivityKind, AgentTranscriptEntry[]>();

  for (const entry of entries) {
    const key = getCompactGroupKey(entry);
    const groupEntries = groups.get(key);

    if (groupEntries) {
      groupEntries.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }

  return Array.from(groups.entries())
    .sort(([left], [right]) => compactActivityKindOrder[left] - compactActivityKindOrder[right])
    .map(([, groupEntries]) => buildCompactGroupEntry(groupEntries));
}

function flushPendingCompactGroup(
  coalescedEntries: AgentTranscriptEntry[],
  pendingGroup: AgentTranscriptEntry[]
) {
  if (pendingGroup.length === 0) return pendingGroup;

  coalescedEntries.push(...buildCompactGroupEntries(pendingGroup));

  return [];
}

function coalesceCompactTranscriptEntries(entries: AgentTranscriptEntry[]) {
  const coalescedEntries: AgentTranscriptEntry[] = [];
  let pendingGroup: AgentTranscriptEntry[] = [];

  for (const entry of entries) {
    if (canCoalesceCompactTranscriptEntry(entry)) {
      pendingGroup.push(entry);
      continue;
    }

    pendingGroup = flushPendingCompactGroup(coalescedEntries, pendingGroup);
    coalescedEntries.push(entry);
  }

  flushPendingCompactGroup(coalescedEntries, pendingGroup);

  return coalescedEntries.length === entries.length ? entries : coalescedEntries;
}

function countDiffStats(value: string) {
  return value.split(/\r?\n/).reduce(
    (stats, line) => {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        stats.additions += 1;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        stats.deletions += 1;
      }

      return stats;
    },
    {
      additions: 0,
      deletions: 0
    }
  );
}

function summarizeDiffPart(part: DiffPart): DiffPart {
  const stats = countDiffStats(part.text);

  return {
    ...part,
    additions: stats.additions,
    deletions: stats.deletions,
    text: COMPACT_DIFF_PLACEHOLDER_TEXT
  };
}

function truncateText(value: string, limit: number) {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit).trimEnd()}...`;
}

function summarizeTranscriptPart(part: TranscriptPart): TranscriptPart {
  if (part.type === "diff") {
    return summarizeDiffPart(part);
  }

  if (part.type === "markdown") {
    const text = truncateText(part.text, MARKDOWN_TEXT_LIMIT);

    return text === part.text ? part : { ...part, text };
  }

  if (part.type === "tool_call") {
    return part.argumentsText === null ? part : { ...part, argumentsText: null };
  }

  if (part.type === "tool_result") {
    return part.text === TOOL_RESULT_SUMMARY ? part : { ...part, text: TOOL_RESULT_SUMMARY };
  }

  if (part.type === "status") {
    const detail = part.detail === null ? null : truncateText(part.detail, STATUS_DETAIL_LIMIT);

    return detail === part.detail ? part : { ...part, detail };
  }

  return part;
}

function summarizeTranscriptEntry(entry: AgentTranscriptEntry): AgentTranscriptEntry {
  if (
    entry.role === "user" ||
    entry.role === "assistant" ||
    isStandaloneTranscriptEntry(entry)
  ) {
    return entry;
  }

  const text = truncateText(entry.text, ENTRY_TEXT_LIMIT);
  const parts = entry.parts?.map(summarizeTranscriptPart);

  return {
    ...entry,
    isCompact: true,
    text,
    parts
  };
}

function findLatestLiveDetailEntryId(entries: AgentTranscriptEntry[]) {
  let lastChatEntryIndex = -1;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];

    if (entry.role === "user" || entry.role === "assistant") {
      lastChatEntryIndex = index;
    }
  }

  for (let index = entries.length - 1; index > lastChatEntryIndex; index -= 1) {
    const entry = entries[index];

    if (entry.role !== "tool" && entry.role !== "user" && entry.role !== "assistant") {
      return entry.id;
    }
  }

  return null;
}

export function summarizeAgentSessionTranscript(session: AgentSessionDetail): AgentSessionDetail {
  let changed = false;
  const preservedLiveDetailEntryId = findLatestLiveDetailEntryId(session.transcript);
  const summarizedTranscript = session.transcript.map((entry) => {
    if (entry.id === preservedLiveDetailEntryId) {
      return entry;
    }

    const summarizedEntry = summarizeTranscriptEntry(entry);

    if (summarizedEntry !== entry) {
      changed = true;
    }

    return summarizedEntry;
  });
  const transcript = coalesceCompactTranscriptEntries(summarizedTranscript);

  if (transcript !== summarizedTranscript) {
    changed = true;
  }

  return changed ? { ...session, transcript } : session;
}
