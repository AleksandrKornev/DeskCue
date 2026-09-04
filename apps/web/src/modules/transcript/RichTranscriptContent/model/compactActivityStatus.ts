import type { TranscriptPart } from "@deskcue/protocol";

const COMPACT_ACTIVITY_DETAIL_PATTERN =
  /^\d+(?: detail| tool)? entr(?:y loads|ies load) when this activity is opened$/u;

export function isCompactActivityStatusPart(part: TranscriptPart) {
  if (part.type !== "status") return false;
  if (part.label !== "Details" && part.label !== "Tool events") return false;

  return COMPACT_ACTIVITY_DETAIL_PATTERN.test(part.detail ?? "");
}
