import type { DiffFileGroup, DiffPart } from "@modules/transcript/RichTranscriptContent/types";

export function splitDiffLines(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function normalizeDiffHeaderPath(value: string) {
  if (value.startsWith("a/") || value.startsWith("b/")) {
    return value.slice(2);
  }

  return value;
}

function isChangedDiffLine(line: string) {
  return (
    (line.startsWith("+") && !line.startsWith("+++")) ||
    (line.startsWith("-") && !line.startsWith("---"))
  );
}

function inferDiffFilePath(value: string) {
  const lines = splitDiffLines(value);
  const renameToLine = lines.find((line) => line.startsWith("rename to "));
  if (renameToLine) {
    return renameToLine.replace(/^rename to\s+/, "").trim();
  }

  const plusPlusPlusLine = lines.find(
    (line) => line.startsWith("+++ ") && !line.startsWith("+++ /dev/null")
  );

  if (plusPlusPlusLine) {
    return normalizeDiffHeaderPath(plusPlusPlusLine.slice(4).trim());
  }

  const diffHeaderLine = lines.find((line) => line.startsWith("diff --git "));
  if (diffHeaderLine) {
    const match = diffHeaderLine.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (match) {
      return match[2];
    }
  }

  return null;
}

function isChangedDiffLinePresent(lines: string[]) {
  return lines.some((line) => isChangedDiffLine(line));
}

function inferDiffChangeType(value: string): DiffPart["changeType"] {
  const lines = splitDiffLines(value);

  if (lines.some((line) => line.startsWith("rename from ")) || lines.some((line) => line.startsWith("rename to "))) {
    return "move";
  }

  if (lines.some((line) => line.startsWith("new file mode ")) || lines.some((line) => line.startsWith("--- /dev/null"))) {
    return "add";
  }

  if (lines.some((line) => line.startsWith("deleted file mode ")) || lines.some((line) => line.startsWith("+++ /dev/null"))) {
    return "delete";
  }

  if (isChangedDiffLinePresent(lines)) {
    return "update";
  }

  return "unknown";
}

export function createSyntheticDiffPart(text: string, title: string): DiffPart {
  return {
    type: "diff",
    title,
    text,
    filePath: inferDiffFilePath(text),
    changeType: inferDiffChangeType(text)
  };
}

export function looksLikeUnifiedDiff(value: string) {
  const lines = splitDiffLines(value).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return false;
  }

  const hasDiffHeader = lines.some((line) => line.startsWith("diff --git "));
  const hasHunk = lines.some((line) => line.startsWith("@@ "));
  const hasFileHeaders =
    lines.some((line) => line.startsWith("--- ")) &&
    lines.some((line) => line.startsWith("+++ "));

  const changedLineCount = lines.filter((line) => isChangedDiffLine(line)).length;

  return (hasDiffHeader || hasHunk || hasFileHeaders) && changedLineCount > 0;
}

export function getDiffStats(lines: string[]) {
  return lines.reduce(
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

export function getDiffDisplayPath(part: DiffPart) {
  if (part.changeType === "move") {
    const moveTarget = part.title.replace(/^Moved\s+/, "").trim();
    if (moveTarget) {
      return moveTarget;
    }
  }

  return part.filePath ?? part.title;
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

  return getDiffStats(splitDiffLines(part.text));
}

export function groupDiffPartsByFile(parts: DiffPart[]) {
  const groups: DiffFileGroup[] = [];
  const groupIndexByPath = new Map<string, number>();

  for (const part of parts) {
    const displayPath = getDiffDisplayPath(part);
    const diffStats = getDiffPartStats(part);
    const groupIndex = groupIndexByPath.get(displayPath);

    if (groupIndex === undefined) {
      groupIndexByPath.set(displayPath, groups.length);
      groups.push({
        additions: diffStats.additions,
        changeType: part.changeType,
        deletions: diffStats.deletions,
        displayPath,
        parts: [part]
      });
      continue;
    }

    const group = groups[groupIndex];
    group.additions += diffStats.additions;
    group.changeType = part.changeType;
    group.deletions += diffStats.deletions;
    group.parts.push(part);
  }

  return groups;
}

export function getDiffStatusLetter(changeType: DiffPart["changeType"]) {
  switch (changeType) {
    case "add":
      return "A";
    case "delete":
      return "D";
    case "move":
      return "R";
    case "update":
      return "M";
    default:
      return "?";
  }
}

export function getDiffStatusLabel(changeType: DiffPart["changeType"]) {
  switch (changeType) {
    case "add":
      return "Added";
    case "delete":
      return "Deleted";
    case "move":
      return "Renamed";
    case "update":
      return "Modified";
    default:
      return "Changed";
  }
}

export function getDiffLineTone(line: string) {
  if (line.startsWith("diff --git ") || line.startsWith("index ") || line.startsWith("@@ ")) {
    return "meta";
  }

  if (line.startsWith("rename from ") || line.startsWith("rename to ")) {
    return "meta";
  }

  if (line.startsWith("--- ") || line.startsWith("+++ ")) {
    return "file";
  }

  if (line.startsWith("+") && !line.startsWith("+++")) {
    return "add";
  }

  if (line.startsWith("-") && !line.startsWith("---")) {
    return "delete";
  }

  return "context";
}

export function getDiffLineMarker(line: string) {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return "+";
  }

  if (line.startsWith("-") && !line.startsWith("---")) {
    return "-";
  }

  if (line.startsWith("@@ ")) {
    return "@";
  }

  return " ";
}
