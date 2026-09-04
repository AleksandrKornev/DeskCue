import { hasCompactDiffPlaceholderText } from "@deskcue/protocol/transcript/compact-diff";
import type { ChatTranscriptEntry } from "@modules/session/types";
import { isCompactActivityStatusPart } from "@modules/transcript/RichTranscriptContent/model/compactActivityStatus";

export function isCompactSummaryEntry(entry: ChatTranscriptEntry) {
  if (entry.isCompact !== true) {
    return false;
  }

  const parts = entry.parts ?? [];

  return (
    parts.length === 0 ||
    parts.every(
      (part) =>
        hasCompactDiffPlaceholderText(part)
    ) ||
    parts.every(
      isCompactActivityStatusPart
    )
  );
}
