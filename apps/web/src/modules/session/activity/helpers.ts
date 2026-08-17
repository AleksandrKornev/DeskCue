import type { ChatTranscriptEntry } from "@modules/session/types";

import { COMPACT_DIFF_PLACEHOLDER_TEXT } from "./constants";

export function isCompactSummaryEntry(entry: ChatTranscriptEntry) {
  if (entry.isCompact !== true) {
    return false;
  }

  const parts = entry.parts ?? [];
  return (
    parts.length === 0 ||
    parts.every(
      (part) =>
        part.type === "diff" &&
        part.text === COMPACT_DIFF_PLACEHOLDER_TEXT
    ) ||
    parts.every(
      (part) =>
        part.type === "status" &&
        (part.detail?.endsWith("entries load when this activity is opened") ?? false)
    )
  );
}
