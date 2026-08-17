import {
  hiddenDiffPathPatterns,
  MAX_VISIBLE_DIFF_CHARS
} from "./constants";

export function isHiddenDiffPath(filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, "/");
  return hiddenDiffPathPatterns.some((pattern) => pattern.test(normalizedPath));
}

export function filterDiffFiles(files: string[]) {
  return files.filter((file) => !isHiddenDiffPath(file));
}

export function filterUnifiedDiff(diff: string) {
  if (!diff) {
    return diff;
  }

  const lines = diff.split("\n");
  const keptLines: string[] = [];
  let isHiddenFileBlock = false;

  for (const line of lines) {
    const headerMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);

    if (headerMatch) {
      isHiddenFileBlock = isHiddenDiffPath(headerMatch[1]) || isHiddenDiffPath(headerMatch[2]);
    }

    if (!isHiddenFileBlock) {
      keptLines.push(line);
    }
  }

  return keptLines.join("\n").trim();
}

export function trimUnifiedDiff(diff: string) {
  if (!diff || diff.length <= MAX_VISIBLE_DIFF_CHARS) {
    return { text: diff, wasTrimmed: false };
  }

  return {
    text: `${diff.slice(0, MAX_VISIBLE_DIFF_CHARS)}\n\n...diff truncated...`,
    wasTrimmed: true
  };
}
