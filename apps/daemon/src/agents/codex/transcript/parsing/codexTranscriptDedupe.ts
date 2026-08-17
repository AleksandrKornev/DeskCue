import type { CodexTranscriptEntry, TranscriptPart } from "@deskcue/protocol";

function shouldMergeDuplicateUserEntries(
  previousEntry: CodexTranscriptEntry | undefined,
  nextEntry: CodexTranscriptEntry
) {
  if (!previousEntry || previousEntry.role !== "user" || nextEntry.role !== "user") return false;
  const previousText = previousEntry.text.trim();
  const nextText = nextEntry.text.trim();
  if (!previousText || previousText !== nextText) return false;
  const previousTimestamp = Date.parse(previousEntry.timestamp);
  const nextTimestamp = Date.parse(nextEntry.timestamp);
  return Number.isFinite(previousTimestamp) &&
    Number.isFinite(nextTimestamp) &&
    Math.abs(nextTimestamp - previousTimestamp) <= 5000;
}

function getTranscriptPartDedupeKey(part: TranscriptPart) {
  switch (part.type) {
    case "markdown":
      return `markdown:${part.text}`;
    case "diff":
      return `diff:${part.filePath ?? ""}:${part.changeType}:${part.title}:${part.text}`;
    case "attachment":
      return `attachment:${part.kind}:${part.path ?? ""}:${part.url ?? ""}:${part.label}`;
    case "status":
      return `status:${part.label}:${part.detail ?? ""}`;
    case "tool_call":
      return `tool_call:${part.namespace ?? ""}:${part.toolName}:${part.argumentsText ?? ""}`;
    case "tool_result":
      return `tool_result:${part.toolName ?? ""}:${part.status}:${part.text}`;
    default:
      return JSON.stringify(part);
  }
}

function mergeTranscriptParts(
  leftParts: TranscriptPart[] | undefined,
  rightParts: TranscriptPart[] | undefined
) {
  const merged: TranscriptPart[] = [];
  const seen = new Set<string>();
  for (const part of [...(leftParts ?? []), ...(rightParts ?? [])]) {
    const dedupeKey = getTranscriptPartDedupeKey(part);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    merged.push(part);
  }
  return merged.length > 0 ? merged : undefined;
}

function mergeDuplicateUserEntries(
  previousEntry: CodexTranscriptEntry,
  nextEntry: CodexTranscriptEntry
) {
  return {
    ...previousEntry,
    text: nextEntry.text.length > previousEntry.text.length ? nextEntry.text : previousEntry.text,
    parts: mergeTranscriptParts(previousEntry.parts, nextEntry.parts)
  } satisfies CodexTranscriptEntry;
}

export function dedupeCodexTranscriptEntries(entries: CodexTranscriptEntry[]) {
  const deduped: CodexTranscriptEntry[] = [];
  for (const entry of entries) {
    const previousEntry = deduped[deduped.length - 1];
    if (shouldMergeDuplicateUserEntries(previousEntry, entry)) {
      deduped[deduped.length - 1] = mergeDuplicateUserEntries(previousEntry, entry);
    } else {
      deduped.push(entry);
    }
  }
  return deduped;
}
