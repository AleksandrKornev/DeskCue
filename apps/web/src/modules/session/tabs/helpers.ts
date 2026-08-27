import {
  hiddenDiffPathPatterns,
  MAX_VISIBLE_DIFF_CHARS
} from "./constants";
import { parseGitDiffHeaderPaths } from "./gitDiffPaths";

export function isHiddenDiffPath(filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, "/");

  return hiddenDiffPathPatterns.some((pattern) => pattern.test(normalizedPath));
}

export function filterDiffFiles(files: string[]) {
  return files.filter((file) => !isHiddenDiffPath(file));
}

export function filterUnifiedDiff(diff: string) {
  if (!diff) return diff;

  const lines = diff.split("\n");
  const keptLines: string[] = [];
  let isHiddenFileBlock = false;

  for (const line of lines) {
    const headerPaths = parseGitDiffHeaderPaths(line);

    if (headerPaths) isHiddenFileBlock = isHiddenDiffPath(headerPaths.oldPath) || isHiddenDiffPath(headerPaths.newPath);

    if (!isHiddenFileBlock) keptLines.push(line);
  }

  return keptLines.join("\n").trim();
}

export function trimUnifiedDiff(diff: string, sourceWasTruncated = false) {
  const wasTrimmed = sourceWasTruncated || diff.length > MAX_VISIBLE_DIFF_CHARS;

  if (!diff || diff.length <= MAX_VISIBLE_DIFF_CHARS) return { text: diff, wasTrimmed };

  let end = MAX_VISIBLE_DIFF_CHARS;

  if (
    /[\uD800-\uDBFF]/.test(diff[end - 1] ?? "") &&
    /[\uDC00-\uDFFF]/.test(diff[end] ?? "")
  ) {
    end -= 1;
  }

  return {
    text: `${diff.slice(0, end)}\n\n...diff truncated...`,
    wasTrimmed: true
  };
}

export function isLoopbackHostname(hostname: string) {
  const normalizedHostname = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");

  return normalizedHostname === "localhost" ||
    normalizedHostname.endsWith(".localhost") ||
    normalizedHostname === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalizedHostname);
}

export function usesInsecureNetworkOrigin(previewUrl: string | null) {
  if (!previewUrl) return false;

  try {
    const resolvedPreviewUrl = new URL(previewUrl, window.location.href);

    return resolvedPreviewUrl.protocol === "http:" &&
      !isLoopbackHostname(resolvedPreviewUrl.hostname);
  } catch {
    return false;
  }
}
