import path from "node:path";

import type { TranscriptPart } from "@deskcue/protocol";

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".avif"
]);
const ATTACHMENT_PREVIEWABLE_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ".mp4",
  ".mov",
  ".webm",
  ".m4v",
  ".avi",
  ".pdf"
]);

function isAbsolutePathLike(value: string) {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\/[^/]/.test(value);
}

function extractAbsolutePathFromWrapperLine(line: string) {
  if (!line) {
    return null;
  }

  if (isAbsolutePathLike(line)) {
    return line;
  }

  const pathAfterColonMatch = line.match(/:\s*([A-Za-z]:[\\/][^:*?"<>|]+|\/[^/\s][^]*?)\s*$/);
  const candidate = pathAfterColonMatch?.[1]?.trim() ?? "";

  return isAbsolutePathLike(candidate) ? candidate : null;
}

function extractMentionedFilesFromWrapper(text: string) {
  if (!text) {
    return [];
  }

  const wrapperMatch = text.match(
    /(?:^|\n)#+\s*Files mentioned by the user:\s*([\s\S]*?)(?:^|\n)#+\s*My request for Codex:\s*[\s\S]*$/im
  );

  if (!wrapperMatch?.[1]) {
    return [];
  }

  return wrapperMatch[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map(extractAbsolutePathFromWrapperLine)
    .filter((line): line is string => Boolean(line));
}

function normalizeMarkdownLocalAssetPath(value: string) {
  if (!value) {
    return null;
  }

  const decodedValue = decodeURIComponent(value.trim());

  if (/^file:\/\/\/[A-Za-z]:\//.test(decodedValue)) {
    return decodedValue.replace(/^file:\/\/\//, "");
  }

  if (/^file:\/\//.test(decodedValue)) {
    return decodedValue.replace(/^file:\/\//, "");
  }

  if (/^\/[A-Za-z]:[\\/]/.test(decodedValue)) {
    return decodedValue.slice(1);
  }

  return isAbsolutePathLike(decodedValue) ? decodedValue : null;
}

function isImagePathLike(value: string) {
  return IMAGE_EXTENSIONS.has(path.extname(value).toLowerCase());
}

export function buildUserMessageParts(
  payload: Record<string, unknown>,
  text: string,
  rawMessageText: string
) {
  const parts: TranscriptPart[] = [];
  const seenAttachments = new Set<string>();

  if (text) {
    parts.push({
      type: "markdown",
      text
    });
  }

  const images = Array.isArray(payload.images) ? payload.images : [];
  const localImages = Array.isArray(payload.local_images) ? payload.local_images : [];
  const wrapperFiles = extractMentionedFilesFromWrapper(rawMessageText);

  images.forEach((image, index) => {
    const url = typeof image === "string" ? image : null;
    if (!url) {
      return;
    }

    seenAttachments.add(`url:${url}`);
    parts.push({
      type: "attachment",
      kind: isImagePathLike(url) ? "image" : "file",
      label: `Attachment ${index + 1}`,
      url,
      path: null
    });
  });

  localImages.forEach((image, index) => {
    const pathValue = typeof image === "string" ? image : null;
    if (!pathValue) {
      return;
    }

    const normalizedPath = path.normalize(pathValue);
    seenAttachments.add(`path:${normalizedPath.toLowerCase()}`);
    parts.push({
      type: "attachment",
      kind: isImagePathLike(normalizedPath) ? "local-image" : "local-file",
      label: `Attachment ${index + 1}`,
      url: null,
      path: pathValue
    });
  });

  wrapperFiles.forEach((filePath, index) => {
    const normalizedPath = path.normalize(filePath);
    const dedupeKey = `path:${normalizedPath.toLowerCase()}`;
    if (seenAttachments.has(dedupeKey)) {
      return;
    }

    seenAttachments.add(dedupeKey);
    parts.push({
      type: "attachment",
      kind: isImagePathLike(normalizedPath) ? "local-image" : "local-file",
      label: `Attachment ${localImages.length + images.length + index + 1}`,
      url: null,
      path: normalizedPath
    });
  });

  return parts;
}

function isPreviewableAttachmentPath(value: string) {
  return ATTACHMENT_PREVIEWABLE_EXTENSIONS.has(path.extname(value).toLowerCase());
}

function extractLocalAssetPartsFromMarkdown(text: string) {
  const parts: TranscriptPart[] = [];
  const seenPaths = new Set<string>();
  const markdownLinkPattern = /!?\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

  for (const match of text.matchAll(markdownLinkPattern)) {
    const normalizedPath = normalizeMarkdownLocalAssetPath(match[1] ?? "");
    if (!normalizedPath || !isPreviewableAttachmentPath(normalizedPath)) {
      continue;
    }

    const dedupeKey = normalizedPath.toLowerCase();
    if (seenPaths.has(dedupeKey)) {
      continue;
    }

    seenPaths.add(dedupeKey);
    parts.push({
      type: "attachment",
      kind: isImagePathLike(normalizedPath) ? "local-image" : "local-file",
      label: `Attachment ${seenPaths.size}`,
      url: null,
      path: normalizedPath
    });
  }

  return parts;
}

export function buildAssistantMessageParts(text: string) {
  if (!text) {
    return undefined;
  }

  return [
    {
      type: "markdown",
      text
    } satisfies TranscriptPart,
    ...extractLocalAssetPartsFromMarkdown(text)
  ];
}
