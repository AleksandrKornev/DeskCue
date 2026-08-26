import { useEffect, useState } from "react";

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
  const [retryRevision, setRetryRevision] = useState(0);
  const displayName = readWorkspaceFileName(file.path);
  const maxPreviewBytes = readWorkspaceImagePreviewMaxBytes(getDeskCueRuntime().mode);

  useEffect(() => {
    if (file.sizeBytes > maxPreviewBytes) {
      setImageUrl(null);
      setPreviewState("too_large");
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
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      })
      .catch(() => {
        if (cancelled) return;

        setImageUrl(null);
        setPreviewState("error");
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

  if (previewState === "error") {
    return (
      <div className={styles.workspaceImagePreviewMessage} role="alert">
        <strong>Unable to preview image</strong>
        <p>The file may be unavailable or use unsupported image data.</p>
        <button onClick={() => setRetryRevision((value) => value + 1)} type="button">Retry</button>
      </div>
    );
  }

  return (
    <div className={styles.workspaceImagePreview}>
      {previewState === "loading" ? (
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
          onLoad={() => setPreviewState("loaded")}
          onError={() => setPreviewState("error")}
        />
      ) : null}
    </div>
  );
}
