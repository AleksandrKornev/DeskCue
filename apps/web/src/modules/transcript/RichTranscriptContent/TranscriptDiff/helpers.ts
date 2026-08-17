import type { DiffFileGroup } from "@modules/transcript/RichTranscriptContent/types";

import type { DiffPathParts } from "./types";

const SOURCE_ROOT_SEGMENTS = new Set([
  "apps",
  "docs",
  "packages",
  "scripts"
]);

function stripAbsolutePathPrefix(path: string) {
  const segments = path.split("/").filter(Boolean);
  const sourceRootIndex = segments.findIndex((segment) => SOURCE_ROOT_SEGMENTS.has(segment));

  if (sourceRootIndex >= 0) {
    return segments.slice(sourceRootIndex).join("/");
  }

  return path;
}

export function getDiffPathParts(displayPath: string): DiffPathParts {
  const normalizedPath = displayPath.replace(/\\/g, "/").replace(/\/+/g, "/");
  const sourcePath = stripAbsolutePathPrefix(normalizedPath);
  const separatorIndex = sourcePath.lastIndexOf("/");

  if (separatorIndex < 0) {
    return {
      directory: "",
      fileName: sourcePath
    };
  }

  return {
    directory: sourcePath.slice(0, separatorIndex),
    fileName: sourcePath.slice(separatorIndex + 1)
  };
}

export function shouldShowDiffStats(group: Pick<DiffFileGroup, "additions" | "deletions" | "changeType">) {
  return group.additions > 0 || group.deletions > 0 || group.changeType !== "delete";
}

export function getDiffChangeLabel(title: string, fallbackLabel: string) {
  const match = title.match(/^(Added|Deleted|Moved|Renamed|Updated|Modified)\b/i);
  if (!match) {
    return fallbackLabel;
  }

  const [label] = match;
  return label[0]?.toUpperCase() + label.slice(1).toLowerCase();
}
