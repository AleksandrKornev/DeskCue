import type {
  AgentSessionDetail,
  AgentTranscriptActivityGroup,
  AgentTranscriptChangesResponse,
  AgentTranscriptEntry,
  AgentTranscriptViewResponse,
  TranscriptPart
} from "@deskcue/protocol";

import {
  buildConversationActivityGroup,
  compactTranscriptViewSourceRefs
} from "./agentTranscriptActivityGroups.ts";
import {
  buildTranscriptChangesResponseFromEntries,
  groupDiffPartsByFile,
  readDiffParts
} from "./agentTranscriptChanges.ts";
import { pruneOverlappingCompactTranscriptEntries } from "./agentTranscriptSourceRefs.ts";
import {
  buildConversationTimeline,
  isChatMessageEntry,
  isContextCompactionEntry,
  isLifecycleStatusEntry,
  isModelChangeEntry
} from "./agentTranscriptTimeline.ts";

function isWaitingDetailEntry(entry: AgentTranscriptEntry) {
  return (
    !isChatMessageEntry(entry) &&
    entry.role !== "tool" &&
    !isLifecycleStatusEntry(entry) &&
    !isContextCompactionEntry(entry) &&
    !isModelChangeEntry(entry)
  );
}

function readTimestamp(value: string) {
  const parsed = new Date(value).getTime();

  return Number.isFinite(parsed) ? parsed : 0;
}

function findLatestWaitingDetailEntry(
  entries: AgentTranscriptEntry[],
  since: string | null | undefined
) {
  const sinceTime = since ? readTimestamp(since) : null;
  let lastChatEntryIndex = -1;
  let fallbackEntry: AgentTranscriptEntry | null = null;

  for (let index = 0; index < entries.length; index += 1) {
    if (isChatMessageEntry(entries[index])) {
      lastChatEntryIndex = index;
    }
  }

  for (let index = entries.length - 1; index > lastChatEntryIndex; index -= 1) {
    const entry = entries[index];
    const entryTime = readTimestamp(entry.timestamp);

    if (!isWaitingDetailEntry(entry) || (sinceTime !== null && entryTime < sinceTime)) {
      continue;
    }

    if (!entry.isCompact) {
      return entry;
    }

    fallbackEntry ??= entry;
  }

  return fallbackEntry;
}

function getTranscriptEntryText(entry: AgentTranscriptEntry) {
  const markdownText =
    entry.parts
      ?.filter(
        (part): part is Extract<TranscriptPart, { type: "markdown" }> =>
          part.type === "markdown"
      )
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n\n") ?? "";

  return (markdownText || entry.text).trim();
}

