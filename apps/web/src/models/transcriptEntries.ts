import type { AgentTranscriptEntry, TranscriptPart } from "@deskcue/protocol";
import { doAgentTranscriptSourceRefsOverlap } from "@deskcue/protocol";

type TranscriptEntryLike = Pick<AgentTranscriptEntry, "role" | "text" | "parts">;
type CompactTranscriptEntryLike = Pick<
  AgentTranscriptEntry,
  "id" | "isCompact" | "sourceEntryCount" | "sourceEntryIds" | "sourceEntryRanges" | "sourceEntrySpans"
>;

export function labelForTranscriptRole(role: AgentTranscriptEntry["role"]) {
  if (role === "user") {
    return "User";
  }

  if (role === "assistant") {
    return "Assistant";
  }

  if (role === "commentary") {
    return "Commentary";
  }

  if (role === "tool") {
    return "Tool";
  }

  return "System";
}

function getTranscriptEntryText(entry: TranscriptEntryLike) {
  const markdownText =
    entry.parts
      ?.filter((part): part is Extract<TranscriptPart, { type: "markdown" }> => part.type === "markdown")
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n\n") ?? "";

  return (markdownText || entry.text).trim();
}

export function isInjectedEnvironmentContextEntry(entry: TranscriptEntryLike) {
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

  if (!normalized.includes("<environment_context>") || !normalized.includes("</environment_context>")) {
    return false;
  }

  const textAfterEnvironmentContext = normalized
    .replace(/^[\s\S]*?<\/environment_context>\s*/i, "")
    .trim();

  return (
    !textAfterEnvironmentContext &&
    (
      normalized.startsWith("<environment_context>") ||
      normalized.startsWith("<recommended_plugins>") ||
      /^(?:#+\s*)?AGENTS\.md instructions for /i.test(normalized)
    )
  );
}

export function filterHumanVisibleTranscriptEntries<TEntry extends TranscriptEntryLike>(entries: TEntry[]) {
  return entries.filter((entry) => !isInjectedEnvironmentContextEntry(entry));
}

function isCompactEntryWithSources<TEntry extends CompactTranscriptEntryLike>(
  entry: TEntry
) {
  return entry.isCompact === true && Boolean(
    entry.sourceEntryIds?.length ||
    entry.sourceEntryRanges?.length ||
    entry.sourceEntrySpans?.length
  );
}

function pruneCoveredCompactEntries<TEntry extends CompactTranscriptEntryLike>(
  entries: TEntry[],
  nextEntry: TEntry
) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const currentEntry = entries[index];
    if (
      currentEntry.id !== nextEntry.id &&
      isCompactEntryWithSources(currentEntry) &&
      doAgentTranscriptSourceRefsOverlap(currentEntry, nextEntry)
    ) {
      entries.splice(index, 1);
    }
  }
}

export function pruneOverlappingCompactTranscriptEntries<TEntry extends CompactTranscriptEntryLike>(
  entries: TEntry[]
) {
  const prunedEntries: TEntry[] = [];

  for (const entry of entries) {
    if (isCompactEntryWithSources(entry)) {
      pruneCoveredCompactEntries(prunedEntries, entry);
    }

    prunedEntries.push(entry);
  }

  return prunedEntries;
}
