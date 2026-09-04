import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import { toast } from "sonner";

import {
  assetsApi,
  LOCAL_ASSET_LINK_EXPIRY_LABEL
} from "@api/endpoint/assets/endpoints";
import type { LocalAssetLinkContext } from "@api/endpoint/assets/types";
import { copyText } from "@lib/clipboard";
import {
  downloadLocalAsset,
  openLocalAssetInNewTab
} from "@modules/transcript/RichTranscriptContent/localAssetActions";
import type { AttachmentPart, AttachmentPreviewKind } from "@modules/transcript/RichTranscriptContent/types";

import {
  acquireAttachmentImagePreview,
  ATTACHMENT_IMAGE_PREVIEW_ROOT_MARGIN,
  getAttachmentImagePreviewCacheKey
} from "./helpers";
import type { ImagePreviewState, TextPreviewState } from "./types";

export function useTranscriptAttachmentPreview({
  assetContext,
  displayName,
  part,
  previewKind,
  previewUrl
}: {
  assetContext?: LocalAssetLinkContext;
  displayName: string;
  part: AttachmentPart;
  previewKind: AttachmentPreviewKind;
  previewUrl?: string | null;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [textPreview, setTextPreview] = useState("");
  const [textPreviewState, setTextPreviewState] = useState<TextPreviewState>("idle");
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imagePreviewState, setImagePreviewState] = useState<ImagePreviewState>("idle");
  const [imagePreviewRetryNonce, setImagePreviewRetryNonce] = useState(0);
  const [isPreviewNearViewport, setIsPreviewNearViewport] = useState(false);
  const [copyLinkState, setCopyLinkState] = useState<"idle" | "copying">("idle");
  const cardRef = useRef<HTMLDivElement | null>(null);
  const assetContextAgentSessionId = assetContext?.agentSessionId;
  const assetContextManagedSessionId = assetContext?.managedSessionId;
  const assetContextWorkspaceId = assetContext?.workspaceId;

  const effectivePreviewUrl =
    part.kind === "local-image"
      ? imagePreviewUrl
      : previewUrl;
  const imagePreviewCacheKey = previewUrl
    ? getAttachmentImagePreviewCacheKey({
        assetContext,
        part,
        previewUrl
      })
    : null;
  const isLocalAsset = Boolean(part.path);

  const openPreview = useCallback(() => {
    if (!previewUrl || previewKind === "none") return;

    setPreviewOpen(true);
  }, [previewKind, previewUrl]);

  const retryImagePreview = useCallback(() => {
    if (imagePreviewState !== "error") return;

    setImagePreviewRetryNonce((current) => current + 1);
  }, [imagePreviewState]);

  const handleOpenLocalAsset = useCallback(() => {
    if (!part.path) return;

    void openLocalAssetInNewTab(part.path, displayName, assetContext).catch((error) => {
      toast.error(error instanceof Error ? error.message : `Unable to open ${displayName}`);
    });
  }, [assetContext, displayName, part.path]);

  const notifyDownloadStarting = useCallback(() => {
    toast.info(`Download should start: ${displayName}`);
  }, [displayName]);

  const handleDownloadLocalAsset = useCallback(() => {
    if (!part.path) return;

    notifyDownloadStarting();
    void downloadLocalAsset(part.path, displayName, assetContext).catch((error) => {
      toast.error(error instanceof Error ? error.message : `Unable to download ${displayName}`);
    });
  }, [assetContext, displayName, notifyDownloadStarting, part.path]);

  const handleCopyLocalAssetLink = useCallback(async () => {
    if (!part.path || copyLinkState === "copying") return;

    setCopyLinkState("copying");

    try {
      const hasSessionScope = Boolean(
        assetContext?.agentSessionId || assetContext?.managedSessionId
      );
      const assetUrl = hasSessionScope
        ? assetsApi.buildFileUrl(part.path, { context: assetContext })
        : (await assetsApi.createLocalAssetLink(part.path, {
            context: assetContext
          })).url;
      const copied = await copyText(assetUrl);

      if (!copied) {
        toast.error("Copy failed");
        return;
      }

      toast.success(hasSessionScope
        ? "File link copied."
        : `Temporary file link copied. Valid for ${LOCAL_ASSET_LINK_EXPIRY_LABEL}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to copy file link");
    } finally {
      setCopyLinkState("idle");
    }
  }, [assetContext, copyLinkState, part.path]);

  useEffect(() => {
    setTextPreview("");
    setTextPreviewState("idle");
  }, [previewKind, previewUrl]);

  useEffect(() => {
    if (
      previewKind !== "image" ||
      part.kind !== "local-image" ||
      !previewUrl ||
      !imagePreviewCacheKey ||
      (!previewOpen && !isPreviewNearViewport)
    ) {
      setImagePreviewUrl(null);
      setImagePreviewState("idle");
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

    setImagePreviewState("loading");

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
        setImagePreviewState("loaded");
      })
      .catch(() => {
        if (!cancelled) {
          setImagePreviewUrl(null);
          setImagePreviewState("error");
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
    imagePreviewRetryNonce,
    isPreviewNearViewport,
    part.kind,
    part.path,
    previewKind,
    previewOpen,
    previewUrl
  ]);

  useEffect(() => {
    if (previewKind !== "image" || part.kind !== "local-image") {
      setIsPreviewNearViewport(false);
      return;
    }

    const element = cardRef.current;

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

  useEffect(() => {
    if (!previewOpen || part.path || previewKind !== "text" || !previewUrl) return;

    let cancelled = false;

    setTextPreviewState("loading");

    const fetchPreviewText = assetsApi.getTextPreview(previewUrl, displayName);

    fetchPreviewText
      .then((value) => {
        if (cancelled) return;

        setTextPreview(value);
        setTextPreviewState("loaded");
      })
      .catch(() => {
        if (cancelled) return;

        setTextPreview("");
        setTextPreviewState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [assetContext, displayName, part.path, previewKind, previewOpen, previewUrl]);

  return {
    cardRef,
    copyLinkState,
    effectivePreviewUrl,
    imagePreviewState,
    isLocalAsset,
    previewOpen,
    textPreview,
    textPreviewState,
    handleCopyLocalAssetLink,
    handleDownloadLocalAsset,
    handleOpenLocalAsset,
    notifyDownloadStarting,
    openPreview,
    retryImagePreview,
    setPreviewOpen
  };
}