function isInjectedEnvironmentContextEntry(entry: AgentTranscriptEntry) {
  if (entry.role !== "user") {
    return false;
  }

  const text = getTranscriptEntryText(entry);

  if (!text) {
    return false;
  }

  const normalized = text.trim();

  if (
    normalized.startsWith("<recommended_plugins>") &&
    normalized.includes("</recommended_plugins>") &&
    !normalized.includes("<environment_context>")
  ) {
    return true;
  }

  if (
    !normalized.includes("<environment_context>") ||
    !normalized.includes("</environment_context>")
  ) {
    return false;
  }

  const textAfterEnvironmentContext = normalized
    .replace(/^[\s\S]*?<\/environment_context>\s*/i, "")
    .trim();

  return (
    !textAfterEnvironmentContext &&
    (normalized.startsWith("<environment_context>") ||
      normalized.startsWith("<recommended_plugins>") ||
      /^(?:#+\s*)?AGENTS\.md instructions for /i.test(normalized))
  );
}

function filterHumanVisibleTranscriptEntries(entries: AgentTranscriptEntry[]) {
  return entries.filter((entry) => !isInjectedEnvironmentContextEntry(entry));
}

function getConversationEntryAttachmentKey(entry: AgentTranscriptEntry) {
  return (entry.parts ?? [])
    .filter((part) => part.type === "attachment")
    .map((part) => [part.kind, part.path, part.url, part.label].join(":"))
    .sort()
    .join("|");
}

function getConversationEntryTextKey(entry: AgentTranscriptEntry) {
  const markdownText =
    entry.parts
      ?.filter((part) => part.type === "markdown")
      .map((part) => part.text)
      .join("\n\n") || entry.text;

  return markdownText
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function isDuplicateChatEntry(
  previousEntry: AgentTranscriptEntry | undefined,
  nextEntry: AgentTranscriptEntry
) {
  if (
    !previousEntry ||
    !isChatMessageEntry(previousEntry) ||
    !isChatMessageEntry(nextEntry)
  ) {
    return false;
  }

  if (previousEntry.role !== nextEntry.role) {
    return false;
  }

  const previousTextKey = getConversationEntryTextKey(previousEntry);
  const nextTextKey = getConversationEntryTextKey(nextEntry);

  if (!previousTextKey || previousTextKey !== nextTextKey) {
    return false;
  }

  if (
    getConversationEntryAttachmentKey(previousEntry) !==
    getConversationEntryAttachmentKey(nextEntry)
  ) {
    return false;
  }

  const previousTime = readTimestamp(previousEntry.timestamp);
  const nextTime = readTimestamp(nextEntry.timestamp);

  return Math.abs(nextTime - previousTime) <= 5_000;
}

type TranscriptSourcePosition = {
  index: number;
  prefix: string;
};

function parseTranscriptSourcePosition(entryId: string): TranscriptSourcePosition | null {
  const separatorIndex = entryId.lastIndexOf("-");

  if (separatorIndex < 0 || separatorIndex === entryId.length - 1) return null;

  const index = Number(entryId.slice(separatorIndex + 1));

  if (!Number.isInteger(index) || index < 0) return null;

  return {
    index,
    prefix: entryId.slice(0, separatorIndex + 1)
  };
}

function readTranscriptSourcePosition(entry: AgentTranscriptEntry) {
  const ranges = [
    ...(entry.sourceEntryRanges ?? []),
    ...(entry.sourceEntrySpans ?? [])
  ];

  if (ranges.length > 0) {
    const prefix = ranges[0]?.prefix;

    if (prefix && ranges.every((range) => range.prefix === prefix)) {
      return {
        index: Math.min(...ranges.map((range) => range.start)),
        prefix
      };
    }
  }

  const sourcePositions = (entry.sourceEntryIds ?? [])
    .map(parseTranscriptSourcePosition)
    .filter((position): position is TranscriptSourcePosition => position !== null);
  const fallbackPosition = parseTranscriptSourcePosition(entry.id);

  if (fallbackPosition) sourcePositions.push(fallbackPosition);

  if (sourcePositions.length === 0) return null;

  const prefix = sourcePositions[0]?.prefix;

  if (!prefix || !sourcePositions.every((position) => position.prefix === prefix)) return null;

  return sourcePositions.reduce((earliest, position) =>
    position.index < earliest.index ? position : earliest
  );
}

function sortConversationEntries(entries: AgentTranscriptEntry[]) {
  const entriesWithSourcePositions = entries.map((entry) => ({
    entry,
    sourcePosition: readTranscriptSourcePosition(entry)
  }));
  const sourcePrefixes = new Set(
    entriesWithSourcePositions.flatMap(({ sourcePosition }) =>
      sourcePosition ? [sourcePosition.prefix] : []
    )
  );
  const hasSharedSourceCoordinates = sourcePrefixes.size === 1 &&
    entriesWithSourcePositions.every(({ sourcePosition }) => sourcePosition !== null);

  return entriesWithSourcePositions.sort((left, right) => {
    if (
      hasSharedSourceCoordinates &&
      left.sourcePosition &&
      right.sourcePosition &&
      left.sourcePosition.index !== right.sourcePosition.index
    ) {
      return left.sourcePosition.index - right.sourcePosition.index;
    }

    const timeDelta = readTimestamp(left.entry.timestamp) - readTimestamp(right.entry.timestamp);

    return timeDelta === 0 ? left.entry.id.localeCompare(right.entry.id) : timeDelta;
  }).map(({ entry }) => entry);
}

function normalizeConversationEntries(entries: AgentTranscriptEntry[]) {
  const normalizedEntries: AgentTranscriptEntry[] = [];
  const seenEntryIds = new Set<string>();

  for (const entry of pruneOverlappingCompactTranscriptEntries(sortConversationEntries(entries))) {
    if (seenEntryIds.has(entry.id)) {
      continue;
    }

    if (isDuplicateChatEntry(normalizedEntries[normalizedEntries.length - 1], entry)) {
      continue;
    }

    normalizedEntries.push(entry);
    seenEntryIds.add(entry.id);
  }

  return normalizedEntries;
}

export function buildAgentTranscriptView(
  session: AgentSessionDetail,
  options: { waitingSince?: string | null } = {}
): AgentTranscriptViewResponse {
  const entries = normalizeConversationEntries(
    filterHumanVisibleTranscriptEntries(session.transcript)
  );
  const items = buildConversationTimeline(
    entries,
    session.agentLabel,
    session.interruptLifecycle
  );

  return compactTranscriptViewSourceRefs({
    sessionId: session.id,
    updatedAt: session.updatedAt,
    items,
    latestWaitingDetailEntry: findLatestWaitingDetailEntry(
      entries,
      options.waitingSince
    )
  });
}

export function findAgentTranscriptActivityGroup(
  session: AgentSessionDetail,
  groupId: string
) {
  const view = buildAgentTranscriptView(session);

  return (
    view.items
      .flatMap((item) =>
        item.type === "message"
          ? [...item.activities, ...item.changeActivities]
          : [item.activity]
      )
      .find((group) => group.id === groupId) ?? null
  );
}

export function buildAgentTranscriptActivityGroupFromEntries(
  groupId: string,
  entries: AgentTranscriptEntry[]
): AgentTranscriptActivityGroup | null {
  if (entries.length === 0) {
    return null;
  }

  const group = buildConversationActivityGroup(entries, `exact:${groupId}`);

  return {
    ...group,
    id: groupId
  };
}

export function buildAgentTranscriptChangesResponse(
  session: AgentSessionDetail,
  groupId: string
): AgentTranscriptChangesResponse | null {
  const group = findAgentTranscriptActivityGroup(session, groupId);

  if (!group || group.kind !== "changes") {
    return null;
  }

  return {
    sessionId: session.id,
    groupId,
    files: groupDiffPartsByFile(readDiffParts(group.entries))
  };
}

export function buildAgentTranscriptChangesResponseFromEntries(
  sessionId: string,
  groupId: string,
  entries: AgentTranscriptEntry[]
): AgentTranscriptChangesResponse | null {
  return buildTranscriptChangesResponseFromEntries(sessionId, groupId, entries);
}
