import clsx from "clsx";
import { useCallback } from "react";

import { LOCAL_ASSET_LINK_EXPIRY_LABEL } from "@api/endpoint/assets/endpoints";
import type { LocalAssetLinkContext } from "@api/endpoint/assets/types";
import CopyIcon from "@assets/images/icon-copy.svg?react";
import DownloadIcon from "@assets/images/icon-download.svg?react";
import ExternalLinkIcon from "@assets/images/icon-external-link.svg?react";
import { Tooltip } from "@components/Tooltip";
import {
  getAttachmentBadgeLabel,
  getAttachmentDisplayName,
  getAttachmentPreviewKind,
  getAttachmentSecondaryLabel
} from "@modules/transcript/RichTranscriptContent/helpers";
import type { AttachmentPart } from "@modules/transcript/RichTranscriptContent/types";

import { AttachmentLightbox } from "./AttachmentLightbox";
import {
  getAttachmentDownloadHref,
  getAttachmentOpenHref,
  getAttachmentPreviewUrl
} from "./helpers";
import styles from "./styles.module.scss";
import { useTranscriptAttachmentPreview } from "./useTranscriptAttachmentPreview";

export function TranscriptAttachmentCard(props: {
  assetContext?: LocalAssetLinkContext;
  compact?: boolean;
  dense?: boolean;
  part: AttachmentPart;
}) {
  const { assetContext, compact = false, dense = false, part } = props;

  const displayName = getAttachmentDisplayName(part);
  const previewKind = getAttachmentPreviewKind(part);
  const previewUrl = getAttachmentPreviewUrl(part);
  const openHref = getAttachmentOpenHref(part);
  const downloadHref = getAttachmentDownloadHref(part);
  const secondaryLabel = getAttachmentSecondaryLabel(part, previewKind);
  const badgeLabel = getAttachmentBadgeLabel(part);
  const attachmentAddress = part.path ?? part.url ?? null;
  const {
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
  } = useTranscriptAttachmentPreview({
    assetContext,
    displayName,
    part,
    previewKind,
    previewUrl
  });
  const hasImagePreview = previewKind === "image" && Boolean(previewUrl);
  const isImagePreviewPending =
    hasImagePreview &&
    part.kind === "local-image" &&
    !effectivePreviewUrl &&
    imagePreviewState !== "error";
  const isImagePreviewError = hasImagePreview && imagePreviewState === "error";

  const handlePrimaryCardAction = useCallback(() => {
    if (previewKind !== "none" && previewUrl) {
      setPreviewOpen(true);
      return;
    }

    if (isLocalAsset) {
      handleOpenLocalAsset();
      return;
    }

    if (openHref) window.open(openHref, "_blank", "noopener,noreferrer");
  }, [handleOpenLocalAsset, isLocalAsset, openHref, previewKind, previewUrl, setPreviewOpen]);

  return (
    <>
      <div
        ref={cardRef}
        className={clsx(
          styles.card,
          styles.cardAttachment,
          compact && styles.cardCompact,
          dense && styles.cardDense
        )}
      >
        {hasImagePreview ? (
          <button
            aria-label={isImagePreviewError ? `Retry preview ${displayName}` : `Preview ${displayName}`}
            className={styles.attachmentPreview}
            onClick={isImagePreviewError ? retryImagePreview : openPreview}
            type="button"
          >
            {effectivePreviewUrl ? (
              <img alt={displayName} loading="lazy" src={effectivePreviewUrl} />
            ) : isImagePreviewPending ? (
              <span className={styles.attachmentPreviewLoading} aria-label="Loading image preview">
                <span className={styles.attachmentPreviewSpinner} aria-hidden="true" />
              </span>
            ) : isImagePreviewError ? (
              <span aria-live="polite" className={styles.attachmentPreviewError}>
                <strong>Preview unavailable</strong>
                <span>Retry</span>
              </span>
            ) : (
              <span className={styles.attachmentPreviewPlaceholder} aria-hidden="true">
                {badgeLabel}
              </span>
            )}
          </button>
        ) : (
          <button
            aria-label={previewKind !== "none" && previewUrl ? `Preview ${displayName}` : `Open ${displayName}`}
            className={styles.attachmentTile}
            disabled={!isLocalAsset && !openHref && previewKind === "none"}
            onClick={handlePrimaryCardAction}
            type="button"
          >
            <span className={styles.attachmentTileBadge}>{badgeLabel}</span>
            <span className={styles.attachmentTileCopy}>
              <strong>{displayName}</strong>
              <span>{secondaryLabel}</span>
            </span>
          </button>
        )}

        {hasImagePreview ? (
          <div className={clsx(styles.cardHeader, styles.cardHeaderAttachment)}>
            <strong>
              <Tooltip
                className={styles.attachmentTitleTooltip}
                placement="above"
                value={displayName}
              >
                {displayName}
              </Tooltip>
            </strong>
            <span>
              <Tooltip
                className={styles.attachmentSecondaryTooltip}
                placement="above"
                value={secondaryLabel}
              >
                {secondaryLabel}
              </Tooltip>
            </span>
          </div>
        ) : null}

        <div className={clsx(styles.cardMeta, styles.cardMetaAttachment)}>
          {attachmentAddress ? (
            <span className={styles.cardMetaSecondary}>
              <Tooltip
                className={styles.attachmentAddressTooltip}
                placement="above"
                value={attachmentAddress}
              >
                {attachmentAddress}
              </Tooltip>
            </span>
          ) : null}
        </div>

        {previewUrl || openHref || downloadHref || isLocalAsset ? (
          <div className={styles.attachmentActions}>
            {isLocalAsset ? (
              <button
                aria-label={`Open ${displayName}`}
                className={styles.attachmentAction}
                onClick={handleOpenLocalAsset}
                title={`Open ${displayName}`}
                type="button"
              >
                <ExternalLinkIcon className={styles.attachmentActionIcon} aria-hidden="true" focusable="false" />
                <span className={styles.attachmentActionLabel}>Open</span>
              </button>
            ) : null}
            {openHref ? (
              <a
                aria-label={`Open ${displayName}`}
                className={styles.attachmentAction}
                href={openHref}
                rel="noreferrer"
                target="_blank"
                title={`Open ${displayName}`}
              >
                <ExternalLinkIcon className={styles.attachmentActionIcon} aria-hidden="true" focusable="false" />
                <span className={styles.attachmentActionLabel}>Open</span>
              </a>
            ) : null}
            {isLocalAsset ? (
              <button
                aria-label={`Download ${displayName}`}
                className={styles.attachmentAction}
                onClick={handleDownloadLocalAsset}
                title={`Download ${displayName}`}
                type="button"
              >
                <DownloadIcon className={styles.attachmentActionIcon} aria-hidden="true" focusable="false" />
                <span className={styles.attachmentActionLabel}>Download</span>
              </button>
            ) : null}
            {isLocalAsset ? (
              <button
                aria-label={`Copy temporary link for ${displayName}`}
                className={styles.attachmentAction}
                disabled={copyLinkState === "copying"}
                onClick={() => {
                  void handleCopyLocalAssetLink();
                }}
                title={`Creates a temporary file link valid for ${LOCAL_ASSET_LINK_EXPIRY_LABEL}`}
                type="button"
              >
                <CopyIcon className={styles.attachmentActionIcon} aria-hidden="true" focusable="false" />
                <span className={styles.attachmentActionLabel}>
                  {copyLinkState === "copying" ? "Copying..." : "Copy link"}
                </span>
              </button>
            ) : null}
            {downloadHref ? (
              <a
                aria-label={`Download ${displayName}`}
                className={styles.attachmentAction}
                download={displayName}
                href={downloadHref}
                onClick={notifyDownloadStarting}
                rel="noreferrer"
                target="_blank"
                title={`Download ${displayName}`}
              >
                <DownloadIcon className={styles.attachmentActionIcon} aria-hidden="true" focusable="false" />
                <span className={styles.attachmentActionLabel}>Download</span>
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      {previewOpen && effectivePreviewUrl && previewKind !== "none" ? (
        <AttachmentLightbox
          displayName={displayName}
          downloadHref={downloadHref ?? undefined}
          openHref={openHref ?? undefined}
          previewKind={previewKind}
          previewUrl={effectivePreviewUrl}
          secondaryLabel={secondaryLabel}
          textPreview={textPreview}
          textPreviewState={textPreviewState}
          onDownloadStart={notifyDownloadStarting}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </>
  );
}
