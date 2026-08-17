import type {
  AttachmentPart,
  AttachmentPreviewKind
} from "@modules/transcript/RichTranscriptContent/types";

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "avif"
]);

const TEXT_PREVIEW_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "log",
  "diff",
  "patch",
  "yml",
  "yaml",
  "xml",
  "csv",
  "ts",
  "tsx",
  "js",
  "jsx",
  "css",
  "html",
  "py",
  "sh",
  "ps1",
  "toml",
  "ini"
]);

export function getAttachmentDisplayName(part: AttachmentPart) {
  const candidate = part.path ?? part.url ?? part.label;
  const normalized = candidate.split(/[\\/]/).pop()?.trim() || candidate.trim();
  return normalized || part.label;
}

export function getAttachmentExtension(part: AttachmentPart) {
  const candidate = (part.path ?? part.url ?? "").split(/[?#]/)[0];
  const normalized = candidate.split(/[\\/]/).pop() ?? "";
  const dotIndex = normalized.lastIndexOf(".");

  if (dotIndex < 0) {
    return "";
  }

  return normalized.slice(dotIndex + 1).toLowerCase();
}

export function getAttachmentPreviewKind(part: AttachmentPart): AttachmentPreviewKind {
  const extension = getAttachmentExtension(part);

  if (part.kind === "image" || part.kind === "local-image" || IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }

  if (extension === "pdf") {
    return "pdf";
  }

  if (TEXT_PREVIEW_EXTENSIONS.has(extension)) {
    return "text";
  }

  return "none";
}

export function getAttachmentSemanticLabel(
  part: AttachmentPart,
  previewKind: AttachmentPreviewKind
) {
  const displayName = getAttachmentDisplayName(part).toLowerCase();
  const fullPath = `${part.path ?? ""} ${part.url ?? ""}`.toLowerCase();
  const extension = getAttachmentExtension(part);
  const isLocal = part.kind === "local-image" || part.kind === "local-file";
  const localPrefix = isLocal ? "Local " : "";

  if (previewKind === "image") {
    if (
      displayName.startsWith("codex-clipboard-") ||
      fullPath.includes("appdata\\local\\temp") ||
      fullPath.includes("/appdata/local/temp/")
    ) {
      return `${localPrefix}clipboard image`;
    }

    if (displayName.includes("screenshot") || displayName.includes("screen-shot")) {
      return `${localPrefix}screenshot`;
    }

    return `${localPrefix}image`;
  }

  if (previewKind === "pdf") {
    return `${localPrefix}PDF document`;
  }

  if (previewKind === "text") {
    if (extension === "md" || extension === "markdown") {
      return `${localPrefix}Markdown file`;
    }

    if (extension === "diff" || extension === "patch") {
      return `${localPrefix}diff file`;
    }

    if (extension === "json" || extension === "yaml" || extension === "yml" || extension === "toml") {
      return `${localPrefix}config file`;
    }

    if (extension === "log") {
      return `${localPrefix}log file`;
    }

    return `${localPrefix}text file`;
  }

  return `${localPrefix}file`;
}

export function getAttachmentSecondaryLabel(
  part: AttachmentPart,
  previewKind: AttachmentPreviewKind
) {
  const isLocal = part.kind === "local-image" || part.kind === "local-file";
  const semanticLabel = getAttachmentSemanticLabel(part, previewKind);

  return isLocal ? semanticLabel : semanticLabel.replace(/^Local /, "");
}

export function getAttachmentBadgeLabel(part: AttachmentPart) {
  const displayName = getAttachmentDisplayName(part).toLowerCase();
  const extension = getAttachmentExtension(part);

  if (displayName.includes("screenshot")) {
    return "SHOT";
  }

  if (displayName.includes("clipboard")) {
    return "CLIP";
  }

  if (extension) {
    return extension.slice(0, 5).toUpperCase();
  }

  return part.kind === "image" || part.kind === "local-image" ? "IMG" : "FILE";
}

export function normalizeMarkdownLocalAssetPath(value: string) {
  if (!value) {
    return null;
  }

  if (/^file:\/\/\/[A-Za-z]:\//.test(value)) {
    return decodeURIComponent(value.replace(/^file:\/\/\//, ""));
  }

  if (/^file:\/\//.test(value)) {
    return decodeURIComponent(value.replace(/^file:\/\//, ""));
  }

  if (/^\/[A-Za-z]:[\\/]/.test(value)) {
    return value.slice(1);
  }

  if (/^[A-Za-z]:[\\/]/.test(value) || /^\/[^/]/.test(value)) {
    return value;
  }

  return null;
}
