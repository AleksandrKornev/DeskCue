import type { GitFileStatus } from "@deskcue/protocol";
import {
  decodeGitDiffPathToken,
  parseGitDiffHeaderPaths
} from "@modules/session/tabs/gitDiffPaths";

import type {
  DiffFileReview,
  DiffFileStatus,
  DiffReviewLine
} from "./types";

function parseDiffBlock(block: string): DiffFileReview | null {
  const lines = block.split("\n");
  const header = parseGitDiffHeaderPaths(lines[0] ?? "");

  if (!header) return null;

  let path = header.newPath;
  let previousPath: string | null = header.oldPath === header.newPath ? null : header.oldPath;
  let status: DiffFileStatus = "modified";
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  let additions = 0;
  let deletions = 0;
  let hasLineStats = false;
  const reviewLines: DiffReviewLine[] = [];

  for (const line of lines.slice(1)) {
    if (line.startsWith("new file mode ")) status = "added";
    if (line.startsWith("deleted file mode ")) status = "deleted";
    if (line.startsWith("rename from ")) {
      status = "renamed";
      previousPath = decodeGitDiffPathToken(line.slice("rename from ".length));
    }

    if (line.startsWith("rename to ")) {
      status = "renamed";
      path = decodeGitDiffPathToken(line.slice("rename to ".length));
    }

    if (line.startsWith("copy from ")) {
      status = "copied";
      previousPath = decodeGitDiffPathToken(line.slice("copy from ".length));
    }

    if (line.startsWith("copy to ")) {
      status = "copied";
      path = decodeGitDiffPathToken(line.slice("copy to ".length));
    }

    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);

    if (hunk) {
      hasLineStats = true;
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      reviewLines.push({ kind: "meta", newLine: null, oldLine: null, text: line });
      continue;
    }

    if (!inHunk) {
      if (!line.startsWith("index ") && !line.startsWith("--- ") && !line.startsWith("+++ ")) {
        reviewLines.push({ kind: "meta", newLine: null, oldLine: null, text: line });
      }

      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions += 1;
      reviewLines.push({ kind: "addition", newLine, oldLine: null, text: line.slice(1) });
      newLine += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletions += 1;
      reviewLines.push({ kind: "deletion", newLine: null, oldLine, text: line.slice(1) });
      oldLine += 1;
    } else if (line.startsWith(" ")) {
      reviewLines.push({ kind: "context", newLine, oldLine, text: line.slice(1) });
      oldLine += 1;
      newLine += 1;
    } else {
      reviewLines.push({ kind: "meta", newLine: null, oldLine: null, text: line });
    }
  }

  return { additions, deletions, hasLineStats, lines: reviewLines, path, previousPath, status };
}

export function parseUnifiedDiff(diff: string): DiffFileReview[] {
  if (!diff.trim()) return [];

  const blocks = diff.split(/(?=^diff --git )/m).filter((block) => block.startsWith("diff --git "));

  return blocks.map(parseDiffBlock).filter((file): file is DiffFileReview => Boolean(file));
}

export function describeDiffStatus(status: DiffFileStatus) {
  switch (status) {
    case "added": return "Added";
    case "copied": return "Copied";
    case "deleted": return "Deleted";
    case "renamed": return "Renamed";
    case "modified": return "Modified";
    case "unmerged": return "Unmerged";
    case "untracked": return "Untracked";
    default: return "Details unavailable";
  }
}

export function diffStatusLabel(status: DiffFileStatus) {
  switch (status) {
    case "added": return "A";
    case "copied": return "C";
    case "deleted": return "D";
    case "modified": return "M";
    case "renamed": return "R";
    case "unmerged": return "U";
    case "untracked": return "?";
    default: return "?";
  }
}

function mapGitFileStatus(status: GitFileStatus | undefined): DiffFileStatus | null {
  switch (status) {
    case "M": return "modified";
    case "A": return "added";
    case "D": return "deleted";
    case "R": return "renamed";
    case "C": return "copied";
    case "U": return "unmerged";
    case "?": return "untracked";
    default: return null;
  }
}

export function mergeDiffReviewFiles(
  changedFiles: readonly string[],
  parsedFiles: readonly DiffFileReview[],
  changedFileStatuses: Readonly<Record<string, GitFileStatus>> = {},
  changedFilePreviousPaths: Readonly<Record<string, string>> = {}
) {
  const byPath = new Map(parsedFiles.map((file) => [file.path, file]));
  const paths = [...new Set([...changedFiles, ...parsedFiles.map((file) => file.path)])];

  return paths.map((path): DiffFileReview => {
    const parsed = byPath.get(path);
    const status = mapGitFileStatus(changedFileStatuses[path]);

    if (parsed) return status ? { ...parsed, status } : parsed;

    return {
      additions: 0,
      deletions: 0,
      hasLineStats: false,
      lines: [],
      path,
      previousPath: changedFilePreviousPaths[path] ?? null,
      status: status ?? "unknown"
    };
  });
}

export function basename(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

export function parentPath(path: string) {
  const parts = path.split("/").filter(Boolean);

  return parts.slice(0, -1).join("/");
}
