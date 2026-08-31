import { useEffect, useRef, useState } from "react";

import type { WorkspaceFileResponse } from "@deskcue/protocol";
import { assetsApi } from "@api/endpoint/assets/endpoints";
import { getDeskCueRuntime } from "@runtime";

import {
  formatFileSize,
  formatFileSizeLimit,
  readWorkspaceImagePreviewMaxBytes
} from "./helpers";
import styles from "./styles.module.scss";

type WorkspaceImagePreviewProps = {
  file: WorkspaceFileResponse;
  workspaceId: string;
};

type WorkspaceImagePreviewState = "error" | "loaded" | "loading" | "too_large";

function readWorkspaceFileName(path: string) {
  return path.replace(/\\/g, "/").split("/").pop() || "image";
}

export function WorkspaceImagePreview({ file, workspaceId }: WorkspaceImagePreviewProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<WorkspaceImagePreviewState>("loading");
  const [retrying, setRetrying] = useState(false);
  const [retryRevision, setRetryRevision] = useState(0);
  const imageRef = useRef<HTMLImageElement>(null);
  const restoreImageFocusRef = useRef(false);
  const retryButtonRef = useRef<HTMLButtonElement>(null);
  const retryOwnsFocusRef = useRef(false);
  const displayName = readWorkspaceFileName(file.path);
  const maxPreviewBytes = readWorkspaceImagePreviewMaxBytes(getDeskCueRuntime().mode);

  useEffect(() => {
    if (previewState !== "loaded" || !restoreImageFocusRef.current) return;

    restoreImageFocusRef.current = false;
    retryOwnsFocusRef.current = false;
    imageRef.current?.focus();
  }, [previewState]);

  useEffect(() => {
    if (file.sizeBytes > maxPreviewBytes) {
      setImageUrl(null);
      setPreviewState("too_large");
      setRetrying(false);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    const abortController = new AbortController();

    setImageUrl(null);
    setPreviewState("loading");

    assetsApi.getTicketBlob(file.path, displayName, {
      context: { workspaceId },
      kind: "local_image",
      maxBytes: maxPreviewBytes,
      signal: abortController.signal
    })
      .then((blob) => {
        if (cancelled) return;

        if (blob.size > maxPreviewBytes) {
          setPreviewState("error");
          setRetrying(false);
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      })
      .catch(() => {
        if (cancelled) return;

        setImageUrl(null);
        setPreviewState("error");
        setRetrying(false);
      });

    return () => {
      cancelled = true;
      abortController.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [displayName, file.path, file.sizeBytes, maxPreviewBytes, retryRevision, workspaceId]);

  if (previewState === "too_large") {
    return (
      <div className={styles.workspaceImagePreviewMessage} role="status">
        <strong>Image preview is limited to {formatFileSizeLimit(maxPreviewBytes)}</strong>
        <p>This file is {formatFileSize(file.sizeBytes)}. Go back and use Open or Download.</p>
      </div>
    );
  }

  return (
    <div className={styles.workspaceImagePreview}>
      {previewState === "error" || retrying ? (
        <div
          aria-busy={retrying}
          aria-label={retrying ? "Retrying image preview" : undefined}
          className={styles.workspaceImagePreviewMessage}
          role={retrying ? "status" : "alert"}
        >
          <strong>{retrying ? "Retrying image preview…" : "Unable to preview image"}</strong>
          <p>{retrying
            ? "Keep this view open while DeskCue reloads the image."
            : "The file may be unavailable or use unsupported image data."}</p>
          <button
            aria-disabled={retrying}
            onClick={(event) => {
              if (retrying) return;

              event.currentTarget.focus();
              retryOwnsFocusRef.current = true;
              setRetrying(true);
              setRetryRevision((value) => value + 1);
            }}
            ref={retryButtonRef}
            type="button"
          >{retrying ? "Retrying…" : "Retry"}</button>
        </div>
      ) : previewState === "loading" ? (
        <div className={styles.filesLoadingState} role="status">
          <span aria-hidden="true" className={styles.filesLoadingSpinner} />
          <span>Loading image preview…</span>
        </div>
      ) : null}
      {imageUrl ? (
        <img
          alt={`Preview of ${displayName}`}
          className={previewState === "loading" ? styles.workspaceImagePreviewLoading : undefined}
          src={imageUrl}
          onLoad={() => {
            const retryOwnsFocus = retryOwnsFocusRef.current &&
              document.activeElement === retryButtonRef.current;

            retryOwnsFocusRef.current = false;
            restoreImageFocusRef.current = retryOwnsFocus;
            setPreviewState("loaded");
            setRetrying(false);
          }}
          onError={() => {
            retryOwnsFocusRef.current = false;
            setPreviewState("error");
            setRetrying(false);
          }}
          ref={imageRef}
          tabIndex={-1}
        />
      ) : null}
    </div>
  );
}
