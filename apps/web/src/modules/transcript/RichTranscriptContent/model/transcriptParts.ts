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

  if (diffCount === 0) return partsWithoutCompactSummaries;

  return partsWithoutCompactSummaries.filter(
    (part) =>
      part.type !== "status" ||
      !isPatchApplyStatusLabel(part.label)
  );
}

export function shouldRenderTranscriptEntryBare(
  entry: Pick<AgentTranscriptEntry, "role" | "parts">
) {
  if (entry.role !== "tool" || !entry.parts?.length) return false;

  const parts = getRenderableTranscriptParts(entry.parts);

  return parts.length > 0 && parts.every((part) => part.type === "diff");
}

export function mergeBareTranscriptEntries(
  entries: Array<Pick<AgentTranscriptEntry, "role" | "text" | "parts">>
): Pick<AgentTranscriptEntry, "text" | "parts"> | null {
  const mergedParts = entries.flatMap((entry) => {
    if (!shouldRenderTranscriptEntryBare(entry)) return [];

    return getRenderableTranscriptParts(entry.parts ?? []).filter(
      (part): part is DiffPart => part.type === "diff"
    );
  });

  if (mergedParts.length === 0) return null;

  return {
    text: "",
    parts: mergedParts
  };
}

export function shouldOrderAttachmentsBeforeMarkdown(entry: RichTranscriptContentEntry) {
  return "role" in entry && entry.role === "user";
}

function flushPrimaryTranscriptPartRun(
  orderedParts: TranscriptPart[],
  primaryRun: TranscriptPart[]
) {
  if (primaryRun.length === 0) return primaryRun;

  orderedParts.push(
    ...primaryRun.filter((part) => part.type === "attachment"),
    ...primaryRun.filter((part) => part.type !== "attachment")
  );

  return [];
}

export function orderAttachmentsBeforeMarkdown(parts: TranscriptPart[]) {
  const orderedParts: TranscriptPart[] = [];
  let primaryRun: TranscriptPart[] = [];

  for (const part of parts) {
    if (part.type === "markdown" || part.type === "attachment") {
      primaryRun.push(part);
      continue;
    }

    primaryRun = flushPrimaryTranscriptPartRun(orderedParts, primaryRun);
    orderedParts.push(part);
  }

  flushPrimaryTranscriptPartRun(orderedParts, primaryRun);
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

  if (diffCount > 0 && toolCount === 0) return `Changes and details (${parts.length})`;
  if (diffCount > 0) return `Changes, tools, and details (${parts.length})`;
  if (toolCount > 0 && otherCount === 0) return toolCount === 1 ? "Tools (1)" : `Tools (${toolCount})`;
  if (toolCount > 0) return `Tools and details (${parts.length})`;

  return parts.length === 1 ? "Details (1)" : `Details (${parts.length})`;
}

type SecondaryTranscriptPartGroup = {
  parts: TranscriptPart[];
  pendingToolName: string | null;
};

function getPendingToolGroups(
  groups: SecondaryTranscriptPartGroup[],
  toolName?: string | null
) {
  return groups.filter(
    (group) =>
      group.pendingToolName !== null &&
      (toolName === undefined || group.pendingToolName === toolName)
  );
}

function moveSecondaryGroupToEnd(
  groups: SecondaryTranscriptPartGroup[],
  group: SecondaryTranscriptPartGroup
) {
  const groupIndex = groups.indexOf(group);

  if (groupIndex < 0 || groupIndex === groups.length - 1) return;

  groups.splice(groupIndex, 1);
  groups.push(group);
}

export function groupSecondaryTranscriptParts(parts: TranscriptPart[]) {
  const groups: SecondaryTranscriptPartGroup[] = [];

  for (const part of parts) {
    if (part.type === "tool_call") {
      groups.push({ parts: [part], pendingToolName: part.toolName });
      continue;
    }

    if (part.type === "tool_result") {
      const candidates = part.toolName
        ? getPendingToolGroups(groups, part.toolName)
        : getPendingToolGroups(groups);

      if (candidates.length === 1) {
        candidates[0].parts.push(part);
        candidates[0].pendingToolName = null;
        moveSecondaryGroupToEnd(groups, candidates[0]);
      } else {
        groups.push({ parts: [part], pendingToolName: null });
      }

      continue;
    }

    const pendingGroups = getPendingToolGroups(groups);

    if (pendingGroups.length === 1) {
      pendingGroups[0].parts.push(part);
      moveSecondaryGroupToEnd(groups, pendingGroups[0]);
    } else {
      groups.push({ parts: [part], pendingToolName: null });
    }
  }

  return groups.map((group) => group.parts);
}
