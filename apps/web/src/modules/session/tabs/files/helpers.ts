import { WORKSPACE_FILE_HISTORY_KEY } from "./constants";
import type { WorkspaceFileHistoryTarget } from "./types";

export function buildWorkspaceBreadcrumbs(path: string) {
  const parts = path.split("/").filter(Boolean);
  return [
    { label: "Workspace", path: "" },
    ...parts.map((label, index) => ({
      label,
      path: parts.slice(0, index + 1).join("/")
    }))
  ];
}

export function normalizeWorkspacePath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function formatFileSize(sizeBytes: number | null) {
  if (sizeBytes === null) return "";
  if (sizeBytes < 1_024) return `${sizeBytes} B`;
  if (sizeBytes < 1_048_576) return `${Math.round(sizeBytes / 1_024)} KB`;
  return `${(sizeBytes / 1_048_576).toFixed(1)} MB`;
}

export function readWorkspaceFileHistoryTarget(state: unknown) {
  if (!state || typeof state !== "object") return null;
  const target = (state as Record<string, unknown>)[WORKSPACE_FILE_HISTORY_KEY];
  if (!target || typeof target !== "object") return null;
  const value = target as Record<string, unknown>;
  if (
    (value.kind !== "directory" && value.kind !== "file") ||
    typeof value.path !== "string" ||
    typeof value.workspaceId !== "string"
  ) return null;
  return value as WorkspaceFileHistoryTarget;
}
