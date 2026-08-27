import clsx from "clsx";
import { createPortal } from "react-dom";

import CloseIcon from "@assets/images/icon-close.svg?react";
import { useBottomSheetDrag } from "@components/BottomSheet";
import { useModalFocusLifecycle } from "@components/Modal";
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
  const {
    dragHandleProps,
    sheetGestureProps,
    sheetRef
  } = useBottomSheetDrag<HTMLDivElement>({ onDismiss: onClose });

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
            <button
              aria-label="Close preview"
              className={styles.dialogIconClose}
              onClick={onClose}
              type="button"
            >
              <CloseIcon className={styles.dialogCloseIcon} aria-hidden="true" focusable="false" />
            </button>
          </div>
        </div>

        <div
          aria-label={`${displayName} preview`}
          className={clsx(styles.lightboxBody, lightboxBodyClassByKind[previewKind])}
          role="region"
          tabIndex={0}
        >
          {previewKind === "image" ? <img alt={displayName} src={previewUrl} /> : null}
          {previewKind === "pdf" ? (
            <iframe className={styles.lightboxFrame} src={previewUrl} title={displayName} />
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
