import type {
  AttachmentPart,
  AttachmentPreviewKind
} from "@modules/transcript/RichTranscriptContent/types";
export { normalizeMarkdownLocalAssetPath } from "@deskcue/protocol/markdown";

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

const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "m4v",
  "mov",
  "webm",
  "ogv"
]);

const AUDIO_EXTENSIONS = new Set([
  "aac",
  "flac",
  "m4a",
  "mp3",
  "oga",
  "ogg",
  "opus",
  "wav",
  "weba"
]);

const TEXT_PREVIEW_EXTENSIONS = new Set([
  "c",
  "cc",
  "clj",
  "cljs",
  "cpp",
  "cs",
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
  "go",
  "graphql",
  "h",
  "hpp",
  "java",
  "kt",
  "kts",
  "lua",
  "py",
  "rb",
  "rs",
  "sh",
  "sql",
  "ps1",
  "svelte",
  "swift",
  "toml",
  "ini",
  "vue"
]);

const BINARY_PREVIEW_EXTENSIONS = new Set([
  "7z",
  "bin",
  "bz2",
  "db",
  "dll",
  "dmg",
  "doc",
  "docx",
  "eot",
  "exe",
  "gz",
  "ico",
  "iso",
  "msi",
  "otf",
  "ppt",
  "pptx",
  "rar",
  "sqlite",
  "sqlite3",
  "tar",
  "ttf",
  "wasm",
  "woff",
  "woff2",
  "xls",
  "xlsx",
  "xz",
  "zip"
]);

const TEXT_PREVIEW_FILE_NAMES = new Set([
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  "dockerfile",
  "license",
  "makefile",
  "readme"
]);

function isSensitiveTextFileName(fileName: string) {
  return [".netrc", ".npmrc", ".pypirc"].includes(fileName);
}

function isEnvironmentTextFileName(fileName: string) {
  return fileName.startsWith(".env");
}

function getAssetFileName(value: string) {
  return value.split(/[?#]/u, 1)[0]?.split(/[\\/]/u).pop()?.trim() ?? "";
}

function getAssetExtension(value: string) {
  const fileName = getAssetFileName(value);
  const dotIndex = fileName.lastIndexOf(".");

  if (dotIndex <= 0) return "";

  return fileName.slice(dotIndex + 1).toLowerCase();
}

export function getAttachmentDisplayName(part: AttachmentPart) {
  const candidate = part.path ?? part.url ?? part.label;
  const normalized = candidate.split(/[\\/]/).pop()?.trim() || candidate.trim();

  return normalized || part.label;
}

export function getAttachmentExtension(part: AttachmentPart) {
  return getAssetExtension(part.path ?? part.url ?? "");
}

export function getLocalAssetPreviewKind(assetPath: string): AttachmentPreviewKind {
  const extension = getAssetExtension(assetPath);
  const fileName = getAssetFileName(assetPath).toLowerCase();

  if (isSensitiveTextFileName(fileName)) return "none";
  if (isEnvironmentTextFileName(fileName)) return "text";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  if (extension === "pdf") return "pdf";
  if (TEXT_PREVIEW_EXTENSIONS.has(extension) || TEXT_PREVIEW_FILE_NAMES.has(fileName)) return "text";

  return "none";
}

export function shouldProbeLocalAssetAsText(assetPath: string) {
  const extension = getAssetExtension(assetPath);
  const fileName = getAssetFileName(assetPath).toLowerCase();

  if (!fileName || isSensitiveTextFileName(fileName)) return false;

  return !BINARY_PREVIEW_EXTENSIONS.has(extension);
}

export function getAttachmentPreviewKind(part: AttachmentPart): AttachmentPreviewKind {
  if (part.path) return getLocalAssetPreviewKind(part.path);
  if (part.kind === "image" || part.kind === "local-image") return "image";

  return getLocalAssetPreviewKind(part.url ?? "");
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

  if (previewKind === "video") return `${localPrefix}video`;
  if (previewKind === "audio") return `${localPrefix}audio`;

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

function stripLocalAssetUrlSuffix(value: string) {
  return value.split(/[?#]/u, 1)[0] ?? value;
}

export function isMarkdownLocalImagePath(value: string) {
  return getLocalAssetPreviewKind(stripLocalAssetUrlSuffix(value)) === "image";
}

export function isMarkdownVideoPath(value: string) {
  return getLocalAssetPreviewKind(stripLocalAssetUrlSuffix(value)) === "video";
}
