export const COMPACT_DIFF_PLACEHOLDER_TEXT = "[diff hidden in live view]";

type CompactDiffPlaceholderCandidate = {
  filePath: string | null;
  text: string;
  title: string;
  type: string;
};

type TranscriptPartTextCandidate = {
  text?: string;
  type: string;
};

export function hasCompactDiffPlaceholderText(part: TranscriptPartTextCandidate) {
  return part.type === "diff" && part.text === COMPACT_DIFF_PLACEHOLDER_TEXT;
}

export function isCanonicalCompactDiffPlaceholderPart(part: CompactDiffPlaceholderCandidate) {
  return hasCompactDiffPlaceholderText(part) &&
    part.title === "Changes" &&
    part.filePath === null;
}
