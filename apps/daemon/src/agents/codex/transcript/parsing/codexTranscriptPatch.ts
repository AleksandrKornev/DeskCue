import type { TranscriptPart } from "@deskcue/protocol";

import { isRecord, truncate } from "./codexTranscriptShared.ts";

interface PatchApplyChangeRecord {
  type?: string;
  unified_diff?: string;
  content?: string;
  move_path?: string | null;
}

export function buildPatchApplySummary(payload: Record<string, unknown>, parts: TranscriptPart[]) {
  const success = payload.success !== false;
  const diffCount = parts.filter((part) => part.type === "diff").length;

  if (diffCount > 0) {
    return success
      ? diffCount === 1
        ? "Applied changes to 1 file"
        : `Applied changes to ${diffCount} files`
      : diffCount === 1
        ? "Patch failed after editing 1 file"
        : `Patch failed after editing ${diffCount} files`;
  }

  return success ? "Applied patch" : "Patch failed";
}

function buildPatchApplyDetail(payload: Record<string, unknown>, diffCount: number) {
  const stdout = typeof payload.stdout === "string" ? payload.stdout.trim() : "";
  const stderr = typeof payload.stderr === "string" ? payload.stderr.trim() : "";

  if (diffCount > 0) {
    return diffCount === 1 ? "1 changed file" : `${diffCount} changed files`;
  }

  return stdout || stderr || null;
}

function normalizePatchChangeType(
  value: unknown
): "add" | "update" | "delete" | "move" | "unknown" {
  return value === "add" ||
    value === "update" ||
    value === "delete" ||
    value === "move"
    ? value
    : "unknown";
}

function buildPatchApplyDiffTitle(filePath: string, change: PatchApplyChangeRecord) {
  const changeType = normalizePatchChangeType(change.type);
  const targetPath =
    changeType === "move" && typeof change.move_path === "string" && change.move_path.trim()
      ? `${filePath} -> ${change.move_path}`
      : filePath;

  switch (changeType) {
    case "add":
      return `Added ${targetPath}`;
    case "delete":
      return `Deleted ${targetPath}`;
    case "move":
      return `Moved ${targetPath}`;
    case "update":
      return `Updated ${targetPath}`;
    default:
      return targetPath;
  }
}

function toGitPath(value: string) {
  return value.replace(/\\/g, "/");
}

function synthesizeAddedFileDiff(filePath: string, content: string) {
  const normalizedPath = toGitPath(filePath);
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const hunkHeader = `@@ -0,0 +1,${Math.max(lines.length, 1)} @@`;
  const diffLines = lines.map((line) => `+${line}`);

  return [
    `diff --git a/${normalizedPath} b/${normalizedPath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${normalizedPath}`,
    hunkHeader,
    ...diffLines
  ].join("\n");
}

function buildPatchApplyDiff(filePath: string, change: PatchApplyChangeRecord) {
  if (typeof change.unified_diff === "string" && change.unified_diff.trim()) {
    return change.unified_diff.trim();
  }

  const changeType = normalizePatchChangeType(change.type);
  if (changeType === "add" && typeof change.content === "string") {
    return synthesizeAddedFileDiff(filePath, change.content);
  }

  if (changeType === "delete") {
    return [
      `diff --git a/${toGitPath(filePath)} b/${toGitPath(filePath)}`,
      "deleted file mode 100644",
      `--- a/${toGitPath(filePath)}`,
      "+++ /dev/null"
    ].join("\n");
  }

  if (changeType === "move" && typeof change.move_path === "string" && change.move_path.trim()) {
    return [
      `diff --git a/${toGitPath(filePath)} b/${toGitPath(change.move_path)}`,
      `rename from ${toGitPath(filePath)}`,
      `rename to ${toGitPath(change.move_path)}`
    ].join("\n");
  }

  return null;
}

export function buildPatchApplyParts(payload: Record<string, unknown>) {
  const parts: TranscriptPart[] = [];
  const success = payload.success !== false;
  const changes = isRecord(payload.changes) ? payload.changes : null;
  const diffParts: TranscriptPart[] = [];

  if (changes) {
    for (const [filePath, value] of Object.entries(changes)) {
      if (!isRecord(value)) {
        continue;
      }

      const change = value as PatchApplyChangeRecord;
      const diffText = buildPatchApplyDiff(filePath, change);
      if (!diffText) {
        continue;
      }

      diffParts.push({
        type: "diff",
        title: buildPatchApplyDiffTitle(filePath, change),
        text: diffText,
        filePath,
        changeType: normalizePatchChangeType(change.type)
      });
    }
  }

  parts.push({
    type: "status",
    label: success ? "Applied patch" : "Patch failed",
    detail: buildPatchApplyDetail(payload, diffParts.length)
  });

  parts.push(...diffParts);

  if (diffParts.length === 0) {
    const stdout = typeof payload.stdout === "string" ? payload.stdout.trim() : "";
    const stderr = typeof payload.stderr === "string" ? payload.stderr.trim() : "";
    const fallbackText = stdout || stderr;

    if (fallbackText) {
      parts.push({
        type: "tool_result",
        toolName: "apply_patch",
        status: success ? "completed" : "failed",
        text: truncate(fallbackText, 4000)
      });
    }
  }

  return parts;
}
