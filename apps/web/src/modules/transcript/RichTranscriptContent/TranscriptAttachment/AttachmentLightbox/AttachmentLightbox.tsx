import clsx from "clsx";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useBottomSheetDrag } from "@components/BottomSheet";
import { ModalCloseButton, useModalFocusLifecycle } from "@components/Modal";
import type { AttachmentPreviewKind } from "@modules/transcript/RichTranscriptContent/types";

import { lightboxBodyClassByKind } from "./constants";
import styles from "./styles.module.scss";

export type AttachmentLightboxProps = {
  displayName: string;
  downloadHref?: string;
  openHref?: string;
  previewKind: AttachmentPreviewKind;
  previewUrl: string;
  secondaryLabel: string;
  textPreview: string;
  textPreviewState: "idle" | "loading" | "loaded" | "error";
  onClose: () => void;
  onDownloadStart?: () => void;
};

export function AttachmentLightbox({
  displayName,
  downloadHref,
  previewKind,
  previewUrl,
  secondaryLabel,
  textPreview,
  textPreviewState,
  openHref,
  onClose,
  onDownloadStart
}: AttachmentLightboxProps) {
  const [mediaPreviewRetryKey, setMediaPreviewRetryKey] = useState(0);
  const [mediaPreviewState, setMediaPreviewState] = useState<"loading" | "loaded" | "error">(
    "loading"
  );
  const {
    dragHandleProps,
    sheetGestureProps,
    sheetRef
  } = useBottomSheetDrag<HTMLDivElement>({ onDismiss: onClose });
  const isMediaPreview = previewKind !== "none" && previewKind !== "text";

  useEffect(() => {
    setMediaPreviewRetryKey(0);
    setMediaPreviewState("loading");
  }, [previewKind, previewUrl]);

  useModalFocusLifecycle({ dialogRef: sheetRef, onClose });
  const lightbox = (
    <div className={styles.lightbox}>
      <button
        aria-hidden="true"
        aria-label="Close preview"
        className={styles.lightboxBackdrop}
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <div
        className={styles.lightboxCard}
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={displayName}
        {...sheetGestureProps}
        tabIndex={-1}
      >
        <div aria-hidden="true" className={styles.dragHandle} {...dragHandleProps} />
        <div
          className={clsx(styles.lightboxBar, styles.dialogHeader)}
          {...dragHandleProps}
        >
          <div className={styles.dialogHeaderCopy}>
            <strong>{displayName}</strong>
            <span>{secondaryLabel}</span>
          </div>
          <ModalCloseButton
            className={styles.dialogHeaderClose}
            label="Close preview"
            onClick={onClose}
          />
          {openHref || downloadHref ? (
            <div className={clsx(styles.lightboxActions, styles.dialogHeaderActions)}>
              {openHref ? (
                <a
                  className={styles.attachmentAction}
                  href={openHref}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open
                </a>
              ) : null}
              {downloadHref ? (
                <a
                  className={styles.attachmentAction}
                  download={displayName}
                  href={downloadHref}
                  onClick={onDownloadStart}
                  rel="noreferrer"
                  target="_blank"
                >
                  Download
                </a>
              ) : null}
            </div>
          ) : null}
        </div>

        <div
          aria-busy={isMediaPreview && mediaPreviewState === "loading"}
          aria-label={`${displayName} preview`}
          className={clsx(
            styles.lightboxBody,
            lightboxBodyClassByKind[previewKind],
            isMediaPreview && mediaPreviewState !== "loaded" && styles.lightboxBodyPending
          )}
          role="region"
          tabIndex={0}
        >
          {previewKind === "image" && mediaPreviewState !== "error" ? (
            <img
              alt={displayName}
              className={mediaPreviewState === "loading" ? styles.lightboxPreviewLoading : undefined}
              key={`${previewUrl}:${mediaPreviewRetryKey}`}
              onError={() => setMediaPreviewState("error")}
              onLoad={() => setMediaPreviewState("loaded")}
              src={previewUrl}
            />
          ) : null}
          {previewKind === "video" && mediaPreviewState !== "error" ? (
            <video
              className={mediaPreviewState === "loading" ? styles.lightboxPreviewLoading : undefined}
              controls
              key={`${previewUrl}:${mediaPreviewRetryKey}`}
              onError={() => setMediaPreviewState("error")}
              onLoadedMetadata={() => setMediaPreviewState("loaded")}
              playsInline
              preload="metadata"
              src={previewUrl}
            >
              Your browser cannot preview this video
            </video>
          ) : null}
          {previewKind === "audio" && mediaPreviewState !== "error" ? (
            <audio
              className={mediaPreviewState === "loading" ? styles.lightboxPreviewLoading : undefined}
              controls
              key={`${previewUrl}:${mediaPreviewRetryKey}`}
              onError={() => setMediaPreviewState("error")}
              onLoadedMetadata={() => setMediaPreviewState("loaded")}
              preload="metadata"
              src={previewUrl}
            >
              Your browser cannot preview this audio
            </audio>
          ) : null}
          {previewKind === "pdf" && mediaPreviewState !== "error" ? (
            <iframe
              className={clsx(
                styles.lightboxFrame,
                mediaPreviewState === "loading" && styles.lightboxPreviewLoading
              )}
              key={`${previewUrl}:${mediaPreviewRetryKey}`}
              onError={() => setMediaPreviewState("error")}
              onLoad={() => setMediaPreviewState("loaded")}
              sandbox=""
              src={previewUrl}
              title={displayName}
            />
          ) : null}
          {isMediaPreview && mediaPreviewState === "loading" ? (
            <div className={clsx(styles.lightboxState, styles.lightboxMediaState)} role="status">
              <span className={styles.lightboxSpinner} aria-hidden="true" />
              <strong>Loading preview</strong>
              <span>Fetching {displayName}</span>
            </div>
          ) : null}
          {isMediaPreview && mediaPreviewState === "error" ? (
            <div className={clsx(styles.lightboxState, styles.lightboxMediaState)} role="alert">
              <strong>Preview unavailable</strong>
              <span>Check the connection or use Open or Download</span>
              <button
                className={styles.lightboxRetry}
                onClick={() => {
                  setMediaPreviewState("loading");
                  setMediaPreviewRetryKey((current) => current + 1);
                }}
                type="button"
              >
                Retry
              </button>
            </div>
          ) : null}
          {previewKind === "text" ? (
            textPreviewState === "loaded" ? (
              <pre className={styles.lightboxText}>{textPreview}</pre>
            ) : (
              <div className={styles.lightboxState}>
                <strong>
                  {textPreviewState === "error" ? "Preview unavailable" : "Loading preview"}
                </strong>
                <span>
                  {textPreviewState === "error"
                    ? "Open or download the file instead"
                    : "Fetching file contents"}
                </span>
              </div>
            )
          ) : null}
        </div>
      </div>
    </div>
  );

  return createPortal(lightbox, document.body);
}
