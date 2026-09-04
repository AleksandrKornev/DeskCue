import type { AgentTranscriptEntry, TranscriptPart } from "@deskcue/protocol";
import type {
  DiffPart,
  RichTranscriptContentEntry
} from "@modules/transcript/RichTranscriptContent/types";

import {
  normalizeMarkdownLocalAssetPath
} from "./attachments";
import { isCompactActivityStatusPart } from "./compactActivityStatus";
import { groupDiffPartsByFile } from "./diffParts";
import { getMarkdownAssetSources } from "./markdown";

function isPatchApplyStatusLabel(label: string) {
  return label === "Applied patch" || label === "Patch failed";
}

function getComparableAssetReference(value: string | null) {
  if (!value) return null;

  const localPath = normalizeMarkdownLocalAssetPath(value);

  if (!localPath) {
    if (!/^https?:\/\//iu.test(value)) return null;

    try {
      return new URL(value).href;
    } catch {
      return value;
    }
  }

  const normalizedPath = localPath.replaceAll("\\", "/");

  return /^[A-Za-z]:\//u.test(normalizedPath)
    ? normalizedPath.toLowerCase()
    : normalizedPath;
}

function removeAttachmentsRepresentedInMarkdown(parts: TranscriptPart[]) {
  const localAssetPaths = new Set(
    parts
      .filter((part): part is Extract<TranscriptPart, { type: "markdown" }> => part.type === "markdown")
      .flatMap((part) => getMarkdownAssetSources(part.text))
      .map(getComparableAssetReference)
      .filter((path): path is string => path !== null)
  );

  if (localAssetPaths.size === 0) return parts;

  return parts.filter((part) => {
    if (part.type !== "attachment") return true;

    const attachmentPath = getComparableAssetReference(part.path ?? part.url);

    return !attachmentPath || !localAssetPaths.has(attachmentPath);
  });
}

export function getRenderableTranscriptParts(parts: TranscriptPart[]) {
  const partsWithoutCompactSummaries = parts.filter(
    (part) => !isCompactActivityStatusPart(part)
  );
  const diffCount = partsWithoutCompactSummaries.filter((part) => part.type === "diff").length;

  if (diffCount === 0) return removeAttachmentsRepresentedInMarkdown(partsWithoutCompactSummaries);

  return removeAttachmentsRepresentedInMarkdown(
    partsWithoutCompactSummaries.filter(
      (part) =>
        part.type !== "status" ||
        !isPatchApplyStatusLabel(part.label)
    )
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

export function orderAttachmentsBeforeMarkdown(parts: TranscriptPart[]) {
  const firstPrimaryIndex = parts.findIndex(
    (part) => part.type === "markdown" || part.type === "attachment"
  );

  if (firstPrimaryIndex < 0) return parts;

  let lastPrimaryIndex = firstPrimaryIndex;

  for (let index = firstPrimaryIndex + 1; index < parts.length; index += 1) {
    const part = parts[index];

    if (part.type === "markdown" || part.type === "attachment") {
      lastPrimaryIndex = index;
    }
  }

  const primaryRun = parts.slice(firstPrimaryIndex, lastPrimaryIndex + 1);
  const hasSecondaryPartInsideRun = primaryRun.some(
    (part) => part.type !== "markdown" && part.type !== "attachment"
  );

  if (hasSecondaryPartInsideRun) return parts;

  const firstAttachmentIndex = primaryRun.findIndex((part) => part.type === "attachment");
  const hasMarkdownAfterAttachment = firstAttachmentIndex >= 0 && primaryRun
    .slice(firstAttachmentIndex + 1)
    .some((part) => part.type === "markdown");

  if (hasMarkdownAfterAttachment) return parts;

  return [
    ...parts.slice(0, firstPrimaryIndex),
    ...primaryRun.filter((part) => part.type === "attachment"),
    ...primaryRun.filter((part) => part.type === "markdown"),
    ...parts.slice(lastPrimaryIndex + 1)
  ];
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
