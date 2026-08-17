import type {
  AgentTranscriptChangesFile,
  AgentTranscriptChangesResponse,
  AgentTranscriptEntry,
  TranscriptPart
} from "@deskcue/protocol";

export type DiffPart = Extract<TranscriptPart, { type: "diff" }>;

function countDiffStats(value: string) {
  return value.split(/\r?\n/).reduce(
    (stats, line) => {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        stats.additions += 1;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        stats.deletions += 1;
      }

      return stats;
    },
    {
      additions: 0,
      deletions: 0
    }
  );
}

function getDiffPartStats(part: DiffPart) {
  if (
    typeof part.additions === "number" &&
    typeof part.deletions === "number"
  ) {
    return {
      additions: part.additions,
      deletions: part.deletions
    };
  }

  return countDiffStats(part.text);
}

function getDiffDisplayPath(part: DiffPart) {
  if (part.changeType === "move") {
    const moveTarget = part.title.replace(/^Moved\s+/, "").trim();
    if (moveTarget) {
      return moveTarget;
    }
  }

  return part.filePath ?? part.title;
}

export function groupDiffPartsByFile(parts: DiffPart[]): AgentTranscriptChangesFile[] {
  const groups: AgentTranscriptChangesFile[] = [];
  const groupIndexByPath = new Map<string, number>();

  for (const part of parts) {
    const displayPath = getDiffDisplayPath(part);
    const stats = getDiffPartStats(part);
    const groupIndex = groupIndexByPath.get(displayPath);

    if (groupIndex === undefined) {
      groupIndexByPath.set(displayPath, groups.length);
      groups.push({
        additions: stats.additions,
        changeType: part.changeType,
        deletions: stats.deletions,
        displayPath,
        parts: [part]
      });
      continue;
    }

    const group = groups[groupIndex];
    group.additions += stats.additions;
    group.deletions += stats.deletions;
    group.changeType = part.changeType;
    group.parts.push(part);
  }

  return groups;
}

export function readDiffParts(entries: AgentTranscriptEntry[]) {
  return entries.flatMap((entry) =>
    entry.parts?.filter((part): part is DiffPart => part.type === "diff") ?? []
  );
}

export function buildTranscriptChangesResponseFromEntries(
  sessionId: string,
  groupId: string,
  entries: AgentTranscriptEntry[]
): AgentTranscriptChangesResponse | null {
  const diffParts = readDiffParts(entries);
  return diffParts.length === 0
    ? null
    : {
        sessionId,
        groupId,
        files: groupDiffPartsByFile(diffParts)
      };
}

export function hasOnlyHiddenDiffPlaceholders(parts: DiffPart[]) {
  return parts.length > 0 && parts.every((part) =>
    part.title === "Changes" &&
    part.filePath === null &&
    part.text === "[diff hidden in live view]"
  );
}
