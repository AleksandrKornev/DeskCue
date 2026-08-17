import { assetsApi } from "@api/endpoint/assets/endpoints";
import type { LocalAssetLinkContext } from "@api/endpoint/assets/types";
import type { AttachmentPart } from "@modules/transcript/RichTranscriptContent/types";

const LOCAL_IMAGE_PREVIEW_IDLE_TTL_MS = 120_000;
const LOCAL_IMAGE_PREVIEW_MAX_IDLE_ENTRIES = 24;

type LocalImagePreviewCacheEntry = {
  idleTimer: ReturnType<typeof setTimeout> | null;
  lastUsedAt: number;
  promise: Promise<string> | null;
  refCount: number;
  url: string | null;
};

type LocalImagePreviewHandle = {
  release: () => void;
  url: string;
};

const localImagePreviewCache = new Map<string, LocalImagePreviewCacheEntry>();

export const ATTACHMENT_IMAGE_PREVIEW_ROOT_MARGIN = "240px 0px";

export function getAttachmentPreviewUrl(part: AttachmentPart) {
  if (part.kind === "local-image" && part.path) {
    return assetsApi.buildImageUrl(part.path);
  }

  if (part.kind === "local-file" && part.path) {
    return assetsApi.buildFileUrl(part.path);
  }

  return part.url;
}

export function getAttachmentOpenHref(part: AttachmentPart) {
  if (part.path) {
    return null;
  }

  return part.url;
}

export function getAttachmentDownloadHref(part: AttachmentPart) {
  if (part.path) {
    return null;
  }

  return part.url;
}

export function getAttachmentImagePreviewCacheKey({
  assetContext,
  part,
  previewUrl
}: {
  assetContext?: LocalAssetLinkContext;
  part: AttachmentPart;
  previewUrl: string;
}) {
  const contextKey = [
    assetContext?.managedSessionId ?? "",
    assetContext?.agentSessionId ?? ""
  ].join(":");

  if (part.path) {
    return `${part.kind}:${contextKey}:${part.path}`;
  }

  return `${part.kind}:${contextKey}:${previewUrl}`;
}

function revokeImagePreviewEntry(
  cacheKey: string,
  entry: LocalImagePreviewCacheEntry
) {
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
  }

  if (entry.url) {
    URL.revokeObjectURL(entry.url);
  }

  localImagePreviewCache.delete(cacheKey);
}

function trimIdleImagePreviewCache() {
  const idleEntries = [...localImagePreviewCache.entries()]
    .filter(([, entry]) => entry.refCount === 0 && entry.url)
    .sort(([, left], [, right]) => left.lastUsedAt - right.lastUsedAt);

  while (idleEntries.length > LOCAL_IMAGE_PREVIEW_MAX_IDLE_ENTRIES) {
    const oldest = idleEntries.shift();
    if (!oldest) {
      return;
    }

    revokeImagePreviewEntry(oldest[0], oldest[1]);
  }
}

function getOrCreateImagePreviewEntry(
  cacheKey: string,
  loadBlob: () => Promise<Blob>
) {
  const existing = localImagePreviewCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const entry: LocalImagePreviewCacheEntry = {
    idleTimer: null,
    lastUsedAt: Date.now(),
    promise: null,
    refCount: 0,
    url: null
  };

  entry.promise = loadBlob()
    .then((blob) => {
      const current = localImagePreviewCache.get(cacheKey);
      if (!current) {
        throw new Error("Image preview cache entry was released.");
      }

      const objectUrl = URL.createObjectURL(blob);
      current.promise = null;
      current.url = objectUrl;
      current.lastUsedAt = Date.now();
      trimIdleImagePreviewCache();
      return objectUrl;
    })
    .catch((error) => {
      localImagePreviewCache.delete(cacheKey);
      throw error;
    });

  localImagePreviewCache.set(cacheKey, entry);

  return entry;
}

function releaseAttachmentImagePreview(cacheKey: string) {
  const entry = localImagePreviewCache.get(cacheKey);
  if (!entry) {
    return;
  }

  entry.refCount = Math.max(0, entry.refCount - 1);
  entry.lastUsedAt = Date.now();

  if (entry.refCount > 0 || entry.idleTimer) {
    return;
  }

  entry.idleTimer = setTimeout(() => {
    const current = localImagePreviewCache.get(cacheKey);
    if (!current || current.refCount > 0) {
      return;
    }

    revokeImagePreviewEntry(cacheKey, current);
  }, LOCAL_IMAGE_PREVIEW_IDLE_TTL_MS);

  trimIdleImagePreviewCache();
}

export async function acquireAttachmentImagePreview(
  cacheKey: string,
  loadBlob: () => Promise<Blob>
): Promise<LocalImagePreviewHandle> {
  const entry = getOrCreateImagePreviewEntry(cacheKey, loadBlob);

  entry.refCount += 1;
  entry.lastUsedAt = Date.now();

  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }

  const url = entry.url ?? (entry.promise ? await entry.promise : null);
  if (!url) {
    throw new Error("Image preview cache entry is not available.");
  }

  return {
    release: () => releaseAttachmentImagePreview(cacheKey),
    url
  };
}
