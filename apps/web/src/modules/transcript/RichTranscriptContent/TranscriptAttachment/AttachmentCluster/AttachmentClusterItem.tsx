import clsx from "clsx";
import {
  useEffect,
  useRef,
  useState
} from "react";
import type { KeyboardEvent } from "react";

import { assetsApi } from "@api/endpoint/assets/endpoints";
import {
  getAttachmentBadgeLabel,
  getAttachmentDisplayName,
  getAttachmentPreviewKind
} from "@modules/transcript/RichTranscriptContent/helpers";
import {
  acquireAttachmentImagePreview,
  ATTACHMENT_IMAGE_PREVIEW_ROOT_MARGIN,
  getAttachmentImagePreviewCacheKey,
  getAttachmentPreviewUrl
} from "@modules/transcript/RichTranscriptContent/TranscriptAttachment/helpers";

import styles from "./styles.module.scss";
import type { AttachmentClusterItemProps } from "./types";

function handleAttachmentClusterItemKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
  const items = event.currentTarget.parentElement
    ? [...event.currentTarget.parentElement.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
    : [];
  const currentIndex = items.indexOf(event.currentTarget);
  let nextIndex: number | null = null;

  if (currentIndex < 0 || items.length === 0) return;

  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    nextIndex = (currentIndex + 1) % items.length;
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    nextIndex = (currentIndex - 1 + items.length) % items.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = items.length - 1;
  }

  if (nextIndex === null) return;

  event.preventDefault();
  items[nextIndex]?.focus();
  items[nextIndex]?.click();
}

export function AttachmentClusterItem({
  assetContext,
  isActive,
  onBlur,
  onFocus,
  onSelect,
  part,
  position,
  total
}: AttachmentClusterItemProps) {
  const displayName = getAttachmentDisplayName(part);
  const badgeLabel = getAttachmentBadgeLabel(part);
  const previewKind = getAttachmentPreviewKind(part);
  const previewUrl = getAttachmentPreviewUrl(part);
  const assetContextAgentSessionId = assetContext?.agentSessionId;
  const assetContextManagedSessionId = assetContext?.managedSessionId;
  const assetContextWorkspaceId = assetContext?.workspaceId;
  const imagePreviewCacheKey = previewUrl
    ? getAttachmentImagePreviewCacheKey({
        assetContext,
        part,
        previewUrl
      })
    : null;
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imagePreviewFailed, setImagePreviewFailed] = useState(false);
  const [isPreviewNearViewport, setIsPreviewNearViewport] = useState(false);
  const itemRef = useRef<HTMLButtonElement | null>(null);
  const effectivePreviewUrl =
    part.kind === "local-image" ? imagePreviewUrl : previewUrl;

  useEffect(() => {
    if (
      previewKind !== "image" ||
      part.kind !== "local-image" ||
      !previewUrl ||
      !imagePreviewCacheKey ||
      !isPreviewNearViewport
    ) {
      setImagePreviewUrl(null);
      setImagePreviewFailed(false);
      return;
    }

    let cancelled = false;
    let releaseImagePreview: (() => void) | null = null;
    const localAssetContext = assetContextAgentSessionId ||
      assetContextManagedSessionId ||
      assetContextWorkspaceId
      ? {
          agentSessionId: assetContextAgentSessionId,
          managedSessionId: assetContextManagedSessionId,
          workspaceId: assetContextWorkspaceId
        }
      : undefined;

    setImagePreviewFailed(false);

    acquireAttachmentImagePreview(
      imagePreviewCacheKey,
      () => part.path
        ? assetsApi.getTicketBlob(part.path, displayName, {
            context: localAssetContext,
            kind: "local_image"
          })
        : assetsApi.getImageBlob(previewUrl, displayName)
    )
      .then(({ release, url }) => {
        if (cancelled) {
          release();
          return;
        }

        releaseImagePreview = release;
        setImagePreviewUrl(url);
        setImagePreviewFailed(false);
      })
      .catch(() => {
        if (!cancelled) {
          setImagePreviewUrl(null);
          setImagePreviewFailed(true);
        }
      });

    return () => {
      cancelled = true;
      releaseImagePreview?.();
    };
  }, [
    assetContextAgentSessionId,
    assetContextManagedSessionId,
    assetContextWorkspaceId,
    displayName,
    imagePreviewCacheKey,
    isPreviewNearViewport,
    part.kind,
    part.path,
    previewKind,
    previewUrl
  ]);

  useEffect(() => {
    if (previewKind !== "image" || part.kind !== "local-image") {
      setIsPreviewNearViewport(false);
      return;
    }

    const element = itemRef.current;

    if (!element || typeof IntersectionObserver === "undefined") {
      setIsPreviewNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsPreviewNearViewport(entry.isIntersecting);
      },
      {
        root: null,
        rootMargin: ATTACHMENT_IMAGE_PREVIEW_ROOT_MARGIN
      }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [part.kind, previewKind]);

  return (
    <button
      aria-checked={isActive}
      aria-label={`${displayName}, attachment ${position} of ${total}`}
      className={clsx(styles.attachmentGroupItem, isActive && styles.attachmentGroupItemActive)}
      onBlur={onBlur}
      onFocus={onFocus}
      onKeyDown={handleAttachmentClusterItemKeyDown}
      onClick={onSelect}
      ref={itemRef}
      role="radio"
      tabIndex={isActive ? 0 : -1}
      title={part.path ?? part.url ?? displayName}
      type="button"
    >
      {previewKind === "image" && effectivePreviewUrl ? (
        <span className={styles.attachmentGroupThumb}>
          <img alt={displayName} loading="lazy" src={effectivePreviewUrl} />
        </span>
      ) : previewKind === "image" && part.kind === "local-image" && !imagePreviewFailed ? (
        <span className={clsx(styles.attachmentGroupItemBadge, styles.attachmentGroupItemBadgeLoading)}>
          <span className={styles.attachmentGroupSpinner} aria-hidden="true" />
        </span>
      ) : (
        <span
          aria-hidden="true"
          className={clsx(
            styles.attachmentGroupItemBadge,
            styles.attachmentGroupItemBadgeLabel
          )}
        >
          {badgeLabel}
        </span>
      )}
    </button>
  );
}
