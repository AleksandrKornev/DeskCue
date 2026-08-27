import type { DeskCueRuntimeMode } from "@runtime";

import {
  MAX_CLOUD_WORKSPACE_IMAGE_PREVIEW_BYTES,
  MAX_WORKSPACE_IMAGE_PREVIEW_BYTES,
  WORKSPACE_FILE_HISTORY_KEY
} from "./constants";
import type { WorkspaceFileHistoryTarget } from "./types";

const WORKSPACE_RASTER_IMAGE_EXTENSIONS = new Set([
  ".bmp",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".webp"
]);
const MIN_FILE_LINE_NUMBER_WIDTH_CH = 3.5;

export function buildWorkspaceFileLineNumberWidth(lineCount: number) {
  const digitCount = String(Math.max(1, lineCount)).length;

  return `${Math.max(MIN_FILE_LINE_NUMBER_WIDTH_CH, digitCount + 1)}ch`;
}

export function createFileViewerKeyDownHandler(
  setFileViewerExpanded: (expanded: boolean) => void
) {
  return (event: KeyboardEvent) => {
    if (event.key === "Escape") setFileViewerExpanded(false);
  };
}

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

export function isWorkspaceRasterImagePath(path: string) {
  const normalizedPath = normalizeWorkspacePath(path).toLowerCase();
  const extensionIndex = normalizedPath.lastIndexOf(".");

  return extensionIndex >= 0 && WORKSPACE_RASTER_IMAGE_EXTENSIONS.has(
    normalizedPath.slice(extensionIndex)
  );
}

export function readWorkspaceImagePreviewMaxBytes(runtimeMode: DeskCueRuntimeMode) {
  return runtimeMode === "cloud-machine"
    ? MAX_CLOUD_WORKSPACE_IMAGE_PREVIEW_BYTES
    : MAX_WORKSPACE_IMAGE_PREVIEW_BYTES;
}

export function formatFileSize(sizeBytes: number | null) {
  if (sizeBytes === null) return "";
  if (sizeBytes < 1_024) return `${sizeBytes} B`;
  if (sizeBytes < 1_048_576) return `${Math.round(sizeBytes / 1_024)} KB`;

  return `${(sizeBytes / 1_048_576).toFixed(1)} MB`;
}

export function formatFileSizeLimit(sizeBytes: number) {
  return formatFileSize(sizeBytes).replace(".0 MB", " MB");
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
