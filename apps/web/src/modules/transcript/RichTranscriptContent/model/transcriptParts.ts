import type { AgentTranscriptEntry, TranscriptPart } from "@deskcue/protocol";
import type {
  DiffPart,
  RichTranscriptContentEntry
} from "@modules/transcript/RichTranscriptContent/types";

import { groupDiffPartsByFile } from "./diffParts";

function isCompactActivityStatusPart(part: Extract<TranscriptPart, { type: "status" }>) {
  return part.detail?.endsWith("entries load when this activity is opened") ?? false;
}

function isPatchApplyStatusLabel(label: string) {
  return label === "Applied patch" || label === "Patch failed";
}

export function getRenderableTranscriptParts(parts: TranscriptPart[]) {
  const partsWithoutCompactSummaries = parts.filter(
    (part) => part.type !== "status" || !isCompactActivityStatusPart(part)
  );
  const diffCount = partsWithoutCompactSummaries.filter((part) => part.type === "diff").length;
  if (diffCount === 0) {
    return partsWithoutCompactSummaries;
  }

  return partsWithoutCompactSummaries.filter(
    (part) =>
      part.type !== "status" ||
      !isPatchApplyStatusLabel(part.label)
  );
}

export function shouldRenderTranscriptEntryBare(
  entry: Pick<AgentTranscriptEntry, "role" | "parts">
) {
  if (entry.role !== "tool" || !entry.parts?.length) {
    return false;
  }

  const parts = getRenderableTranscriptParts(entry.parts);
  return parts.length > 0 && parts.every((part) => part.type === "diff");
}

export function mergeBareTranscriptEntries(
  entries: Array<Pick<AgentTranscriptEntry, "role" | "text" | "parts">>
): Pick<AgentTranscriptEntry, "text" | "parts"> | null {
  const mergedParts = entries.flatMap((entry) => {
    if (!shouldRenderTranscriptEntryBare(entry)) {
      return [];
    }

    return getRenderableTranscriptParts(entry.parts ?? []).filter(
      (part): part is DiffPart => part.type === "diff"
    );
  });

  if (mergedParts.length === 0) {
    return null;
  }

  return {
    text: "",
    parts: mergedParts
  };
}

export function shouldOrderAttachmentsBeforeMarkdown(entry: RichTranscriptContentEntry) {
  return "role" in entry && entry.role === "user";
}

export function orderAttachmentsBeforeMarkdown(parts: TranscriptPart[]) {
  const orderedParts: TranscriptPart[] = [];
  let primaryRun: TranscriptPart[] = [];

  const flushPrimaryRun = () => {
    if (primaryRun.length === 0) {
      return;
    }

    orderedParts.push(
      ...primaryRun.filter((part) => part.type === "attachment"),
      ...primaryRun.filter((part) => part.type !== "attachment")
    );
    primaryRun = [];
  };

  for (const part of parts) {
    if (part.type === "markdown" || part.type === "attachment") {
      primaryRun.push(part);
      continue;
    }

    flushPrimaryRun();
    orderedParts.push(part);
  }

  flushPrimaryRun();
  return orderedParts;
}

export function buildSecondaryPartsLabel(parts: TranscriptPart[]) {
  const diffParts = parts.filter((part): part is DiffPart => part.type === "diff");
  const diffCount = groupDiffPartsByFile(diffParts).length;
  const toolCount = parts.filter(
    (part) => part.type === "tool_call" || part.type === "tool_result"
  ).length;

  const otherCount = parts.length - toolCount - diffParts.length;

  if (diffCount > 0 && toolCount === 0 && otherCount === 0) {
    return diffCount === 1 ? "Changes (1)" : `Changes (${diffCount})`;
  }

  if (diffCount > 0 && toolCount === 0) {
    return `Changes and details (${parts.length})`;
  }

  if (diffCount > 0) {
    return `Changes, tools, and details (${parts.length})`;
  }

  if (toolCount > 0 && otherCount === 0) {
    return toolCount === 1 ? "Tools (1)" : `Tools (${toolCount})`;
  }

  if (toolCount > 0) {
    return `Tools and details (${parts.length})`;
  }

  return parts.length === 1 ? "Details (1)" : `Details (${parts.length})`;
}
