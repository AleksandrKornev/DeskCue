import {
  useEffect,
  useId,
  useRef,
  useState
} from "react";

import { assetsApi } from "@api/endpoint/assets/endpoints";

import { LocalAssetActionDialog } from "./LocalAssetActionDialog";
import styles from "./styles.module.scss";
import type { LocalMarkdownImageProps } from "./types";

type LocalImagePreviewState = {
  identity: string;
  status: "error" | "loading" | "ready";
  url: string | null;
};

type LocalImageRequest = {
  agentSessionId?: string;
  assetPath: string;
  displayName: string;
  hasAssetContext: boolean;
  managedSessionId?: string;
  workspaceId?: string;
};

const LOCAL_MARKDOWN_IMAGE_ROOT_MARGIN = "240px 0px";

function getLocalImageDisplayName(alt: string, assetPath: string) {
  return alt.trim() || assetPath.split(/[\\/]/u).pop() || assetPath;
}

function createLocalImageIdentity({
  alt,
  assetContext,
  assetPath
}: Pick<LocalMarkdownImageProps, "alt" | "assetContext" | "assetPath">) {
  return JSON.stringify([
    assetPath,
    alt,
    assetContext?.managedSessionId ?? null,
    assetContext?.agentSessionId ?? null,
    assetContext?.workspaceId ?? null
  ]);
}

function requestLocalMarkdownImageBlob({
  agentSessionId,
  assetPath,
  displayName,
  hasAssetContext,
  managedSessionId,
  workspaceId
}: LocalImageRequest, signal: AbortSignal) {
  if (!hasAssetContext) {
    return assetsApi.getImageBlob(assetsApi.buildImageUrl(assetPath), displayName, signal);
  }

  return assetsApi.getTicketBlob(assetPath, displayName, {
    context: { agentSessionId, managedSessionId, workspaceId },
    kind: "local_image",
    signal
  });
}

function LocalMarkdownImageContent({
  alt,
  assetContext,
  assetPath,
  interactive = true
}: LocalMarkdownImageProps) {
  const statusId = useId();
  const agentSessionId = assetContext?.agentSessionId;
  const managedSessionId = assetContext?.managedSessionId;
  const workspaceId = assetContext?.workspaceId;
  const hasAssetContext = assetContext !== undefined;
  const imageIdentity = createLocalImageIdentity({ alt, assetContext, assetPath });
  const previewRootRef = useRef<HTMLElement | null>(null);
  const [isPreviewNearViewport, setIsPreviewNearViewport] = useState(
    typeof IntersectionObserver === "undefined"
  );
  const [actionDialogIdentity, setActionDialogIdentity] = useState<string | null>(null);
  const [preview, setPreview] = useState<LocalImagePreviewState>({
    identity: imageIdentity,
    status: "loading",
    url: null
  });
  const displayName = getLocalImageDisplayName(alt, assetPath);
  const currentPreview = preview.identity === imageIdentity
    ? preview
    : { identity: imageIdentity, status: "loading" as const, url: null };

  useEffect(() => {
    const element = previewRootRef.current;

    if (!element || typeof IntersectionObserver === "undefined") {
      setIsPreviewNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setIsPreviewNearViewport(entry.isIntersecting),
      { root: null, rootMargin: LOCAL_MARKDOWN_IMAGE_ROOT_MARGIN }
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [imageIdentity]);

  useEffect(() => {
    if (!isPreviewNearViewport) {
      setPreview({ identity: imageIdentity, status: "loading", url: null });
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    const requestController = new AbortController();

    setPreview({ identity: imageIdentity, status: "loading", url: null });

    void requestLocalMarkdownImageBlob({
      agentSessionId,
      assetPath,
      displayName,
      hasAssetContext,
      managedSessionId,
      workspaceId
    }, requestController.signal)
      .then((blob) => {
        if (cancelled) return;

        objectUrl = URL.createObjectURL(blob);
        setPreview({ identity: imageIdentity, status: "ready", url: objectUrl });
      })
      .catch(() => {
        if (!cancelled) setPreview({ identity: imageIdentity, status: "error", url: null });
      });

    return () => {
      cancelled = true;
      requestController.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [
    agentSessionId,
    assetPath,
    displayName,
    hasAssetContext,
    imageIdentity,
    isPreviewNearViewport,
    managedSessionId,
    workspaceId
  ]);

  const statusText = currentPreview.status === "error"
    ? "Local image unavailable"
    : currentPreview.status === "loading" ? "Loading local image" : null;

  if (!interactive && statusText) {
    return <span className={styles.localImageState} ref={previewRootRef}>{statusText}</span>;
  }

  if (!interactive) {
    return (
      <img
        alt={alt}
        loading="lazy"
        ref={(element) => {
          previewRootRef.current = element;
        }}
        src={currentPreview.url ?? undefined}
      />
    );
  }

  return (
    <>
      <button
        aria-describedby={statusText ? statusId : undefined}
        aria-expanded={actionDialogIdentity === imageIdentity}
        aria-haspopup="dialog"
        aria-label={`Image actions: ${displayName}`}
        className={styles.localImageButton}
        ref={(element) => {
          previewRootRef.current = element;
        }}
        title={`Show actions for ${displayName}`}
        onClick={() => setActionDialogIdentity(imageIdentity)}
        type="button"
      >
        {statusText ? (
          <span aria-hidden="true" className={styles.localImageState}>{statusText}</span>
        ) : (
          <img alt={alt} loading="lazy" src={currentPreview.url ?? undefined} />
        )}
      </button>
      {statusText ? (
        <span className={styles.srOnly} id={statusId} role="status">{statusText}</span>
      ) : null}
      {actionDialogIdentity === imageIdentity ? (
        <LocalAssetActionDialog
          key={imageIdentity}
          assetContext={assetContext}
          assetPath={assetPath}
          displayName={displayName}
          isOpen
          previewImage={currentPreview.url ? { alt, url: currentPreview.url } : undefined}
          previewStatus={currentPreview.status}
          onClose={() => setActionDialogIdentity(null)}
        />
      ) : null}
    </>
  );
}

export function LocalMarkdownImage(props: LocalMarkdownImageProps) {
  const imageIdentity = createLocalImageIdentity(props);

  return <LocalMarkdownImageContent key={imageIdentity} {...props} />;
}
