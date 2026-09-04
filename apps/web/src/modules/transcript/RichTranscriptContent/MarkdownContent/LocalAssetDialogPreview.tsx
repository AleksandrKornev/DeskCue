import styles from "./styles.module.scss";
import type { LocalAssetPreviewState } from "./useLocalAssetPreview";

type LocalAssetDialogPreviewProps = {
  alt: string;
  canRetry: boolean;
  displayName: string;
  preview: LocalAssetPreviewState;
  onPreviewError: () => void;
  onRetry: () => void;
};

function getPreviewFailureCopy(preview: LocalAssetPreviewState) {
  if (preview.failure === "too_large") {
    return {
      detail: "This file is larger than the safe in-app preview limit. You can still open or download it.",
      title: "Preview is too large"
    };
  }

  if (preview.failure === "decode") {
    if (preview.kind === "image") {
      return {
        detail: "You can still open or download the file.",
        title: "Image preview unavailable"
      };
    }

    return {
      detail: "The file type or encoding does not match a safe browser preview. You can still open or download it.",
      title: "Preview unavailable"
    };
  }

  return {
    detail: "DeskCue could not load this preview. Check that the file still exists, then try again.",
    title: "Could not load preview"
  };
}

export function LocalAssetDialogPreview({
  alt,
  canRetry,
  displayName,
  preview,
  onPreviewError,
  onRetry
}: LocalAssetDialogPreviewProps) {
  if (preview.status === "loading") {
    const loadingTitle = preview.kind === "image" ? "Loading image preview…" : "Loading preview";

    return (
      <div className={styles.localAssetDialogPreviewState} role="status">
        <span className={styles.localAssetDialogSpinner} aria-hidden="true" />
        <strong>{loadingTitle}</strong>
        <span>Fetching {displayName}</span>
      </div>
    );
  }

  if (preview.status === "unsupported") {
    return (
      <div className={styles.localAssetDialogPreviewState} role="status">
        <strong>Preview unavailable for this file type</strong>
        <span>You can still open the file in its default app or download a copy.</span>
      </div>
    );
  }

  if (preview.status === "error") {
    const copy = getPreviewFailureCopy(preview);

    return (
      <div className={styles.localAssetDialogPreviewState} role="alert">
        <strong>{copy.title}</strong>
        <span>{copy.detail}</span>
        {canRetry ? (
          <button className={styles.localAssetDialogRetry} onClick={onRetry} type="button">
            Try again
          </button>
        ) : null}
      </div>
    );
  }

  if (preview.kind === "text") {
    return preview.text ? (
      <pre aria-label={`${displayName} contents`} className={styles.localAssetDialogText} tabIndex={0}>
        {preview.text}
      </pre>
    ) : (
      <div className={styles.localAssetDialogPreviewState} role="status">
        <strong>This file is empty</strong>
        <span>There is no text content to preview.</span>
      </div>
    );
  }

  if (preview.kind === "image" && preview.url) {
    return (
      <div className={styles.localAssetDialogMedia}>
        <img alt={alt} referrerPolicy="no-referrer" src={preview.url} onError={onPreviewError} />
      </div>
    );
  }

  if (preview.kind === "video" && preview.url) {
    return (
      <div className={styles.localAssetDialogMedia}>
        <video
          aria-label={`Preview of ${displayName}`}
          controls
          playsInline
          preload="metadata"
          src={preview.url}
          onError={onPreviewError}
        >
          Your browser cannot preview this video
        </video>
      </div>
    );
  }

  if (preview.kind === "audio" && preview.url) {
    return (
      <div className={styles.localAssetDialogAudio}>
        <audio
          aria-label={`Preview of ${displayName}`}
          controls
          preload="metadata"
          src={preview.url}
          onError={onPreviewError}
        >
          Your browser cannot preview this audio
        </audio>
      </div>
    );
  }

  if (preview.kind === "pdf" && preview.url) {
    return (
      <iframe
        className={styles.localAssetDialogDocument}
        sandbox=""
        referrerPolicy="no-referrer"
        src={preview.url}
        title={`Preview of ${displayName}`}
        onError={onPreviewError}
      />
    );
  }

  return null;
}
